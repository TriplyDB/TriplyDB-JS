import { Models, Routes } from "@triply/utils";
import App from "./App";
import * as fs from "fs-extra";
import { wait } from "./utils";
import debug from "debug";
import Service from "./Service";
const log = debug("triply:triplydb-js:upload");
const tus = require("@triply/tus-js-client");
import md5 from "md5";
import { tmpdir } from "os";
import * as stream from "stream";
import path from "path";
import * as zlib from "zlib";
import * as n3 from "n3";
import pumpify from "pumpify";
import { Account } from "./Account";
import { fromPairs, toPairs, pick, size, uniq, zipObject } from "lodash";
import { TriplyDbJsError, getErr, IncompatibleError } from "./utils/Error";
import { _get, _delete, _patch, _post, handleFetchAsStream, getUrl } from "./RequestHandler";
import { ReadStream } from "fs-extra";
import AsyncIteratorHelper from "./utils/AsyncIteratorHelper";
import Asset from "./Asset";
import Graph, { SUPPORTED_EXTENSIONS } from "./Graph";
import { stringify as stringifyQueryObj } from "query-string";
import fetch from "cross-fetch";
import { NamedNode } from "rdf-js";
interface JobDefaultsConfig {
  defaultGraphName?: string;
  baseIRI?: string;
  overwriteAll?: boolean;
}

type DsResourceType = "assets" | "graphs" | "services";
type ImportOpts = { fromDataset: Dataset; graphs?: { [from: string]: string }; overwrite?: boolean };
export default class Dataset {
  private _app: App;
  private _info?: Models.Dataset;
  private _owner: Account;
  private lastJob?: JobUpload;
  private _name: string;
  private allPrefixes: { [prefixLabel: string]: string } | undefined;
  constructor(app: App, owner: Account, datasetName: string, datasetInfo?: Models.Dataset) {
    this._app = app;
    this._name = datasetName;
    this._owner = owner;
    this._info = datasetInfo;
  }

  public getServices() {
    return new AsyncIteratorHelper<Models.ServiceMetadata, Service>({
      error: getErr(`Failed to get services`),
      getErrorMessage: async () => `Failed to get services for dataset ${await this._getDatasetNameWithOwner()}.`,
      app: this._app,
      getUrl: async () => this._app["_config"].url + (await this._getDatasetPath("/services")),
      mapResult: async (info: Models.Service) => {
        return new Service({
          app: this._app,
          datasetPath: await this._getDatasetPath(),
          datasetNameWithOwner: await this._getDatasetNameWithOwner(),
          name: info.name,
          type: info.type,
          reasoner: info.config?.reasonerType,
        });
      },
    });
  }

  /** @deprecated Use ds.clear('graphs') instead. */
  public removeAllGraphs() {
    return this.clear("graphs");
  }

  public async clear(resourceType: DsResourceType, ...rest: DsResourceType[]) {
    await Promise.all(
      uniq(rest.concat(resourceType)).map(async (typeToClear) => {
        if (typeToClear === "graphs") {
          return _delete({
            errorWithCleanerStack: getErr(`Failed to remove all graphs for ${await this._getDatasetNameWithOwner()}.`),
            app: this._app,
            path: await this._getDatasetPath("/graphs"),
            expectedResponseBody: "empty",
          });
        } else if (typeToClear === "assets") {
          for await (let asset of this.getAssets()) await asset?.delete();
        } else if (typeToClear === "services") {
          for await (let service of this.getServices()) await service?.delete();
        } else {
          throw getErr(`Unrecognized resource type: ${typeToClear}`);
        }
      })
    );
    await this.getInfo(true);
    return this;
  }

  public async exists(): Promise<boolean> {
    try {
      await this.getInfo();
      return true;
    } catch (e) {
      if (e.statusCode === 404) return false;
      throw e;
    }
  }
  public async getGraph(graphNameOrIri: string | NamedNode) {
    const graphName = typeof graphNameOrIri === "string" ? graphNameOrIri : graphNameOrIri.value;
    for await (let graph of this.getGraphs()) {
      if (!graph) break;
      if ((await graph.getInfo()).graphName === graphName) return graph;
    }
    throw getErr(`Graph '${graphName}' not found in dataset ${await this._getDatasetNameWithOwner()}`);
  }
  public async deleteGraph(graphNameOrIri: string | NamedNode) {
    const graphName = typeof graphNameOrIri === "string" ? graphNameOrIri : graphNameOrIri.value;
    const graph = await this.getGraph(graphName);
    await graph.delete();
  }
  private _setInfo(info: Models.Dataset) {
    this._info = info;
    this._name = info.name;
    return this;
  }
  private async _getDatasetPath(additionalPath?: string) {
    const ownerName = await this._owner.getName();
    return "/datasets/" + ownerName + "/" + this._name + (additionalPath || "");
  }
  private async _getDatasetNameWithOwner() {
    const ownerName = await this._owner.getName();
    return `${ownerName}/${this._name}`;
  }
  public async getInfo(refresh = false): Promise<Models.Dataset> {
    if (!refresh && this._info) return this._info;
    const info = await _get<Routes.datasets._account._dataset.Get>({
      errorWithCleanerStack: getErr(`Failed to get dataset information for ${await this._getDatasetNameWithOwner()}.`),
      app: this._app,
      path: await this._getDatasetPath(),
    });
    this._setInfo(info);
    return info;
  }
  public async getAsset(assetName: string, versionNumber?: number) {
    return new Asset(
      this,
      (await _get<Routes.datasets._account._dataset.assets.Get>({
        errorWithCleanerStack: getErr(
          `Failed to get asset ${assetName} from dataset ${await this._getDatasetNameWithOwner()}.`
        ),
        app: this._app,
        path: await this._getDatasetPath("/assets"),
        query: { fileName: assetName },
      })) as Models.Asset,
      versionNumber
    );
  }
  public getAssets() {
    return new AsyncIteratorHelper<Models.Asset, Asset>({
      error: getErr(`Failed to get assets`),
      getErrorMessage: async () => `Failed to get assets of dataset ${await this._getDatasetNameWithOwner()}.`,
      app: this._app,
      getUrl: async () => this._app["_config"].url + (await this._getDatasetPath("/assets")),
      mapResult: async (assetInfo) => new Asset(this, assetInfo),
    });
  }
  public getGraphs() {
    return new AsyncIteratorHelper<Models.Graph, Graph>({
      error: getErr(`Failed to get graphs`),
      getErrorMessage: async () => `Failed to get graphs of dataset ${await this._getDatasetNameWithOwner()}.`,
      app: this._app,
      getUrl: async () => this._app["_config"].url + (await this._getDatasetPath("/graphs")),
      mapResult: async (info) => new Graph(this, info),
    });
  }

  //Extension comes from a path.parse method, so we can trust it to start with a `.`
  private async _getDownloadPath(extension?: string) {
    const dsPath = `${await this._getDatasetPath()}`;
    return `${dsPath}/download${extension || ""}`;
  }
  public async graphsToFile(destinationPath: string, opts?: { compressed?: boolean }) {
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
      extension = path.extname(parsedPath.name);
    }
    const downloadUrlPath = await this._getDownloadPath(extension);
    const res = await fetch(
      getUrl({ app: this._app, errorWithCleanerStack: getErr("Failed to download graphs"), path: downloadUrlPath }),
      { method: "get", compress: false, headers: { authorization: `bearer ${this._app["_config"].token}` } } as any
    );
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
  public async graphsToStream(type: "compressed" | "rdf-js"): Promise<stream.Readable> {
    const stream = await handleFetchAsStream("GET", {
      app: this._app,
      path: await this._getDownloadPath(".trig.gz"),
      errorWithCleanerStack: getErr(`Failed to download graphs of dataset ${await this._getDatasetNameWithOwner()}.`),
    });
    if (type === "compressed") {
      return stream as any;
    } else {
      return new pumpify.obj(stream as any, zlib.createGunzip(), new n3.StreamParser());
    }
  }
  public async graphsToStore(): Promise<n3.Store> {
    const store = new n3.Store();
    const stream = await this.graphsToStream("rdf-js");
    await new Promise((resolve, reject) => {
      store.import(stream).on("finish", resolve).on("error", reject);
    });
    return store;
  }

  // NB: deprecation flag over the top-most header will apply to all the headers.
  // So keep any deprecated functions as not the top-most one.
  public async importFromDataset(opts: ImportOpts): Promise<Models.Imports>;
  /**
   * @deprecated This method interface will be removed in a future version. Use importFromDataset({...opts}) instead.
   */
  public async importFromDataset(
    opts: Dataset,
    graphs: { [from: string]: string },
    overwrite?: boolean
  ): Promise<Models.Imports>;
  public async importFromDataset(
    arg1: ImportOpts | Dataset,
    graphs_deprecated?: { [from: string]: string },
    overwrite_deprecated?: boolean
  ): Promise<Models.Imports> {
    let { fromDataset, graphs, overwrite } =
      "fromDataset" in arg1
        ? arg1
        : {
            fromDataset: arg1,
            graphs: graphs_deprecated,
            overwrite: !!overwrite_deprecated,
          };

    if (overwrite && !(await this._app.isCompatible("2.2.7"))) {
      throw new IncompatibleError("Overwriting graphs is only supported by TriplyDB API version 2.2.7 or greater");
    }
    if (!graphs) {
      // import all the graphs, keeping the original names.
      const graphNames = await Promise.all(
        (await fromDataset.getGraphs().toArray()).map((g) => g.getInfo().then((g) => g.graphName))
      );
      graphs = zipObject(graphNames, graphNames);
    }

    const fromDsInfo = await fromDataset.getInfo();
    const graphsToImport: Models.UpdateImport["graphs"] = [];
    for (const fromGraph in graphs) {
      graphsToImport.push({ from: fromGraph, to: graphs[fromGraph], overwrite: !!overwrite });
    }

    return _patch<Routes.datasets._account._dataset.imports.Patch>({
      errorWithCleanerStack: getErr(
        `Tried importing from dataset ${await fromDataset._getDatasetNameWithOwner()}. Failed to write the changes to ${await this._getDatasetNameWithOwner()}.`
      ),
      app: this._app,
      path: await this._getDatasetPath("/imports"),
      data: <Models.UpdateImports>[
        {
          dataset: {
            ownerName: fromDsInfo.owner.accountName,
            datasetName: fromDsInfo.name,
          },
          graphs: graphsToImport,
        },
      ],
    });
  }

  public async update(config: Models.UpdateDataset) {
    this._setInfo(
      await _patch<Routes.datasets._account._dataset.Patch>({
        errorWithCleanerStack: getErr(
          `Failed to update dataset information of ${await this._getDatasetNameWithOwner()}.`
        ),
        app: this._app,
        path: await this._getDatasetPath(),
        data: config,
      })
    );
    return this;
  }

  public async copy(toAccountName: string, newDatasetName?: string) {
    const newDs = await _post<Routes.datasets._account._dataset.copy.Post>({
      errorWithCleanerStack: getErr(
        `Failed to copy dataset ${await this._getDatasetNameWithOwner()} to ${toAccountName}.`
      ),
      app: this._app,
      path: await this._getDatasetPath("/copy"),
      data: { toAccount: toAccountName, name: newDatasetName },
    });
    const toAccount = await this._app.getAccount(toAccountName);
    return toAccount.getDataset(newDs.name)._setInfo(newDs);
  }

  public async renameGraph(from: string, to: string) {
    const graph = await this.getGraph(from);
    await graph.rename(to);
    return graph;
  }

  public async delete() {
    await _delete<Routes.datasets._account._dataset.Delete>({
      errorWithCleanerStack: getErr(`Failed to delete dataset ${await this._getDatasetNameWithOwner()}.`),
      app: this._app,
      path: await this._getDatasetPath(),
      expectedResponseBody: "empty",
    });
    this._info = undefined;
    this.lastJob = undefined;
  }
  public async setAvatar(pathBufferOrFile: string | Buffer | File) {
    const info = await this.getInfo();
    await _post({
      errorWithCleanerStack: getErr(`Failed to set avatar of dataset ${await this._getDatasetNameWithOwner()}.`),
      app: this._app,
      path: "/imgs/avatars/d/" + info.id,
      attach: { avatar: pathBufferOrFile },
    });
    await this.getInfo(true);
    return this;
  }
  private _throwIfJobRunning(dsId: string) {
    if (datasetsWithOngoingJob[dsId]) {
      throw getErr("There is already an ongoing job for this dataset. Await that one first.");
    }
  }
  public async importFromFiles(...files: File[]): Promise<Dataset>;
  public async importFromFiles(...files: string[]): Promise<Dataset>;
  public async importFromFiles(defaultsConfig: JobDefaultsConfig, ...files: string[] | File[]): Promise<Dataset>;
  public async importFromFiles(arg1: unknown, ...files: unknown[]): Promise<Dataset> {
    const dsId = await this.getInfo().then((info) => info.id);
    this._throwIfJobRunning(dsId);
    try {
      datasetsWithOngoingJob[dsId] = true;
      let baseIRI: string | undefined;
      let defaultGraphName: string | undefined;
      let overwriteAll: boolean | undefined;
      if (typeof arg1 === "string") {
        // we have just a list of filenames, no defaults config.
        files = [arg1].concat(files as string[]);
      } else if ("name" in (arg1 as File)) {
        // we have just a list of Files, no defaults config.
        files = [arg1].concat(files);
      } else {
        // the first arg is a defaults config.
        baseIRI = (arg1 as JobDefaultsConfig).baseIRI;
        defaultGraphName = (arg1 as JobDefaultsConfig).defaultGraphName;
        overwriteAll = (arg1 as JobDefaultsConfig).overwriteAll;
      }
      if (overwriteAll && !(await this._app.isCompatible("2.2.7"))) {
        throw new IncompatibleError("Overwriting graphs is only supported by TriplyDB API version 2.2.7 or greater");
      }
      const job = new JobUpload({
        app: this._app,
        baseIRI: baseIRI,
        defaultGraphName: defaultGraphName,
        overwriteAll: !!overwriteAll,
        datasetPath: await this._getDatasetPath(),
        datasetNameWithOwner: await this._getDatasetNameWithOwner(),
      });
      this.lastJob = await job.create();
      await this.lastJob.uploadFiles(...(files as string[] | File[]));
      await this.lastJob.exec();
      await this.getInfo(true); // This way we update things like the ds statement count
      return this;
    } finally {
      delete datasetsWithOngoingJob[dsId];
    }
  }
  public async importFromStore(store: n3.Store): Promise<Dataset>;
  public async importFromStore(opts: JobDefaultsConfig, store: n3.Store): Promise<Dataset>;
  public async importFromStore(optsOrStore: unknown, _store?: unknown): Promise<Dataset> {
    let store: n3.Store;
    let opts: JobDefaultsConfig = {};
    if (_store instanceof n3.Store) {
      store = _store;
      opts = optsOrStore as any;
    } else {
      store = optsOrStore as any;
    }
    /**
     * We're writing the store to disk and then uploading
     * This can be improved at a later moment in time by uploading from memory using Buffer
     */
    const quads = store.getQuads(null, null, null, null);
    const quadsString = new n3.Writer().quadsToString(quads);
    const tmpFile = path.resolve(tmpdir(), `triplydb-${md5(quadsString)}.trig`);
    await fs.writeFile(tmpFile, quadsString, "utf-8");
    return this.importFromFiles(opts || {}, tmpFile);
  }
  public async importFromUrls(...urls: string[]): Promise<Dataset>;
  public async importFromUrls(opts: JobDefaultsConfig, ...urls: string[]): Promise<Dataset>;
  public async importFromUrls(arg1: string | JobDefaultsConfig, ...urls: string[]): Promise<Dataset> {
    const dsId = await this.getInfo().then((info) => info.id);
    try {
      this._throwIfJobRunning(dsId);
      datasetsWithOngoingJob[dsId] = true;
      let baseIRI: string | undefined;
      let defaultGraphName: string | undefined;
      let overwriteAll: boolean | undefined;
      if (typeof arg1 === "string") {
        // we have just a list of filenames, no defaults config.
        urls = [arg1].concat(urls);
      } else {
        // the first arg is a defaults config.
        baseIRI = arg1.baseIRI;
        defaultGraphName = arg1.defaultGraphName;
        overwriteAll = arg1.overwriteAll;
      }
      if (overwriteAll && !(await this._app.isCompatible("2.2.7"))) {
        throw new IncompatibleError("Overwriting graphs is only supported by TriplyDB API version 2.2.7 or greater");
      }
      const ownerName = await this._owner.getName();
      let info = await _post<Routes.datasets._account._dataset.jobs.Post>({
        errorWithCleanerStack: getErr(
          `Failed to delete import from ${urls.length} URLs in dataset ${await this._getDatasetNameWithOwner()}.`
        ),
        app: this._app,
        path: "/datasets/" + ownerName + "/" + this._name + "/jobs",
        data: {
          type: "download",
          downloadUrls: urls,
          defaultGraphName: defaultGraphName,
          overwriteAll: !!overwriteAll,
          baseIRI: baseIRI,
        },
      });

      const jobUrl = `${this._app["_config"].url}${await this._getDatasetPath("/jobs/" + info.jobId)}`;
      info = await waitForJobToFinish(this._app, jobUrl, (await this.getInfo()).id);
      await this.getInfo(true); //Sync info so the ds metadata is up to date with imported statements
      return this;
    } finally {
      delete datasetsWithOngoingJob[dsId];
    }
  }
  public async describe(iri: string | NamedNode) {
    const iriString = typeof iri === "string" ? iri : iri.value;
    const buffer: Buffer = await _get({
      app: this._app,
      path: await this._getDatasetPath("/describe.nt"),
      query: {
        resource: iriString,
      },
      expectedResponseBody: "buffer",
      errorWithCleanerStack: getErr(`Failed to describe '${iri}' of ${await this._getDatasetNameWithOwner()}.`),
    });
    return new n3.Parser().parse(buffer.toString());
  }
  public getStatements(payload: { subject?: string; predicate?: string; object?: string; graph?: string }) {
    return new AsyncIteratorHelper<Models.Statement, Models.Statement>({
      error: getErr(`Failed to get statements`),
      getErrorMessage: async () => `Failed to get statements of dataset ${await this._getDatasetNameWithOwner()}.`,
      app: this._app,
      mapResult: async (info) => info,
      getUrl: async () =>
        this._app["_config"].url +
        (await this._getDatasetPath("/statements")) +
        "?" +
        stringifyQueryObj({ limit: 50, ...pick(payload, "subject", "predicate", "object", "graph") }),
    });
  }
  public async uploadAsset(fileOrPath: string | File, assetName?: string): Promise<Asset> {
    if (!assetName) {
      if (typeof fileOrPath === "string") {
        assetName = fileOrPath;
      } else {
        assetName = fileOrPath.name;
      }
    }
    let assetAlreadyExists = false;
    try {
      await this.getAsset(assetName);
      assetAlreadyExists = true; //if it doesnt exist, it would have thrown
    } catch (e) {
      if (e instanceof TriplyDbJsError && e.statusCode === 404) {
        //this is fine
      } else {
        throw e;
      }
    }
    if (assetAlreadyExists) {
      throw Error(
        `Tried to add asset '${assetName}' to dataset ${await this._getDatasetNameWithOwner()}, but an asset with that name already exists.`
      );
    }
    return new Asset(this, await Asset["uploadAsset"]({ fileOrPath, assetName, dataset: this }));
  }

  async addService(type: Models.ServiceType, name: string, reasoner?: Models.JenaReasoners) {
    return await new Service({
      app: this._app,
      datasetPath: await this._getDatasetPath(),
      datasetNameWithOwner: await this._getDatasetNameWithOwner(),
      name,
      type,
      reasoner,
    }).create();
  }

  async addDatasetPrefixes(newPrefixes: { [key: string]: string }) {
    const asPairs = toPairs(newPrefixes);
    await _patch<Routes.prefixes.Patch>({
      errorWithCleanerStack: getErr(
        `Failed to add ${size(newPrefixes)} prefixes to dataset ${await this._getDatasetNameWithOwner()}.`
      ),
      app: this._app,
      path: await this._getDatasetPath("/prefixes"),
      data: asPairs.map(([key, value]) => ({
        prefixLabel: key,
        iri: value,
        scope: "local",
      })),
    });
    return this.getPrefixes(true);
  }

  /**
   * Remove prefixes defined at the dataset level
   */
  async removeDatasetPrefixes(prefixLabels: string[]) {
    const dsPath = await this._getDatasetPath();
    await Promise.all(
      prefixLabels.map(async (p) =>
        _delete<Routes.prefixes._prefix.Delete>({
          errorWithCleanerStack: getErr(
            `Failed to delete prefix ${p} from dataset ${await this._getDatasetNameWithOwner()}.`
          ),
          app: this._app,
          path: dsPath + "/prefixes/" + p,
          expectedResponseBody: "empty",
        }).catch((e) => {
          if (e instanceof TriplyDbJsError && e.statusCode === 404) {
            //fine
            return;
          }
          throw e;
        })
      )
    );
    return this.getPrefixes(true);
  }
  /**
   * Getting _all_ prefixes (not just the dataset-scoped ones)
   */
  async getPrefixes(refresh = false): Promise<{ [prefixLabel: string]: string }> {
    if (refresh || !this.allPrefixes) {
      const prefixes = await _get<Routes.datasets._account._dataset.prefixes.Get>({
        errorWithCleanerStack: getErr(`Failed to get prefixes of dataset ${await this._getDatasetNameWithOwner()}.`),
        app: this._app,
        path: await this._getDatasetPath("/prefixes"),
      });
      this.allPrefixes = fromPairs(prefixes.map((p) => [p.prefixLabel, p.iri]));
    }
    return this.allPrefixes;
  }
}
const datasetsWithOngoingJob: { [dsId: string]: true } = {};
async function waitForJobToFinish(app: App, jobUrl: string, dsId: string) {
  let waitFor = 100; //100ms
  const check = async (): Promise<Models.Job> => {
    const info = await _get<Routes.datasets._account._dataset.jobs._jobId.Get>({
      errorWithCleanerStack: getErr(`Failed to get upload job status`).addContext({ jobUrl }),
      app: app,
      url: jobUrl,
    });
    if (info.status === "error") throw getErr(info.error?.message || "Failed to upload file");
    if (info.status === "canceled" || info.status === "finished") return info;
    await wait(waitFor);
    if (waitFor < 10 * 1000) waitFor = waitFor * 2; //max 10 seconds
    return check();
  };
  try {
    return check();
  } finally {
    delete datasetsWithOngoingJob[dsId];
  }
}

const maxJobUploadWindow = 8;
interface JobConfig {
  app: App;
  baseIRI?: string;
  defaultGraphName?: string;
  overwriteAll?: boolean;
  datasetPath: string;
  datasetNameWithOwner: string;
}
export class JobUpload {
  private _config: JobConfig;
  private _info?: Models.Job;
  private jobUrl?: string;
  public constructor(conf: JobConfig) {
    this._config = conf;
  }
  public getJobUrl() {
    return this.jobUrl;
  }

  public async create() {
    this._info = await _post<Routes.datasets._account._dataset.jobs.Post>({
      errorWithCleanerStack: getErr(`Failed to create job for dataset ${this._config.datasetNameWithOwner}.`),
      app: this._config.app,
      path: this._config.datasetPath + "/jobs",
      data: {
        defaultGraphName: this._config.defaultGraphName,
        baseIRI: this._config.baseIRI,
      },
    });
    this.jobUrl = `${this._config.app["_config"].url}${this._config.datasetPath}/jobs/${this._info.jobId}`;

    return this;
  }
  public info() {
    return this._info;
  }

  private async uploadFile(fileOrPath: string | File) {
    let rs: ReadStream | File;
    let fileSize: number;
    let fileName: string;
    if (typeof fileOrPath === "string") {
      // We can't use 'fs' outside of node, let's warn the dev about this
      if (fs.createReadStream === undefined) {
        throw getErr('"fs" is not loaded in this environment, use a "File" instead');
      }
      rs = fs.createReadStream(fileOrPath);
      fileSize = (await fs.stat(fileOrPath)).size;
      fileName = fileOrPath;
    } else {
      rs = fileOrPath;
      fileSize = fileOrPath.size;
      fileName = fileOrPath.name;
    }
    return new Promise<void>((resolve, reject) => {
      const upload = new tus.Upload(rs, {
        endpoint: this.jobUrl + "/add",
        resume: true,
        metadata: {
          filename: fileName,
        },
        headers: {
          Authorization: "Bearer " + this._config.app["_config"].token,
        },
        chunkSize: 5 * 1024 * 1024,
        uploadSize: fileSize,
        retryDelays: [2000, 5000, 10000, 40000, 50000],
        onError: function (error: any) {
          reject(error);
        },
        onProgress: function (_bytesUploaded: number, _bytesTotal: number) {},
        onSuccess: function () {
          log("finished file " + fileOrPath);
          resolve();
        },
      });
      upload.start();
    });
  }

  public async uploadFiles(...files: string[] | File[]) {
    const promises: Promise<void>[] = [];
    const getFromStack = async (): Promise<any> => {
      const file = files.pop();
      if (!file) return; //we're done
      await this.uploadFile(file);
      return getFromStack();
    };

    for (let i = 0; i < Math.min(maxJobUploadWindow, files.length); i++) {
      promises.push(getFromStack());
    }
    await Promise.all(promises);
    await this.refresh();
    return this;
  }
  private async refresh() {
    if (!this.jobUrl) throw getErr("Cannot refresh uninstantiated job");
    this._info = await _get<Routes.datasets._account._dataset.jobs._jobId.Get>({
      errorWithCleanerStack: getErr(
        `Failed to get job information for dataset ${this._config.datasetNameWithOwner}.`
      ).addContext({
        jobUrl: this.jobUrl,
      }),
      url: this.jobUrl,
      app: this._config.app,
    });
  }

  public async exec() {
    if (!this.jobUrl) throw getErr("Cannot start uninstantiated job");
    this._info = await _post<Routes.datasets._account._dataset.jobs._jobId.start.Post>({
      errorWithCleanerStack: getErr(`Failed to start job in dataset ${this._config.datasetNameWithOwner}.`).addContext({
        jobUrl: this.jobUrl,
      }),
      app: this._config.app,
      url: this.jobUrl + "/start",
      data: {
        overwriteAll: !!this._config.overwriteAll,
      },
    });
    this._info = await waitForJobToFinish(this._config.app, this.jobUrl, this._info.datasetId);
  }
}
