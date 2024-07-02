import { Models, Routes } from "@triply/utils";
import App from "./App.js";
import { wait } from "./utils/index.js";
import { _get, _post, _delete, _patch } from "./RequestHandler.js";
import { getErr, TriplyDbJsError } from "./utils/Error.js";
import Dataset from "./Dataset.js";
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
type OnProgressUpdateType = "creating" | "swapping" | "deleting" | "finished";
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
  public async update(opts?: { rollingUpdate: false }): Promise<void>;
  public async update(opts?: {
    rollingUpdate: true;
    onProgress: (opts?: { type: OnProgressUpdateType; message: string }) => void;
  }): Promise<void>;
  public async update(opts?: {
    rollingUpdate: boolean;
    onProgress?: (opts?: { type: OnProgressUpdateType; message: string }) => void;
  }) {
    if (opts?.rollingUpdate) {
      if (!opts.onProgress) throw new Error(`'onProgress' is undefined. This is a bug.`);
      await this.rollingUpdate(opts.onProgress);
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

  private async rollingUpdate(onProgress?: (opts?: { type: OnProgressUpdateType; message: string }) => void) {
    // We have to make sure we get the most recent information about the service
    const info = await this.getInfo(true);
    const type = info.type;
    const mainName = info.name;
    if (!info.outOfSync)
      throw getErr(
        `Cannot update service '${mainName}' of dataset '${this.dataset.slug}', because it is not out of sync.`,
      );
    if (info.status !== "running")
      throw getErr(
        `Service '${mainName}' is of status '${info.status}' and will not be updated. Only services with status 'running' can be updated.`,
      );

    const newServiceTempName = getSubstrForServiceNames(mainName) + `-temp`;
    const now = Date.now();
    if (onProgress)
      onProgress({
        type: "creating",
        message: `Creating temporary ${type} service '${newServiceTempName}' for replacing '${mainName}'.`,
      });
    const createdService = await new Service({
      app: this.app,
      dataset: this.dataset,
      name: newServiceTempName,
      type,
      config: info.config,
    }).create();
    if (onProgress)
      onProgress({ type: "swapping", message: `Swapping service '${mainName}' with '${newServiceTempName}'.` });
    await this.rename(getSubstrForServiceNames(mainName) + `-BAK`);
    await createdService.rename(mainName);
    if (onProgress) onProgress({ type: "deleting", message: `Deleting old service '${this.slug}'.` });
    await this.delete();
    // we want to be able to work again with this service.
    this.slug = mainName;
    if (onProgress)
      onProgress({ type: "finished", message: `Service '${mainName}' updated in ${msTohms(Date.now() - now)}.` });
    return createdService;
  }

  public getDataset(): Dataset {
    return this.dataset;
  }
}
/**
 * Get the service name string and return a substring,
 * so that when we make concatinations don't lead to an error
 * (limit 40 characters for a service name)
 *
 * @param serviceName
 */
function getSubstrForServiceNames(serviceName: string) {
  return serviceName.substring(0, 30);
}
