import { Models, Routes } from "@triply/utils";
import App from "./App";
import { wait } from "./utils";
import { _get, _post, _delete } from "./RequestHandler";
import { getErr } from "./utils/Error";

export default class Service {
  private _app: App;
  private _info?: Models.Service;
  private datasetPath: string;
  private datasetNameWithOwner: string;
  private name: string;
  private type: Models.ServiceType;
  private reasoner?: Models.JenaReasoners;
  constructor(conf: {
    app: App;
    name: string;
    datasetPath: string;
    datasetNameWithOwner: string;
    type: Models.ServiceType;
    reasoner?: Models.JenaReasoners;
  }) {
    this._app = conf.app;
    this.name = conf.name;
    this.datasetPath = conf.datasetPath;
    this.datasetNameWithOwner = conf.datasetNameWithOwner;
    this.type = conf.type;
    this.reasoner = conf.reasoner;
  }

  public async getInfo(refresh = false): Promise<Models.Service> {
    if (!refresh && this._info) return this._info;
    this._info = await _get<Routes.datasets._account._dataset.services._serviceName.Get>({
      errorWithCleanerStack: getErr(
        `Failed to get information of service ${this.name} in dataset ${this.datasetNameWithOwner}.`
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
    this._info = await _delete<Routes.datasets._account._dataset.services._serviceName.Get>({
      errorWithCleanerStack: getErr(`Failed to delete service ${this.name} of dataset ${this.datasetNameWithOwner}.`),
      app: this._app,
      path: await this._getServicePath(),
      expectedResponseBody: "empty",
    });
  }

  public async create() {
    await _post({
      errorWithCleanerStack: getErr(`Failed to create service ${this.name} in dataset ${this.datasetNameWithOwner}.`),
      app: this._app,
      path: `${this.datasetPath}/services`,
      data: {
        name: this.name,
        type: this.type,
        config:
          this.type === "sparql-jena" && this.reasoner
            ? {
                reasonerType: this.reasoner,
              }
            : {},
      },
    });
    await this.waitUntilRunning();
    return this;
  }

  private async waitUntilRunning() {
    while (true) {
      await wait(5000);
      const info = await this.getInfo(true);
      if (info.status === "running") {
        return;
      } else if (info.error) {
        throw getErr(
          `Failed to start service ${this.name} of dataset ${this.datasetNameWithOwner}: ${info.error.message}`
        );
      }
    }
  }

  public async update() {
    await _post({
      errorWithCleanerStack: getErr(`Failed to update service ${this.name} of dataset ${this.datasetNameWithOwner}.`),
      app: this._app,
      path: await this._getServicePath(),
      data: { recreate: true },
    });
    await this.waitUntilRunning();
  }

  private async _getServicePath() {
    return `${this.datasetPath}/services/${this.name}`;
  }
}
