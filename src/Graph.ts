import { Models, Routes } from "@triply/utils";
import App from "./App";
import { _delete, _patch, _get, handleFetchAsStream } from "./RequestHandler";
import Dataset from "./Dataset";
import * as n3 from "n3";
import fetch from "cross-fetch";
import fs from "fs-extra";

import * as zlib from "zlib";
import pumpify from "pumpify";
import * as path from "path";
import stream from "stream";
import { getErr } from "./utils/Error";

export const SUPPORTED_EXTENSIONS = [".trig", ".nt", ".ttl", ".trig.gz", ".nt.gz", ".ttl.gz"] as const;

export default class Graph {
  private _info: Models.Graph;
  private _app: App;
  private _dataset: Dataset;

  constructor(dataset: Dataset, info: Models.Graph) {
    this._app = dataset["_app"];
    this._info = info;
    this._dataset = dataset;
  }

  public async toFile(destinationPath: string, opts?: { compressed?: boolean }) {
    const parsedPath = path.parse(destinationPath);
    if (SUPPORTED_EXTENSIONS.findIndex((e) => parsedPath.base.endsWith(e)) === -1) {
      throw getErr(
        `Failed so save graph as \`${parsedPath.base}\`. Supported extensions: [ ${SUPPORTED_EXTENSIONS.join(", ")} ]`
      );
    }
    if (!(await fs.pathExists(path.resolve(parsedPath.dir)))) {
      throw getErr(`Directory doesn't exist: ${parsedPath.dir}`);
    }
    let extension = parsedPath.ext;
    let storeCompressed: boolean;
    if (typeof opts?.compressed === "boolean") {
      storeCompressed = opts.compressed;
    } else {
      storeCompressed = extension === ".gz";
    }

    if (extension === ".gz") {
      extension = `${path.extname(parsedPath.name)}${extension}`;
    }

    const url = await this._getDownloadUrl(extension);
    const res = await fetch(url, {
      method: "get",
      compress: false,
      headers: { authorization: `bearer ${this._app["_config"].token}` },
    } as any);
    if (res.status >= 400) {
      throw getErr(`Failed to download graph ${this._info.graphName}: [#${res.status}] ${res.statusText}`);
    }
    const stream = new pumpify(
      res.body as any,
      // we always download compressed version. Decompress unless the user saves as *.gz
      ...(storeCompressed ? [] : [zlib.createGunzip()]),
      fs.createWriteStream(destinationPath)
    );
    await new Promise((resolve, reject) => {
      stream.on("error", reject);
      stream.on("finish", resolve);
    });
  }
  public async toStore(): Promise<n3.Store> {
    const store = new n3.Store();
    const stream = await this.toStream("rdf-js");
    await new Promise((resolve, reject) => {
      store.import(stream).on("finish", resolve).on("error", reject);
    });
    return store;
  }
  public async toStream(type: "compressed" | "rdf-js"): Promise<stream.Readable> {
    const stream = await handleFetchAsStream("GET", {
      app: this._app,
      url: await this._getDownloadUrl(".trig.gz"),
      errorWithCleanerStack: getErr(`Failed to download graph ${this._info.graphName}`),
    });
    if (type === "compressed") {
      return stream as any;
    }
    return new pumpify.obj(stream as any, zlib.createGunzip(), new n3.StreamParser());
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
  //Extension comes from a path.parse method, so we can trust it to start with a `.`
  private async _getDownloadUrl(extension?: string) {
    const dsPath = `${this._app["_config"].url}${await this._dataset["_getDatasetPath"]()}`;
    return `${dsPath}/download${extension || ""}?graph=${encodeURIComponent(this._info.graphName)}`;
  }

  private async _getPath() {
    return (await this._dataset["_getDatasetPath"]()) + "/graphs/" + this._info.id;
  }

  public async delete() {
    const info = await this.getInfo();
    await _delete<Routes.datasets._account._dataset.graphs._graphId.Delete>({
      errorWithCleanerStack: getErr(
        `Failed to graph ${info.graphName} from ${await this._dataset["_getDatasetNameWithOwner"]()}.`
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
