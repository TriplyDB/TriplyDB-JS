import { Models, Routes } from "@triply/utils";
import App from "./App";
import { wait } from "./utils";
import { _get, _post, _delete, _patch } from "./RequestHandler";
import { getErr, TriplyDbJsError } from "./utils/Error";
import { ServiceMetadataV1 } from "@triply/utils/lib/Models";
import Dataset from "./Dataset";

export default class Service {
  private _app: App;
  private _info?: Models.ServiceV1 | Models.ServiceMetadataV2;
  private _graphs?: Models.ServiceGraphInfoV2[];
  private _dataset: Dataset;
  private _name: string;
  private _type: Models.ServiceTypeV1 | Models.ServiceTypeV2;
  private _reasoner?: Models.JenaReasoner;
  public readonly type = "Service";
  constructor(conf: {
    app: App;
    name: string;
    dataset: Dataset;
    type: Models.ServiceTypeV1 | Models.ServiceTypeV2;
    reasoner?: Models.JenaReasoner;
  }) {
    this._app = conf.app;
    this._name = conf.name;
    this._dataset = conf.dataset;
    this._type = conf.type;
    this._reasoner = conf.reasoner;
  }

  public async getInfo(refresh = false): Promise<Models.ServiceV1 | Models.ServiceMetadataV2> {
    if (!refresh && this._info) return this._info;
    this._info = await _get<
      | Routes.datasets._account._dataset.servicesV1._serviceName.Get
      | Routes.datasets._account._dataset.services._serviceName.Get
    >({
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

  isV1Service() {
    return this._type === "sparql-jena" || this._type === "sparql" || this._type === "elasticsearch";
  }

  public async rename(newName: string): Promise<Service> {
    if (this.isV1Service()) {
      throw getErr(`This TriplyDB API does not support renaming a service.`);
    }
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

  public async getGraphs(refresh = false): Promise<Models.ServiceGraphInfoV2[] | Models.ServiceGraphsInfoV1> {
    if (this.isV1Service()) {
      return ((await this.getInfo(refresh)) as ServiceMetadataV1).graphs;
    }
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
    this._info = await _delete<
      | Routes.datasets._account._dataset.servicesV1._serviceName.Delete
      | Routes.datasets._account._dataset.services._serviceName.Delete
    >({
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
          config:
            (this._type === "sparql-jena" || this._type === "jena") && this._reasoner
              ? {
                  reasonerType: this._reasoner,
                }
              : {},
        },
      });
    } catch (e) {
      if (
        e instanceof TriplyDbJsError &&
        e.statusCode === 400 &&
        (e.message.indexOf("Service of type") >= 0 || e.message.indexOf("Invalid service type") >= 0)
      ) {
        this._type = this._convertServiceVersionTypes(this._type);
        return this.create();
      } else {
        throw e;
      }
    }
    await this.waitUntilRunning();
    return this;
  }

  public async stop(): Promise<Service> {
    await _post({
      app: this._app,
      errorWithCleanerStack: getErr(
        `Failed to stop service ${this._name} in dataset ${(await this._dataset.getInfo()).name}.`
      ),
      data: { stop: true },
      path: await this._getServicePath(),
    });
    await this.waitUntilStopped();
    return this;
  }
  public async start(): Promise<Service> {
    await _post({
      app: this._app,
      errorWithCleanerStack: getErr(
        `Failed to resume the stopped service ${this._name} in dataset ${(await this._dataset.getInfo()).name}.`
      ),
      data: { start: true },
      path: await this._getServicePath(),
    });
    return this;
  }

  public async waitUntilRunning() {
    while (true) {
      const info = await this.getInfo(true);
      if (info.status === "running") {
        break;
      } else if (info.error) {
        throw getErr(
          `Failed to start service ${this._name} of dataset ${(await this._dataset.getInfo()).name}: ${
            info.error.message
          }`
        );
      } else if (!["starting", "updating"].includes(info.status)) {
        throw getErr(
          `Failed to start service ${this._name} of dataset ${
            (await this._dataset.getInfo(true)).name
          } as it is being stopped or removed.`
        );
      }
      await wait(5000);
    }
  }

  private async waitUntilStopped() {
    let running = true;
    while (running) {
      const info = await this.getInfo(true);
      if (info.status === "stopped") {
        running = false;
        continue;
      } else if (info.error) {
        throw getErr(
          `Failed to stop service ${this._name} of dataset ${(await this._dataset.getInfo()).name}: ${
            info.error.message
          }`
        );
      }
      await wait(1000);
    }
    return;
  }

  public async update() {
    await _post({
      errorWithCleanerStack: getErr(
        `Failed to update service ${this._name} of dataset ${(await this._dataset.getInfo()).name}.`
      ),
      app: this._app,
      path: await this._getServicePath(),
      data: this.isV1Service() ? { recreate: true } : { sync: true },
    });
    await this.waitUntilRunning();
  }

  private async _getServicePath() {
    return `${await this._dataset["_getDatasetPath"]()}/services/${this._name}`;
  }
  /**
   * Converts service version types from v1 to v2 and from v2 to v1
   * This ensures interoperability between service types. And we can start using the new types for old instances
   * @param type
   * @returns converted service type
   */
  private _convertServiceVersionTypes(
    type: Models.ServiceTypeV1 | Models.ServiceTypeV2
  ): Models.ServiceTypeV1 | Models.ServiceTypeV2 {
    switch (type) {
      case "elasticsearch":
        return "elasticSearch";
      case "elasticSearch":
        return "elasticsearch";
      case "sparql":
        return "virtuoso";
      case "virtuoso":
        return "sparql";
      case "sparql-jena":
        return "jena";
      case "jena":
        return "sparql-jena";
    }
    throw getErr("Unknown Service type");
  }
}
