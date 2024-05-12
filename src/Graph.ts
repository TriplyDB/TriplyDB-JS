import { Models, Routes } from "@triply/utils";
import App from "./App.js";
import { _delete, _patch, _get } from "./RequestHandler.js";
import Dataset from "./Dataset.js";
import * as n3 from "n3";

import stream from "stream";
import { getErr } from "./utils/Error.js";

export default class Graph {
  private _info: Models.Graph;
  public app: App;
  public dataset: Dataset;
  public readonly type = "Graph";

  constructor(dataset: Dataset, info: Models.Graph) {
    this.app = dataset.app;
    this._info = info;
    this.dataset = dataset;
  }

  public async toFile(destinationPath: string, opts?: { compressed?: boolean }) {
    return this.dataset.graphsToFile(destinationPath, { ...opts, graph: this });
  }
  public async toStore(): Promise<n3.Store> {
    return this.dataset.graphsToStore(this);
  }
  public async toStream(type: "compressed" | "rdf-js"): Promise<stream.Readable> {
    return this.dataset.graphsToStream(type, { graph: this });
  }

  public async getInfo(refresh = false) {
    if (refresh)
      this._info = await _get<Routes.datasets._account._dataset.graphs._graphId.Get>({
        errorWithCleanerStack: getErr(
          `Failed to get graph information for dataset ${this.dataset["_getDatasetNameWithOwner"]()}.`,
        ),
        app: this.app,
        path: this.api.path,
      });
    return this._info;
  }
  public get api() {
    const path = this.dataset.api.path + "/graphs/" + this._info.id;
    return {
      url: this.app.url + path,
      path,
    };
  }

  public async delete() {
    const info = await this.getInfo();
    await _delete<Routes.datasets._account._dataset.graphs._graphId.Delete>({
      errorWithCleanerStack: getErr(
        `Failed to delete graph '${info.graphName}' from ${this.dataset["_getDatasetNameWithOwner"]()}.`,
      ),
      app: this.app,
      path: this.api.path,
      expectedResponseBody: "empty",
    });
  }

  public async rename(newGraphName: string) {
    if (newGraphName === this._info.graphName) return;
    const info = await this.getInfo();
    this._info = await _patch<Routes.datasets._account._dataset.graphs._graphId.Patch>({
      errorWithCleanerStack: getErr(
        `Failed to rename graph ${info.graphName} to ${newGraphName} for dataset ${this.dataset[
          "_getDatasetNameWithOwner"
        ]()}.`,
      ),
      app: this.app,
      path: this.api.path,
      data: <Routes.datasets._account._dataset.graphs._graphId.Patch["Req"]["Body"]>{ graphName: newGraphName },
    });
    return this;
  }
}
