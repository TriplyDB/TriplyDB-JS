import { Models, Routes } from "@triply/utils";
import App from "./App.js";
import { wait } from "./utils/index.js";
import { _get, _post, _delete, _patch } from "./RequestHandler.js";
import { getErr, TriplyDbJsError } from "./utils/Error.js";
import Dataset from "./Dataset.js";

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
type ServiceInfo = Omit<Models.ServiceMetadata, keyof ServiceAdminInfo>;

export default class Service {
  private _app: App;
  private _info?: ServiceInfo;
  private _graphs?: Models.ServiceGraphInfo[];
  private _dataset: Dataset;
  private _name: string;
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
    this._app = conf.app;
    this._name = conf.name;
    this._dataset = conf.dataset;
    this._type = conf.type;
    this._config = conf.config;
  }

  public async getInfo(refresh = false): Promise<ServiceInfo> {
    if (!refresh && this._info) return this._info;
    this._info = await _get<Routes.datasets._account._dataset.services._serviceName.Get>({
      errorWithCleanerStack: getErr(
        `Failed to get information of service '${this._name}' in dataset '${(await this._dataset.getInfo()).name}'.`
      ),
      app: this._app,
      path: await this._getServicePath(),
    });
    return this._info;
  }

  public async isUpToDate(): Promise<boolean> {
    const info = await this.getInfo(true);
    return !info.outOfSync;
  }

  public async rename(newName: string): Promise<Service> {
    await _patch<Routes.datasets._account._dataset.services._serviceName.Patch>({
      errorWithCleanerStack: getErr(
        `Failed to rename service ${this._name} of dataset ${(await this._dataset.getInfo()).name}.`
      ),
      app: this._app,
      path: await this._getServicePath(),
      data: {
        name: newName,
      },
    });
    this._name = newName;
    return this;
  }

  public async getGraphs(refresh = false): Promise<Models.ServiceGraphInfo[]> {
    if (!this._graphs || refresh) {
      this._graphs = await _get<Routes.datasets._account._dataset.services._serviceName.graphs.Get>({
        errorWithCleanerStack: getErr(
          `Failed to get graphs of service ${this._name} of dataset ${(await this._dataset.getInfo()).name}.`
        ),
        app: this._app,
        path: `${await this._getServicePath()}/graphs`,
      });
    }
    return this._graphs;
  }

  public async delete() {
    this._info = await _delete<Routes.datasets._account._dataset.services._serviceName.Delete>({
      errorWithCleanerStack: getErr(
        `Failed to delete service ${this._name} of dataset ${(await this._dataset.getInfo()).name}.`
      ),
      app: this._app,
      path: await this._getServicePath(),
      expectedResponseBody: "empty",
    });
  }

  public async create(): Promise<Service> {
    try {
      await _post({
        errorWithCleanerStack: getErr(
          `Failed to create service '${this._name}' in dataset '${(await this._dataset.getInfo()).name}'.`
        ),
        app: this._app,
        path: `${await this._dataset["_getDatasetPath"]()}/services`,
        data: {
          name: this._name,
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
            throw getErr(
              `Failed to start service ${this._name} of dataset ${(await this._dataset.getInfo()).name}: ${
                info.error.message
              }`
            );
          }
        } else if (!["starting", "updating"].includes(info.status)) {
          throw getErr(
            `Failed to start service ${this._name} of dataset ${
              (await this._dataset.getInfo(true)).name
            } as it is being stopped or removed.`
          );
        } else {
          failedServiceErrorCount = 0;
        }
      }
      await wait(5000);
    }
  }

  public async update() {
    await _post({
      errorWithCleanerStack: getErr(
        `Failed to update service ${this._name} of dataset ${(await this._dataset.getInfo()).name}.`
      ),
      app: this._app,
      path: await this._getServicePath(),
      data: { sync: true },
    });
    await this.waitUntilRunning();
  }

  private async _getServicePath() {
    return `${await this._dataset["_getDatasetPath"]()}/services/${this._name}`;
  }

  public getDataset(): Dataset {
    return this._dataset;
  }
}
