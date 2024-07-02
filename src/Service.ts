import { Models, Routes } from "@triply/utils";
import App from "./App.js";
import { wait } from "./utils/index.js";
import { _get, _post, _delete, _patch } from "./RequestHandler.js";
import { getErr, TriplyDbJsError } from "./utils/Error.js";
import Dataset, { NewService } from "./Dataset.js";
import msTohms from "./utils/timeHelper.js";

type ServiceAdminInfo = {
  autoResume?: boolean;
  queriedAtUncached?: string;
  queriedAt?: string;
  autostopsAt?: string;
  dataset?: Dataset;
  adminInfo?: {
    fromOrchestrator?: {};
    fromService?: {};
  };
  canUpdate?: boolean;
  foundInDocker?: boolean;
  foundInMongo?: boolean;
};
export type ServiceInfo = Omit<Models.ServiceMetadata, keyof ServiceAdminInfo>;

export default class Service {
  public app: App;
  private _info?: ServiceInfo;
  private _graphs?: Models.ServiceGraphInfo[];
  public dataset: Dataset;
  public slug: string;
  private _type: Models.ServiceType;
  private _config?: Models.ServiceConfig;
  public readonly type = "Service";

  constructor(conf: {
    app: App;
    name: string;
    dataset: Dataset;
    type: Models.ServiceType;
    config?: Models.ServiceConfig;
  }) {
    this.app = conf.app;
    this.slug = conf.name;
    this.dataset = conf.dataset;
    this._type = conf.type;
    this._config = conf.config;
  }

  public async getInfo(refresh = false): Promise<ServiceInfo> {
    if (!refresh && this._info) return this._info;
    this._info = await _get<Routes.datasets._account._dataset.services._serviceName.Get>({
      errorWithCleanerStack: getErr(
        `Failed to get information of service '${this.slug}' in dataset '${this.dataset.slug}'.`,
      ),
      app: this.app,
      path: this.api.path,
    });
    return this._info;
  }

  public get api() {
    const path = `${this.dataset.api.path}/services/${this.slug}`;
    return {
      url: this.app.url + path,
      path,
    };
  }

  public async isUpToDate(): Promise<boolean> {
    const info = await this.getInfo(true);
    return !info.outOfSync;
  }

  public async rename(newName: string): Promise<Service> {
    await _patch<Routes.datasets._account._dataset.services._serviceName.Patch>({
      errorWithCleanerStack: getErr(`Failed to rename service ${this.slug} of dataset ${this.dataset.slug}.`),
      app: this.app,
      path: this.api.path,
      data: {
        name: newName,
      },
    });
    this.slug = newName;
    return this;
  }

  public async getGraphs(refresh = false): Promise<Models.ServiceGraphInfo[]> {
    if (!this._graphs || refresh) {
      this._graphs = await _get<Routes.datasets._account._dataset.services._serviceName.graphs.Get>({
        errorWithCleanerStack: getErr(`Failed to get graphs of service ${this.slug} of dataset ${this.dataset.slug}.`),
        app: this.app,
        path: `${this.api.path}/graphs`,
      });
    }
    return this._graphs;
  }

  public async delete() {
    this._info = await _delete<Routes.datasets._account._dataset.services._serviceName.Delete>({
      errorWithCleanerStack: getErr(`Failed to delete service ${this.slug} of dataset ${this.dataset.slug}.`),
      app: this.app,
      path: this.api.path,
      expectedResponseBody: "empty",
    });
  }

  public async create(): Promise<Service> {
    try {
      await _post({
        errorWithCleanerStack: getErr(`Failed to create service '${this.slug}' in dataset '${this.dataset.slug}'.`),
        app: this.app,
        path: `${this.dataset.api.path}/services`,
        data: {
          name: this.slug,
          type: this._type,
          config: this._config,
        },
      });
    } catch (e) {
      if (
        e instanceof TriplyDbJsError &&
        e.statusCode === 400 &&
        (e.message.indexOf("Service of type") >= 0 || e.message.indexOf("Invalid service type") >= 0)
      ) {
        this._type = this._type;
        return this.create();
      } else {
        throw e;
      }
    }
    await this.waitUntilRunning();
    return this;
  }

  public async waitUntilRunning() {
    let failedServiceErrorCount = 0;
    while (true) {
      let info: ServiceInfo | undefined;
      try {
        info = await this.getInfo(true);
      } catch (e) {
        if (!(e instanceof TriplyDbJsError && e.statusCode === 503)) throw e;
      }
      if (info) {
        if (info.status === "running") return;
        if (info.error) {
          // Remove this check once #6591 is deployed.
          if (info.error?.message.includes("Failed to get information for service") && failedServiceErrorCount++ < 3) {
            // This should be momentary. Let's retry a few times and give up if we still get this error.
          } else {
            throw getErr(`Failed to start service ${this.slug} of dataset ${this.dataset.slug}: ${info.error.message}`);
          }
        } else if (!["starting", "updating"].includes(info.status)) {
          throw getErr(
            `Failed to start service ${this.slug} of dataset ${
              (await this.dataset.getInfo(true)).name
            } as it is being stopped or removed.`,
          );
        } else {
          failedServiceErrorCount = 0;
        }
      }
      await wait(5000);
    }
  }

  public async update(opts?: { rollingUpdate: boolean }) {
    if (opts?.rollingUpdate) {
      await this.rollingUpdate();
    } else {
      await _post({
        errorWithCleanerStack: getErr(`Failed to update service ${this.slug} of dataset ${this.dataset.slug}.`),
        app: this.app,
        path: this.api.path,
        data: { sync: true },
      });
      await this.waitUntilRunning();
    }
  }

  private async rollingUpdate() {
    const info = await this.getInfo();
    if (info.outOfSync) {
      if (info.status !== "running") {
        throw getErr(
          `Service '${info.name}' is of status '${info.status}' and will not be updated. Only services with status 'running' can be updated.`,
        );
      } else {
        const type = info.type;
        let newServicename = getSubstrForServiceNames(info.name) + `temp-`;
        // The below cast is not correct,
        // but we don't want to expose blazegraph to users that don't have it.
        let newServiceInfo = { type } as NewService;
        switch (info.type) {
          case "elasticSearch":
            newServiceInfo = {
              type: "elasticSearch",
              config: (info.config ?? {}) as Models.ServiceConfigElastic,
            };
            break;
          case "jena":
            newServiceInfo = {
              type: "jena",
              config: (info.config ?? {}) as Models.ServiceConfigJena,
            };
            break;
        }
        const now = Date.now();
        console.info(`Creating temporary ${info.type} service '${newServicename}' for replacing '${info.name}'.`);

        const createdService = await new Service({
          app: this.app,
          dataset: this.dataset,
          name: newServicename,
          type: newServiceInfo.type,
          config: newServiceInfo.config || undefined,
        }).create();
        console.info(`Swapping service '${info.name}' with '${newServicename}'.`);
        await this.rename(getSubstrForServiceNames(info.name) + `-BAK`);
        await createdService.rename(info.name);
        await this.delete();
        console.info(`Service '${info.name}' updated in ${msTohms(Date.now() - now)}.`);
        return createdService;
      }
    }
  }

  public getDataset(): Dataset {
    return this.dataset;
  }
}

function getSubstrForServiceNames(serviceName: string) {
  return serviceName.substring(0, 30);
}
