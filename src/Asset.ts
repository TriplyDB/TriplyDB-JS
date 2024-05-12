import { Models, Routes } from "@triply/utils";
import * as tus from "@triply/tus-js-client";
import Dataset from "./Dataset.js";
import App from "./App.js";
import { _delete, _get, getFetchOpts } from "./RequestHandler.js";
import pumpify from "pumpify";
import fetch from "cross-fetch";
import { getErr } from "./utils/Error.js";
import fs from "fs-extra";
import { omit, last } from "lodash-es";
import { formatUploadProgress, setStickySessionCookie } from "./utils/index.js";
import debug from "debug";
const log = debug("triply:triplydb-js:asset-upload");

export default class Asset {
  private _info: Models.Asset;
  public app: App;
  public dataset: Dataset;
  private _deleted = false;
  private _selectedVersion?: number;
  public readonly type = "Asset";
  constructor(dataset: Dataset, info: Models.Asset, selectedVersion?: number) {
    this._info = info;
    this.dataset = dataset;
    this.app = dataset.app;
    if (selectedVersion !== undefined) {
      this.selectVersion(selectedVersion);
    }
  }

  public get api() {
    if (this._deleted) throw getErr("This asset does not exist.");
    const path = `${this.dataset.api.path}/assets/${this._info.identifier}`;
    return {
      url: this.app.url + path,
      path,
    };
  }

  private async _getUrl(versionInfo?: Models.AssetVersion) {
    if (this._deleted) throw getErr("This asset does not exist.");
    if (versionInfo) return `${this.api.url}/${versionInfo.id}`;
    return this.api.url;
  }

  public async toFile(destinationPath: string, versionNumber?: number) {
    if (this._deleted) throw getErr("This asset does not exist.");
    if (versionNumber === undefined) versionNumber = this._selectedVersion;
    const url = await this._getUrl(
      versionNumber === undefined ? this._getLastVersionInfo() : this.getVersionInfo(versionNumber),
    );
    const res = await fetch(
      url,
      getFetchOpts(
        {
          method: "get",
        },
        { app: this.app },
      ),
    );
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
    const res = await fetch(
      url,
      getFetchOpts(
        {
          method: "get",
        },
        { app: this.app },
      ),
    );
    return res.body as any as NodeJS.WriteStream;
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
        `Failed to get refresh info for asset '${this._info.assetName}' from dataset ${this.dataset[
          "_getDatasetNameWithOwner"
        ]()}.`,
      ),
      app: this.app,
      path: this.dataset.api.path + "/assets",
      query: { fileName: this._info.assetName },
    })) as Models.Asset;
    return this;
  }
  public selectVersion(versionNumber: number) {
    if (!this.getInfo().versions[versionNumber])
      throw getErr(
        `Tried to select version ${versionNumber} but asset '${this.getInfo().assetName}' only has ${
          this.getInfo().versions.length
        } versions. (version numbering starts at 0) `,
      );
    this._selectedVersion = versionNumber;
    return this;
  }
  public async addVersion(fileOrPath: File | string) {
    if (this._deleted) throw getErr("This asset does not exist.");
    await Asset.uploadAsset({
      fileOrPath,
      assetName: this._info.assetName,
      dataset: this.dataset,
      versionOf: this._info.identifier,
    });
    await this.refreshInfo();
    return this;
  }
  public async delete(versionNumber?: number) {
    if (this._deleted) throw getErr("This asset does not exist.");
    if (versionNumber === undefined) versionNumber = this._selectedVersion;
    await _delete<Routes.datasets._account._dataset.assets._assetId.Delete>({
      app: this.app,
      url: await this._getUrl(versionNumber === undefined ? undefined : this.getVersionInfo(versionNumber)),
      errorWithCleanerStack: getErr(
        `Failed to delete asset ${this._info.assetName} in dataset ${this.dataset.owner.slug}/${this.dataset.slug}.`,
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
    let rs: fs.ReadStream | File;
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

    const metadata: {
      filename?: string;
      versionOf?: string;
    } = {};
    if (opts.assetName) metadata.filename = opts.assetName;
    if (opts.versionOf) metadata.versionOf = opts.versionOf;

    // we want to try to get a sticky session cookie for TUS uploads
    const headers: { [name: string]: string } = { Authorization: "Bearer " + opts.dataset.app["_config"].token };
    await setStickySessionCookie(headers, opts.dataset.app.url);

    let previousChunkCompleted = Date.now();
    return new Promise<Models.Asset>((resolve, reject) => {
      const upload = new tus.Upload(rs, {
        endpoint: `${opts.dataset.api.url}/assets/add`,
        metadata,
        headers,
        chunkSize: 5 * 1024 * 1024,
        retryDelays: [2000, 3000, 5000, 10000, 20000],
        uploadSize: fileSize,
        onError: reject,
        onChunkComplete: function (...stats) {
          log(formatUploadProgress(Date.now() - previousChunkCompleted, ...stats));
          previousChunkCompleted = Date.now();
        },
        onSuccess: (stringifiedJson: string) => {
          if (stringifiedJson === "") return reject(getErr("No response or upload already finished"));
          try {
            resolve(JSON.parse(stringifiedJson));
          } catch (e) {
            if (e instanceof SyntaxError) {
              return reject(getErr(`Unexpected response: ${stringifiedJson}`).setCause(e));
            }
            return reject(e);
          }
        },
      });
      upload.start();
    });
  }
}
