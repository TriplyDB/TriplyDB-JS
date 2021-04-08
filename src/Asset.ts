import { Models, Routes } from "@triply/utils";
import Dataset from "./Dataset";
import App from "./App";
import * as fs from "fs-extra";
import { _delete, _get } from "./RequestHandler";
import pumpify from "pumpify";
import fetch from "cross-fetch";
import { getErr } from "./utils/Error";

import { ReadStream } from "fs-extra";
import { omit, last } from "lodash";

const tus = require("@triply/tus-js-client");
export default class Asset {
  private _info: Models.Asset;
  private _app: App;
  private _dataset: Dataset;
  private _deleted = false;
  private _selectedVersion?: number;
  constructor(dataset: Dataset, info: Models.Asset, selectedVersion?: number) {
    this._info = info;
    this._dataset = dataset;
    this._app = dataset["_app"];
    if (selectedVersion !== undefined) {
      this.selectVersion(selectedVersion);
    }
  }

  private async _getUrl(versionInfo?: Models.AssetVersion) {
    if (this._deleted) throw getErr("This asset does not exist.");
    const urlparts = [
      this._app["_config"].url,
      await this._dataset["_getDatasetPath"](),
      "/assets",
      `/${this._info.identifier}`,
    ];
    if (versionInfo) urlparts.push(`/${versionInfo.id}`);
    return urlparts.join("");
  }

  public async toFile(destinationPath: string, versionNumber?: number) {
    if (this._deleted) throw getErr("This asset does not exist.");
    if (versionNumber === undefined) versionNumber = this._selectedVersion;
    const url = await this._getUrl(
      versionNumber === undefined ? this._getLastVersionInfo() : this.getVersionInfo(versionNumber)
    );
    const res = await fetch(url, { method: "get", headers: { authorization: `bearer ${this._app["_config"].token}` } });
    const stream = new pumpify(res.body as any, fs.createWriteStream(destinationPath));
    await new Promise((resolve, reject) => {
      stream.on("error", reject);
      stream.on("finish", resolve);
    });
  }
  public async toStream(versionNumber?: number) {
    if (this._deleted) throw getErr("This asset does not exist.");
    if (versionNumber === undefined) versionNumber = this._selectedVersion;
    const url = await this._getUrl(versionNumber === undefined ? undefined : this.getVersionInfo(versionNumber));
    const res = await fetch(url, { method: "get", headers: { authorization: `bearer ${this._app["_config"].token}` } });
    return (res.body as any) as NodeJS.WriteStream;
  }
  private _getLastVersionInfo() {
    if (this._deleted) throw getErr("This asset does not exist.");
    const lastVersion = last(this._info.versions);
    if (!lastVersion) throw getErr("This asset has no versions");
    return lastVersion;
  }
  public getVersionInfo(versionNumber: number) {
    if (this._deleted) throw getErr("This asset does not exist.");
    const version = this._info.versions[versionNumber];
    if (!version) throw getErr(`This asset has no version ${versionNumber}`);
    return version;
  }

  public getInfo(versionNumber?: number): Models.Asset & Omit<Models.AssetVersion, "id"> {
    if (this._deleted) throw getErr("This asset does not exist.");
    if (versionNumber === undefined) versionNumber = this._selectedVersion;
    let versionInfo = versionNumber === undefined ? this._getLastVersionInfo() : this.getVersionInfo(versionNumber);
    return { ...this._info, ...omit(versionInfo, "id") };
  }
  private async refreshInfo() {
    this._info = (await _get<Routes.datasets._account._dataset.assets.Get>({
      errorWithCleanerStack: getErr(
        `Failed to get refresh info for asset '${this._info.assetName}' from dataset ${await this._dataset[
          "_getDatasetNameWithOwner"
        ]()}.`
      ),
      app: this._app,
      path: await this._dataset["_getDatasetPath"]("/assets"),
      query: { fileName: this._info.assetName },
    })) as Models.Asset;
    return this;
  }
  public selectVersion(versionNumber: number) {
    if (!this.getInfo().versions[versionNumber])
      throw getErr(
        `Tried to select version ${versionNumber} but asset '${this.getInfo().assetName}' only has ${
          this.getInfo().versions.length
        } versions. (version numbering starts at 0) `
      );
    this._selectedVersion = versionNumber;
    return this;
  }
  public async addVersion(fileOrPath: File | string) {
    if (this._deleted) throw getErr("This asset does not exist.");
    await Asset.uploadAsset({ fileOrPath, dataset: this._dataset, versionOf: this._info.identifier });
    await this.refreshInfo();
    return this;
  }
  public async delete(versionNumber?: number) {
    if (this._deleted) throw getErr("This asset does not exist.");
    if (versionNumber === undefined) versionNumber = this._selectedVersion;
    const dsInfo = await this._dataset.getInfo();
    await _delete<Routes.datasets._account._dataset.assets._assetId.Delete>({
      app: this._app,
      url: await this._getUrl(versionNumber === undefined ? undefined : this.getVersionInfo(versionNumber)),
      errorWithCleanerStack: getErr(
        `Failed to delete asset ${this._info.assetName} in dataset ${dsInfo.owner.accountName}/${dsInfo.name}.`
      ),
      expectedResponseBody: "empty",
    });
    if (versionNumber === undefined || (versionNumber === 0 && this.getInfo().versions.length === 1)) {
      //deleting everything
      this._deleted = true;
    } else {
      if (this._selectedVersion !== undefined) {
        //update the selected version
        if (this._selectedVersion === versionNumber) {
          this._selectedVersion = undefined; //just use the latest
        } else if (this._selectedVersion > versionNumber) {
          this._selectedVersion = this._selectedVersion - 1;
        }
      }
      await this.refreshInfo();
      return this;
    }
  }

  private static async uploadAsset(opts: {
    fileOrPath: string | File;
    assetName?: string;
    dataset: Dataset;
    versionOf?: string;
  }) {
    let rs: ReadStream | File;
    let fileSize: number;
    if (typeof opts.fileOrPath === "string") {
      if (fs.createReadStream === undefined) {
        throw getErr('"fs" is not loaded in this environment, use a "File" instead');
      }
      rs = fs.createReadStream(opts.fileOrPath);
      fileSize = (await fs.stat(opts.fileOrPath)).size;
    } else {
      rs = opts.fileOrPath;
      fileSize = opts.fileOrPath.size;
    }

    const info = await opts.dataset.getInfo();
    return new Promise<Models.Asset>((resolve, reject) => {
      const upload = new tus.Upload(rs, {
        endpoint: `${opts.dataset["_app"]["_config"].url}/datasets/${info.owner.accountName}/${info.name}/assets/add`,
        resume: true,
        metadata: { filename: opts.assetName, versionOf: opts.versionOf },
        headers: { Authorization: "Bearer " + opts.dataset["_app"]["_config"].token },
        chunkSize: 5 * 1024 * 1024,
        retryDelays: [2000, 3000, 5000, 10000, 20000],
        uploadSize: fileSize,
        onError: (error: any) => reject(error),
        onProgress: (_bytesUploaded: number, _bytesTotal: number) => {},
        onSuccess: (stringifiedJson: string) => {
          if (stringifiedJson === "") return reject(getErr("No response or upload already finished"));
          resolve(JSON.parse(stringifiedJson));
        },
      });
      upload.start();
    });
  }
}
