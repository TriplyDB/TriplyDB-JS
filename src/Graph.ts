import { Models, Routes } from "@triply/utils";
import App from "./App";
import { _delete, _patch, _get } from "./RequestHandler";
import Dataset from "./Dataset";
import * as n3 from "n3";

import stream from "stream";
import { getErr } from "./utils/Error";

export default class Graph {
  private _info: Models.Graph;
  private _app: App;
  private _dataset: Dataset;
  public readonly type = "Graph";

  constructor(dataset: Dataset, info: Models.Graph) {
    this._app = dataset["_app"];
    this._info = info;
    this._dataset = dataset;
  }

  public async toFile(destinationPath: string, opts?: { compressed?: boolean }) {
    return this._dataset.graphsToFile(destinationPath, { ...opts, graph: this });
  }
  public async toStore(): Promise<n3.Store> {
    return this._dataset.graphsToStore(this);
  }
  public async toStream(type: "compressed" | "rdf-js"): Promise<stream.Readable> {
    return this._dataset.graphsToStream(type, { graph: this });
  }

  public async getInfo(refresh = false) {
    if (refresh)
      this._info = await _get<Routes.datasets._account._dataset.graphs._graphId.Get>({
        errorWithCleanerStack: getErr(
          `Failed to get graph information for dataset ${await this._dataset["_getDatasetNameWithOwner"]()}.`
        ),
        app: this._app,
        path: await this._getPath(),
      });
    return this._info;
  }

  private async _getPath() {
    return (await this._dataset["_getDatasetPath"]()) + "/graphs/" + this._info.id;
  }

  public async delete() {
    const info = await this.getInfo();
    await _delete<Routes.datasets._account._dataset.graphs._graphId.Delete>({
      errorWithCleanerStack: getErr(
        `Failed to delete graph '${info.graphName}' from ${await this._dataset["_getDatasetNameWithOwner"]()}.`
      ),
      app: this._app,
      path: await this._getPath(),
      expectedResponseBody: "empty",
    });
  }

  public async rename(newGraphName: string) {
    if (newGraphName === this._info.graphName) return;
    const info = await this.getInfo();
    this._info = await _patch<Routes.datasets._account._dataset.graphs._graphId.Patch>({
      errorWithCleanerStack: getErr(
        `Failed to rename graph ${info.graphName} to ${newGraphName} for dataset ${await this._dataset[
          "_getDatasetNameWithOwner"
        ]()}.`
      ),
      app: this._app,
      path: await this._getPath(),
      data: <Routes.datasets._account._dataset.graphs._graphId.Patch["Req"]["Body"]>{ graphName: newGraphName },
    });
    return this;
  }
}
