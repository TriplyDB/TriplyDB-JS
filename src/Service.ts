import { Models, Routes } from "@triply/utils";
import App from "./App";
import { wait } from "./utils";
import { _get, _post, _delete } from "./RequestHandler";
import { getErr } from "./utils/Error";

export default class Service {
  private _app: App;
  private _info?: Models.ServiceV1;
  private _datasetPath: string;
  private _datasetNameWithOwner: string;
  private _name: string;
  private _type: Models.ServiceTypeV1;
  private _reasoner?: Models.JenaReasoners;
  public readonly type = "Service";
  constructor(conf: {
    app: App;
    name: string;
    datasetPath: string;
    datasetNameWithOwner: string;
    type: Models.ServiceTypeV1;
    reasoner?: Models.JenaReasoners;
  }) {
    this._app = conf.app;
    this._name = conf.name;
    this._datasetPath = conf.datasetPath;
    this._datasetNameWithOwner = conf.datasetNameWithOwner;
    this._type = conf.type;
    this._reasoner = conf.reasoner;
  }

  public async getInfo(refresh = false): Promise<Models.ServiceV1> {
    if (!refresh && this._info) return this._info;
    this._info = await _get<Routes.datasets._account._dataset.servicesV1._serviceName.Get>({
      errorWithCleanerStack: getErr(
        `Failed to get information of service ${this._name} in dataset ${this._datasetNameWithOwner}.`
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

  public async delete() {
    this._info = await _delete<Routes.datasets._account._dataset.servicesV1._serviceName.Get>({
      errorWithCleanerStack: getErr(`Failed to delete service ${this._name} of dataset ${this._datasetNameWithOwner}.`),
      app: this._app,
      path: await this._getServicePath(),
      expectedResponseBody: "empty",
    });
  }

  public async create() {
    await _post({
      errorWithCleanerStack: getErr(`Failed to create service ${this._name} in dataset ${this._datasetNameWithOwner}.`),
      app: this._app,
      path: `${this._datasetPath}/services`,
      data: {
        name: this._name,
        type: this._type,
        config:
          this._type === "sparql-jena" && this._reasoner
            ? {
                reasonerType: this._reasoner,
              }
            : {},
      },
    });
    await this.waitUntilRunning();
    return this;
  }

  public async waitUntilRunning() {
    while (true) {
      const info = await this.getInfo(true);
      if (info.status === "running") {
        return;
      } else if (info.error) {
        throw getErr(
          `Failed to start service ${this._name} of dataset ${this._datasetNameWithOwner}: ${info.error.message}`
        );
      } else if (!["starting", "updating"].includes(info.status)) {
        throw getErr(
          `Failed to start service ${this._name} of dataset ${this._datasetNameWithOwner} as it is being stopped or removed.`
        );
      }
      await wait(5000);
    }
  }

  public async update() {
    await _post({
      errorWithCleanerStack: getErr(`Failed to update service ${this._name} of dataset ${this._datasetNameWithOwner}.`),
      app: this._app,
      path: await this._getServicePath(),
      data: { sync: true },
    });
    await this.waitUntilRunning();
  }

  private async _getServicePath() {
    return `${this._datasetPath}/services/${this._name}`;
  }
}
