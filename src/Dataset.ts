import { Models, Routes } from "@triply/utils";
import App from "./App.js";
import fs from "fs-extra";
import { formatUploadProgress, setStickySessionCookie, wait } from "./utils/index.js";
import Service from "./Service.js";
import debug from "debug";
const log = debug("triply:triplydb-js:upload");
import * as tus from "@triply/tus-js-client";
import { tmpdir } from "os";
import * as stream from "stream";
import path from "path";
import * as zlib from "zlib";
import * as n3 from "n3";
import pumpify from "pumpify";
import { Account } from "./Account.js";
import { fromPairs, toPairs, pick, size, uniq, zipObject } from "lodash-es";
import { TriplyDbJsError, getErr, IncompatibleError } from "./utils/Error.js";
import { _get, _delete, _patch, _post, handleFetchAsStream } from "./RequestHandler.js";
import AsyncIteratorHelper from "./utils/AsyncIteratorHelper.js";
import Asset from "./Asset.js";
import Graph from "./Graph.js";
import stringifyQueryObj from "query-string";
import { NamedNode } from "@rdfjs/types";
import NDEDatasetRegister from "./utils/NDEDatasetRegister.js";
import { randomUUID } from "crypto";
import { pipeline } from "stream/promises";
import statuses from "http-status-codes";

type JobDefaultsConfig = Omit<
  Routes.datasets._account._dataset.jobs.Post["Req"]["Body"],
  "type" | "url" | "downloadUrls"
>;

interface ImportFromDatasetArgs {
  graphMap?: { [from: string]: string | Graph | NamedNode };
  graphNames?: Array<string | Graph | NamedNode>;
  overwrite?: boolean;
}
export type Prefixes = { [label: string]: n3.PrefixedToIri | string | NamedNode };
type DsResourceType = "assets" | "graphs" | "services";
export type NewService = NewServiceVirtuoso | NewServiceElasticsearch | NewServiceJena;
type NewServiceVirtuoso = {
  type: "virtuoso";
  config?: never;
};
type NewServiceElasticsearch = {
  type: "elasticSearch";
  config?: Models.ServiceConfigElastic;
};
type NewServiceJena = {
  type: "jena";
  config?: Models.ServiceConfigJena;
};

type UploadAssetModes = "throw-if-exists" | "replace-if-exists" | "append-version";

export default class Dataset {
  public app: App;
  private _info?: Models.Dataset;
  public owner: Account;
  private _lastJob?: JobUpload;
  public slug: string;
  private _allPrefixes: { [prefixLabel: string]: string } | undefined;
  public readonly type = "Dataset";
  constructor(app: App, owner: Account, datasetInfo: Models.Dataset) {
    this.app = app;
    this.slug = datasetInfo.name;
    this.owner = owner;
    this._info = datasetInfo;
  }

  public getServices() {
    return new AsyncIteratorHelper<Models.ServiceMetadata, Service>({
      potentialFutureError: getErr(`Failed to get services`),
      getErrorMessage: async () => `Failed to get services for dataset ${this._getDatasetNameWithOwner()}.`,
      app: this.app,
      getUrl: async () => this.api.url + "/services",
      mapResult: async (info: Models.ServiceMetadata) => {
        return new Service({
          app: this.app,
          dataset: this,
          name: info.name,
          type: info.type,
          config: info.config,
        });
      },
    });
  }

  public async getService<T extends Dataset>(this: T, serviceName: string): Promise<Service> {
    const sv2Metadata = await _get<Routes.datasets._account._dataset.services._serviceName.Get>({
      errorWithCleanerStack: getErr(`Failed to get service '${serviceName}' from dataset ${this.slug}.`),
      app: this.app,
      path: `${this.api.path}/services/${serviceName}`,
    });
    return new Service({
      app: this.app,
      dataset: this,
      name: sv2Metadata.name,
      type: sv2Metadata.type,
      config: sv2Metadata.config,
    });
  }

  public async clear(resourceType: DsResourceType, ...rest: DsResourceType[]) {
    await Promise.all(
      uniq(rest.concat(resourceType)).map(async (typeToClear) => {
        if (typeToClear === "graphs") {
          return _delete({
            errorWithCleanerStack: getErr(`Failed to remove all graphs for ${this._getDatasetNameWithOwner()}.`),
            app: this.app,
            path: this.api.path + "/graphs",
            expectedResponseBody: "empty",
          });
        } else if (typeToClear === "assets") {
          for await (let asset of this.getAssets()) await asset?.delete();
        } else if (typeToClear === "services") {
          for await (let service of this.getServices()) await service?.delete();
        } else {
          throw getErr(`Unrecognized resource type: ${typeToClear}`);
        }
      }),
    );
    await this.getInfo(true);
    return this;
  }
  public get api() {
    const path = `/datasets/${this.owner.slug}/${this.slug}`;
    return {
      url: this.app.url + path,
      path,
    };
  }
  public async getGraph(graphNameOrIri: string | NamedNode) {
    const graphName = typeof graphNameOrIri === "string" ? graphNameOrIri : graphNameOrIri.value;
    for await (let graph of this.getGraphs()) {
      if (!graph) break;
      if ((await graph.getInfo()).graphName === graphName) return graph;
    }
    throw getErr(`Graph '${graphName}' not found in dataset ${this._getDatasetNameWithOwner()}`);
  }
  public async deleteGraph(graphNameOrIri: string | NamedNode) {
    const graphName = typeof graphNameOrIri === "string" ? graphNameOrIri : graphNameOrIri.value;
    const graph = await this.getGraph(graphName);
    await graph.delete();
  }

  private _setInfo(info: Models.Dataset) {
    this._info = info;
    this.slug = info.name;
    return this;
  }

  private _getDatasetNameWithOwner() {
    return `${this.owner.slug}/${this.slug}`;
  }
  public async getInfo(refresh = false): Promise<Models.Dataset> {
    if (!refresh && this._info) return this._info;
    const info = await _get<Routes.datasets._account._dataset.Get>({
      errorWithCleanerStack: getErr(`Failed to get dataset information for ${this._getDatasetNameWithOwner()}.`),
      app: this.app,
      path: this.api.path,
    });
    this._setInfo(info);
    return info;
  }
  public async getAsset(assetName: string, versionNumber?: number) {
    return new Asset(
      this,
      (await _get<Routes.datasets._account._dataset.assets.Get>({
        errorWithCleanerStack: getErr(
          `Failed to get asset ${assetName} from dataset ${this._getDatasetNameWithOwner()}.`,
        ),
        app: this.app,
        path: this.api.path + "/assets",
        query: { fileName: assetName },
      })) as Models.Asset,
      versionNumber,
    );
  }
  public getAssets() {
    return new AsyncIteratorHelper<Models.Asset, Asset>({
      potentialFutureError: getErr(`Failed to get assets`),
      getErrorMessage: async () => `Failed to get assets of dataset ${this._getDatasetNameWithOwner()}.`,
      app: this.app,
      getUrl: async () => this.api.url + "/assets",
      mapResult: async (assetInfo) => new Asset(this, assetInfo),
    });
  }
  public getGraphs() {
    return new AsyncIteratorHelper<Models.Graph, Graph>({
      potentialFutureError: getErr(`Failed to get graphs`),
      getErrorMessage: async () => `Failed to get graphs of dataset ${this._getDatasetNameWithOwner()}.`,
      app: this.app,
      getUrl: async () => this.api.url + "/graphs",
      mapResult: async (info) => new Graph(this, info),
    });
  }

  // Extension comes from a path.parse method, so we can trust it to start with a `.`
  private async _getDownloadPath(extension: string, graph?: Graph) {
    const dsPath = `${this.api.path}`;
    return `${dsPath}/download${extension}` + (graph ? `?graph=${encodeURIComponent(graph["_info"].graphName)}` : "");
  }
  public async graphsToFile(destinationPath: string, opts?: { compressed?: boolean; graph?: Graph }) {
    const parsedPath = path.parse(destinationPath);
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

    const stream = new pumpify(
      await this.graphsToStream("compressed", { graph: opts?.graph, extension }),
      // we always download compressed version. Decompress unless the user saves as *.gz
      ...(storeCompressed ? [] : [zlib.createGunzip()]),
      fs.createWriteStream(destinationPath),
    );
    await new Promise((resolve, reject) => {
      stream.on("error", reject);
      stream.on("finish", resolve);
    });
  }

  public async graphsToStream(
    type: "compressed" | "rdf-js",
    opts?: { graph?: Graph; extension?: string },
  ): Promise<stream.Readable> {
    const stream = await handleFetchAsStream("GET", {
      app: this.app,
      path: await this._getDownloadPath((opts?.extension ?? ".trig") + ".gz", opts?.graph),
      errorWithCleanerStack: getErr(
        opts?.graph
          ? `Failed to download graph ${opts?.graph["_info"].graphName}`
          : `Failed to download graphs of dataset ${this._getDatasetNameWithOwner()}.`,
      ),
    });
    if (type === "compressed") {
      return stream as any;
    } else {
      return new pumpify.obj(stream as any, zlib.createGunzip(), new n3.StreamParser());
    }
  }
  public async graphsToStore(graph?: Graph): Promise<n3.Store> {
    const store = new n3.Store();
    const stream = await this.graphsToStream("rdf-js", { graph });
    await new Promise((resolve, reject) => {
      store.import(stream).on("finish", resolve).on("error", reject);
    });
    return store;
  }

  public async importFromDataset(fromDataset: Dataset, args?: ImportFromDatasetArgs): Promise<Models.Imports> {
    let graphs;
    if (args && args.graphMap && args.graphNames) {
      throw getErr("please use either the property 'graphMap' or 'graphNames', but not both together");
    } else if (args && args.graphMap) {
      graphs = {} as { [from: string]: string };
      for (let graph in args.graphMap) {
        const key = graph;
        const value = args.graphMap[graph];
        if (value instanceof Graph) {
          graphs[key] = await value.getInfo().then((g) => g.graphName);
        } else if (typeof value === "string") {
          graphs[key] = value;
        } else {
          graphs[key] = value.value;
        }
      }
    } else if (args && args.graphNames) {
      const graphNames = await Promise.all(
        args.graphNames.map((graph) => {
          if (graph instanceof Graph) {
            return graph.getInfo().then((g) => g.graphName);
          } else if (typeof graph === "string") {
            return graph;
          } else {
            return graph.value;
          }
        }),
      );
      graphs = zipObject(graphNames, graphNames);
    }

    const overwrite = !!args?.overwrite;
    if (overwrite && !(await this.app.isCompatible("2.2.7"))) {
      throw new IncompatibleError("Overwriting graphs is only supported by TriplyDB API version 2.2.7 or greater");
    }
    if (!graphs) {
      // import all the graphs, keeping the original names.
      const graphNames = await Promise.all(
        (await fromDataset.getGraphs().toArray()).map((g) => g.getInfo().then((g) => g.graphName)),
      );
      graphs = zipObject(graphNames, graphNames);
    }

    const fromDsInfo = await fromDataset.getInfo();
    const graphsToImport: Models.UpdateImport["graphs"] = [];
    for (const fromGraph in graphs) {
      graphsToImport.push({
        from: fromGraph,
        to: graphs[fromGraph],
        overwrite: !!overwrite,
      });
    }
    return _patch<Routes.datasets._account._dataset.imports.Patch>({
      errorWithCleanerStack: getErr(
        `Tried importing from dataset ${await fromDataset._getDatasetNameWithOwner()}. Failed to write the changes to ${this._getDatasetNameWithOwner()}.`,
      ),
      app: this.app,
      path: this.api.path + "/imports",
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
        errorWithCleanerStack: getErr(`Failed to update dataset information of ${this._getDatasetNameWithOwner()}.`),
        app: this.app,
        path: this.api.path,
        data: config,
      }),
    );
    return this;
  }
  public async copy(toAccountName: string, newDatasetName?: string) {
    const newDs = await _post<Routes.datasets._account._dataset.copy.Post>({
      errorWithCleanerStack: getErr(`Failed to copy dataset ${this._getDatasetNameWithOwner()} to ${toAccountName}.`),
      app: this.app,
      path: this.api.path + "/copy",
      data: { toAccount: toAccountName, name: newDatasetName },
    });
    const toAccount = await this.app.getAccount(toAccountName);
    return (await toAccount.getDataset(newDs.name))._setInfo(newDs);
  }

  public async renameGraph(from: string, to: string) {
    const graph = await this.getGraph(from);
    await graph.rename(to);
    return graph;
  }

  public async delete() {
    try {
      await _delete<Routes.datasets._account._dataset.Delete>({
        errorWithCleanerStack: getErr(`Failed to delete dataset ${this._getDatasetNameWithOwner()}.`),
        app: this.app,
        path: this.api.path,
        expectedResponseBody: "empty",
      });
    } catch (e) {
      if (e instanceof TriplyDbJsError && e.statusCode === 404) {
        // this is fine: the resource is gone already. Probably a race condition with another delete call
      } else {
        throw e;
      }
    }
    this._info = undefined;
    this._lastJob = undefined;
  }
  public async setAvatar(pathBufferOrFile: string | Buffer | File) {
    const info = await this.getInfo();
    await _post({
      errorWithCleanerStack: getErr(`Failed to set avatar of dataset ${this._getDatasetNameWithOwner()}.`),
      app: this.app,
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
  public async importFromFiles(files: File[] | string[], defaultsConfig?: JobDefaultsConfig): Promise<Dataset> {
    const dsId = await this.getInfo().then((info) => info.id);
    this._throwIfJobRunning(dsId);
    try {
      datasetsWithOngoingJob[dsId] = true;
      if (defaultsConfig?.overwriteAll && !(await this.app.isCompatible("2.2.7"))) {
        throw new IncompatibleError("Overwriting graphs is only supported by TriplyDB API version 2.2.7 or greater");
      }
      const job = new JobUpload({
        app: this.app,
        ...defaultsConfig,
        datasetPath: this.api.path,
        datasetNameWithOwner: this._getDatasetNameWithOwner(),
      });
      this._lastJob = await job.create();
      await this._lastJob.uploadFiles(files);
      await this._lastJob.exec();
      await this.getInfo(true); // This way we update things like the ds statement count
      return this;
    } finally {
      delete datasetsWithOngoingJob[dsId];
    }
  }
  public async importFromStore(store: n3.Store, opts?: JobDefaultsConfig): Promise<Dataset> {
    const tmpFile = path.resolve(tmpdir(), `triplydb-${randomUUID()}.nq`);
    await pipeline(
      stream.Readable.from(store),
      new n3.StreamWriter({ format: "n-quads" }),
      fs.createWriteStream(tmpFile, { encoding: "utf-8" }),
    );
    return this.importFromFiles([tmpFile], opts);
  }
  public async importFromUrls(urls: string[], defaultConfig?: JobDefaultsConfig): Promise<Dataset> {
    const dsId = await this.getInfo().then((info) => info.id);
    try {
      this._throwIfJobRunning(dsId);
      datasetsWithOngoingJob[dsId] = true;
      if (defaultConfig?.overwriteAll && !(await this.app.isCompatible("2.2.7"))) {
        throw new IncompatibleError("Overwriting graphs is only supported by TriplyDB API version 2.2.7 or greater");
      }
      let info = await _post<Routes.datasets._account._dataset.jobs.Post>({
        errorWithCleanerStack: getErr(
          `Failed to delete import from ${urls.length} URLs in dataset ${this._getDatasetNameWithOwner()}.`,
        ),
        app: this.app,
        path: this.api.path + "/jobs",
        data: {
          ...defaultConfig,
          type: "download",
          downloadUrls: urls,
        },
      });

      const jobUrl = `${this.api.url}/jobs/${info.jobId}`;
      info = await waitForJobToFinish(this.app, jobUrl, (await this.getInfo()).id);
      await this.getInfo(true); //Sync info so the ds metadata is up to date with imported statements
      return this;
    } finally {
      delete datasetsWithOngoingJob[dsId];
    }
  }
  public async describe(iri: string | NamedNode) {
    const iriString = typeof iri === "string" ? iri : iri.value;
    const buffer: Buffer = await _get({
      app: this.app,
      path: this.api.path + "/describe.nt",
      query: {
        resource: iriString,
      },
      expectedResponseBody: "buffer",
      errorWithCleanerStack: getErr(`Failed to describe '${iri}' of ${this._getDatasetNameWithOwner()}.`),
    });
    return new n3.Parser().parse(buffer.toString());
  }
  public getStatements(payload: { subject?: string; predicate?: string; object?: string; graph?: string }) {
    return new AsyncIteratorHelper<Models.NtriplyStatement, Models.NtriplyStatement>({
      potentialFutureError: getErr(`Failed to get statements`),
      getErrorMessage: async () => `Failed to get statements of dataset ${this._getDatasetNameWithOwner()}.`,
      app: this.app,
      mapResult: async (info) => info,
      getUrl: async () =>
        this.api.url +
        "/statements" +
        "?" +
        stringifyQueryObj.stringify({ limit: 50, ...pick(payload, "subject", "predicate", "object", "graph") }),
    });
  }
  public async uploadAsset(
    fileOrPath: string | File,
    opts: { mode: UploadAssetModes; assetName?: string },
  ): Promise<Asset> {
    if (!opts.assetName) {
      if (typeof fileOrPath === "string") {
        opts.assetName = fileOrPath;
      } else {
        opts.assetName = fileOrPath.name;
      }
    }
    let asset: Asset | undefined;
    try {
      asset = await this.getAsset(opts.assetName);
    } catch (e) {
      if (e instanceof TriplyDbJsError && e.statusCode === 404) {
        //this is fine
      } else {
        throw e;
      }
    }

    if (asset) {
      if (opts.mode === "append-version") return asset.addVersion(fileOrPath);
      if (opts.mode === "throw-if-exists")
        throw new TriplyDbJsError(
          `Tried to add asset '${opts.assetName}' to dataset ${this._getDatasetNameWithOwner()}, but an asset with that name already exists.`,
        ).setStatusCode(statuses.CONFLICT);
      await asset.delete();
    }
    return new Asset(this, await Asset["uploadAsset"]({ fileOrPath, assetName: opts.assetName, dataset: this }));
  }

  public async addService(name: string, opts?: NewService) {
    return new Service({
      app: this.app,
      dataset: this,
      name,
      type: opts ? opts.type : "virtuoso",
      config: opts?.config || undefined,
    }).create();
  }

  public async ensureService<T extends Dataset>(this: T, name: string, args?: NewService) {
    try {
      const foundService = await this.getService(name);
      return foundService;
    } catch (e: any) {
      if (e.statusCode !== 404) throw e;
      return this.addService(name, args);
    }
  }

  public async addPrefixes(newPrefixes: Prefixes) {
    const asPairs = toPairs(newPrefixes);
    await _patch<Routes.prefixes.Patch>({
      errorWithCleanerStack: getErr(
        `Failed to add ${size(newPrefixes)} prefixes to dataset ${this._getDatasetNameWithOwner()}.`,
      ),
      app: this.app,
      path: this.api.path + "/prefixes",
      data: asPairs.map(([key, value]) => {
        let prefixIri;
        if (typeof value === "string") {
          prefixIri = value;
        } else if (typeof value === "function") {
          prefixIri = value("").value;
        } else {
          prefixIri = value.value;
        }
        return { prefixLabel: key, iri: prefixIri, scope: "local" };
      }),
    });
    return this.getPrefixes(true);
  }

  /**
   * Remove prefixes defined at the dataset level
   */
  public async removePrefixes(prefixLabels: string[]) {
    const dsPath = this.api.path;
    await Promise.all(
      prefixLabels.map(async (p) =>
        _delete<Routes.prefixes._prefix.Delete>({
          errorWithCleanerStack: getErr(
            `Failed to delete prefix ${p} from dataset ${this._getDatasetNameWithOwner()}.`,
          ),
          app: this.app,
          path: dsPath + "/prefixes/" + p,
          expectedResponseBody: "empty",
        }).catch((e) => {
          if (e instanceof TriplyDbJsError && e.statusCode === 404) {
            //fine
            return;
          }
          throw e;
        }),
      ),
    );
    return this.getPrefixes(true);
  }
  /**
   * Getting _all_ prefixes (not just the dataset-scoped ones)
   */
  async getPrefixes(refresh = false): Promise<{ [prefixLabel: string]: string }> {
    if (refresh || !this._allPrefixes) {
      const prefixes = await _get<Routes.datasets._account._dataset.prefixes.Get>({
        errorWithCleanerStack: getErr(`Failed to get prefixes of dataset ${this._getDatasetNameWithOwner()}.`),
        app: this.app,
        path: this.api.path + "/prefixes",
      });
      this._allPrefixes = fromPairs(prefixes.map((p) => [p.prefixLabel, p.iri]));
    }
    return this._allPrefixes;
  }

  public nde = {
    datasetregister: {
      /**
       * Register this dataset with the [NDE Dataset register](https://datasetregister.netwerkdigitaalerfgoed.nl/)
       *
       * @param rejectOnValidationError an optional boolean (default = true) indicating that SHACL validation errors should throw an Error.
       *                                If false, the function will not throw but return a Stroe containng the SHACL validation report.
       * @example
       * ```ts
       * App.get(token)
       *   .getAccount(accountName)
       *   .then(account => account.getDataset(datasetName))
       *   .then(dataset => dataset.nde.datasetregister.submit())
       * ```
       */
      submit: async (rejectOnValidationError?: boolean) => NDEDatasetRegister(this, "submit", rejectOnValidationError),

      /**
       * Validate this dataset against the [NDE Dataset register](https://datasetregister.netwerkdigitaalerfgoed.nl/)
       *
       * @param rejectOnValidationError an optional boolean (default = true) indicating that SHACL validation errors should throw an Error.
       *                                If false, the function will not throw but return a Stroe containng the SHACL validation report.
       * @example
       * ```ts
       * App.get(token)
       *   .getAccount(accountName)
       *   .then(account => account.getDataset(datasetName))
       *   .then(dataset => dataset.nde.datasetregister.submit())
       * ```
       */
      validate: async (rejectOnValidationError?: boolean) =>
        NDEDatasetRegister(this, "validate", rejectOnValidationError),
    },
  };
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
    return await check();
  } finally {
    delete datasetsWithOngoingJob[dsId];
  }
}

const maxJobUploadWindow = 8;
interface JobConfig extends JobDefaultsConfig {
  app: App;
  datasetPath: string;
  datasetNameWithOwner: string;
}
export class JobUpload {
  private _config: JobConfig;
  private _info?: Models.Job;
  private jobUrl?: string;
  private urlMapper: (url: string) => string = (url: string) => url;
  public constructor(conf: JobConfig) {
    this._config = conf;
    if (conf.app["_info"]?.apiUrl !== conf.app.getConfig().url) {
      this.urlMapper = (url: string) => {
        const u = new URL(url);
        return conf.app.getConfig().url.replace(/\/+$/g, "") + u.pathname + u.search;
      };
    }
  }
  public getJobUrl() {
    return this.jobUrl;
  }

  public async create() {
    const { app, datasetPath, datasetNameWithOwner: _ignored, ...data } = this._config;
    this._info = await _post<Routes.datasets._account._dataset.jobs.Post>({
      errorWithCleanerStack: getErr(`Failed to create job for dataset ${this._config.datasetNameWithOwner}.`),
      app: app,
      path: datasetPath + "/jobs",
      data,
    });
    this.jobUrl = `${app.url}${datasetPath}/jobs/${this._info.jobId}`;

    return this;
  }
  public info() {
    return this._info;
  }

  private async uploadFile(fileOrPath: string | File) {
    let rs: fs.ReadStream | File;
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
    // we want to try to get a sticky session cookie for TUS uploads
    const headers: { [name: string]: string } = { Authorization: "Bearer " + this._config.app["_config"].token };
    await setStickySessionCookie(headers, this._config.app.url);

    let previousChunkCompleted = Date.now();
    return new Promise<void>((resolve, reject) => {
      const upload = new tus.Upload(rs, {
        endpoint: this.jobUrl + "/add",
        metadata: {
          filename: fileName,
        },
        headers,
        mapUrl: this.urlMapper,
        chunkSize: 5 * 1024 * 1024,
        uploadSize: fileSize,
        retryDelays: [2000, 5000, 10000, 40000, 50000],
        onError: reject,
        onChunkComplete: function (...stats) {
          log(formatUploadProgress(Date.now() - previousChunkCompleted, ...stats));
          previousChunkCompleted = Date.now();
        },
        onSuccess: function () {
          log("finished file " + fileOrPath);
          resolve();
        },
      });
      upload.start();
    });
  }

  public async uploadFiles(files: string[] | File[]) {
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
        `Failed to get job information for dataset ${this._config.datasetNameWithOwner}.`,
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
    });
    this._info = await waitForJobToFinish(this._config.app, this.jobUrl, this._info.datasetId);
  }
}
