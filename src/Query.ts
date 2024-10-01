import { Models, Routes } from "@triply/utils";
import App from "./App.js";
import { _get, _patch, _delete, _post } from "./RequestHandler.js";
import { Account } from "./Account.js";
import { getErr, IncompatibleError, TriplyDbJsError } from "./utils/Error.js";
import { Cache } from "./utils/cache.js";
import * as n3 from "n3";
import sparqljs from "sparqljs";
import stringifyQueryObj from "query-string";
import AsyncIteratorHelperWithToFile from "./utils/AsyncIteratorHelperWithToFile.js";
import { VariableConfig } from "@triply/utils/Models.js";
import { AddQueryOptions, RunPipelineOpts } from "./commonAccountFunctions.js";
import User from "./User.js";
import Org from "./Org.js";
import { isUndefined, omitBy } from "lodash-es";
export type Binding = { [key: string]: string };
export type VariableValues = { [variable: string]: string | undefined };

interface AddVersionBase {
  queryString?: string;
  variables?: VariableConfig[];
}

interface AddVersionLDFrame extends AddVersionBase {
  output?: string;
  ldFrame?: never;
}

interface AddVersionVisualization extends AddVersionBase {
  output?: never;
  ldFrame?: object;
}

type AddVersion = AddVersionVisualization | AddVersionLDFrame;

type DuplicateOptions = Partial<AddQueryOptions>;

export default class Query {
  public app: App;
  private _info: Models.Query;
  public owner: Account;
  public slug: string;
  private _version: number | undefined;
  public readonly type = "Query";
  public constructor(app: App, info: Models.Query, owner: Account) {
    this.app = app;
    this._info = info;
    this.slug = info.name;
    this.owner = owner;
  }
  private _getQueryType() {
    const queryString = this["_info"].requestConfig?.payload.query;
    if (!queryString) throw getErr(`Query ${this.slug} has no versions.`);
    const parser = new sparqljs.Parser();
    const parsed = parser.parse(queryString);
    if (parsed.type === "query") {
      return parsed.queryType;
    } else {
      throw getErr("Update-queries are not supported");
    }
  }
  public get api() {
    // For consistency with the other `api` getters, we're only returning the 'main' api path
    // here (without the version number and without postprocessing the link)
    const path = `/queries/${this.owner.slug}/${this.slug}`;
    return {
      url: this.app.url + path,
      path,
    };
  }
  private async _getPath(opts?: { ignoreVersion?: boolean }) {
    const accountName = this.owner.slug;
    const pathChunks: string[] = ["queries", accountName, this.slug];
    if (!opts?.ignoreVersion && typeof this._version === "number") {
      pathChunks.push(String(this._version));
    }

    return "/" + pathChunks.join("/");
  }
  private async _getQueryNameWithOwner() {
    const ownerName = (await this.owner.getInfo()).accountName;
    return `${ownerName}/${this.slug}`;
  }
  public async getInfo(refresh = false): Promise<Models.Query> {
    if (!refresh && this._info) return this._info;
    this._info = (await _get<Routes.queries._account._query.Get>({
      errorWithCleanerStack: getErr(`Failed to get information of query ${await this._getQueryNameWithOwner()}.`),
      app: this.app,
      path: await this._getPath(),
    })) as Models.Query;
    this.slug = this.slug;
    return this._info;
  }

  public async addVersion(args: AddVersion) {
    await this.useVersion("latest");
    let { requestConfig, renderConfig, variables } = await this.getInfo();

    // In theory, a saved query may not have a query string if that query is created via the UI
    // We're catering for that by setting a default below
    if (!requestConfig?.payload.query) {
      requestConfig = {
        payload: {
          query: "select * where {?sub ?pred ?obj}",
        },
      };
    }
    if (args.queryString) {
      requestConfig = {
        payload: {
          query: args.queryString,
        },
      };
    }
    if (args.output) {
      renderConfig = { output: args.output };
    } else if (args.ldFrame) {
      requestConfig = {
        ...requestConfig,
        // Adding header to be consistent with console code
        headers: {
          Accept: "application/ld+json;profile=http://www.w3.org/ns/json-ld#framed",
        },
        ldFrame: args.ldFrame,
      };
      renderConfig = undefined;
    }

    if (args.variables) {
      variables = args.variables;
    }

    const updateQueryInfo: Models.QueryVersionUpdate = {
      requestConfig,
      renderConfig,
      variables,
    };

    await _post<Routes.queries._account._query.Post>({
      app: this.app,
      errorWithCleanerStack: getErr(`Failed to add a new version to query '${this.slug}'`),
      data: updateQueryInfo,
      path: await this._getPath(),
    });
    return this;
  }
  public async getDataset() {
    const info = await this.getInfo();
    if (!info.dataset) return;
    const datasetJson = info.dataset;
    const datasetOwner = await this.app.getAccount(datasetJson.owner.accountName);
    return datasetOwner.getDataset(datasetJson.name);
  }

  /**
   * Run job as a pipeline on TriplyDB. This works for construct queries of arbitrary duration and output size.
   */
  public async runPipeline(opts: Omit<RunPipelineOpts, "queries">) {
    return this.owner.runPipeline({ ...opts, queries: [this] });
  }

  private _setInfo(info: Models.Query) {
    this._info = info;
    this.slug = info.name;
    return this;
  }
  public get version() {
    return this._version;
  }
  public async useVersion(version: number | "latest") {
    const numVersions = this._info.numberOfVersions;
    if (!numVersions) throw getErr(`Query ${this.slug} has no versions.`);
    if (version === "latest") {
      this._version = undefined;
      return this;
    }
    if (version > numVersions || version < 0) {
      throw getErr(
        `Query ${this.slug} has ${numVersions} ${
          numVersions > 1 ? "versions" : "version"
        }. Version ${version} does not exist.`,
      );
    }
    this._version = version;
    await this.getInfo(true);
    return this;
  }
  public async update(config: Models.QueryMetaUpdate) {
    if (!(await this.app.isCompatible("23.09.0"))) {
      throw new IncompatibleError(
        "This function has been updated and is now supported by TriplyDB API version 23.09.0 or greater",
      );
    }
    const updateData = { ...config };
    if (!updateData.dataset) {
      updateData.dataset = this._info.dataset?.id;
    }
    this._setInfo(
      await _patch<Routes.queries._account._query.Patch>({
        errorWithCleanerStack: getErr(`Failed to update query information of ${this.slug}.`),
        app: this.app,
        path: await this._getPath({ ignoreVersion: true }),
        data: updateData,
      }),
    );
    return this;
  }
  public async delete() {
    await _delete<Routes.queries._account._query.Delete>({
      errorWithCleanerStack: getErr(`Failed to delete query ${this.slug}.`),
      app: this.app,
      path: await this._getPath({ ignoreVersion: true }),
      expectedResponseBody: "empty",
    });
  }
  public async getString(variableValues?: VariableValues) {
    const info = await this.getInfo();
    if (!info.requestConfig?.payload.query) {
      throw getErr(`Query ${this.slug} has no versions.`);
    }
    if (!info.variables) return info.requestConfig.payload.query;

    return (await _get<Routes.queries._account._query.Get>({
      errorWithCleanerStack: getErr(`Failed to get query information.`),
      app: this.app,
      path: (await this._getPath()) + "/text",
      expectedResponseBody: "text",
      query: omitBy(variableValues, isUndefined) as { [key: string]: string },
    })) as string;
  }
  public async getApiUrl() {
    return this.app["getPostProcessedApiUrl"]((await this.getInfo()).link);
  }
  public async getRunLink() {
    return (await this.getApiUrl()) + "/run";
  }
  public results(variables?: VariableValues, opts?: { cache?: Cache }) {
    const queryType = this._getQueryType();

    const variablesInUrlString = stringifyQueryObj.stringify({
      page: 1,
      pageSize: 5000,
      ...(variables || {}),
    });
    if (opts?.cache) {
      opts.cache.cacheId = this._info.id;
    }
    const iteratorOptions = {
      potentialFutureError: getErr(`Failed to run query`),
      getErrorMessage: async () => `Failed to get results for query ${await this.getInfo().then((i) => i.name)}.`,
      app: this.app,
      cache: opts?.cache,
    };

    const getAsyncIteratorHelperWithToFile = <FromType, ToType>(mapResult: (result: FromType) => Promise<ToType>) => {
      return new AsyncIteratorHelperWithToFile<FromType, ToType>({
        ...iteratorOptions,
        isBindings: true,
        mapResult,
        getUrl: async (contentType) =>
          this.app.url +
          ((await this._getPath()) + `/run${contentType ? "." + contentType : ""}?` + variablesInUrlString),
      });
    };

    return {
      statements: () => {
        if (queryType !== "CONSTRUCT" && queryType !== "DESCRIBE") {
          throw getErr(`Statements are only supported for CONSTRUCT and DESCRIBE queries (got ${queryType}).`);
        }
        const parser = new n3.Parser();
        return new AsyncIteratorHelperWithToFile<n3.Quad, n3.Quad>({
          ...iteratorOptions,
          mapResult: async (result) => result,
          getUrl: async () => this.app.url + ((await this._getPath()) + "/run.nt?" + variablesInUrlString),
          parsePage: async (page: string) => {
            if (page === "OK") return []; // empty page (jena);
            // empty page (virtuoso) is a valid empty turtle doc, no check needed.
            return parser.parse(page);
          },
        });
      },
      boolean: () => {
        if (queryType !== "ASK") {
          throw getErr(`Bindings are only supported for ASK queries (got ${queryType}).`);
        }
        return getAsyncIteratorHelperWithToFile<{ boolean: boolean }, boolean>((result) =>
          Promise.resolve(result.boolean),
        );
      },
      bindings: () => {
        if (queryType !== "SELECT") {
          throw getErr(`Bindings are only supported for SELECT queries (got ${queryType}).`);
        }
        return getAsyncIteratorHelperWithToFile<Binding, Binding>((result) => Promise.resolve(result));
      },
    };
  }

  /* 
    Copy makes a copy of the query
    Params: 
      queryName (optional): New query name for the copied query (will default to the original query's name).
      account (optional): Account to save the query under. A user or an organization. (will default to token account used)
      metadataToReplace (optional) : A set of new metadata values to be inserted into the duplicated query (Description, displayName, etc..)     
    Returns: Newly copied query
  */

  public async copy(queryName?: string, account?: User | Org, metadataToReplace?: DuplicateOptions) {
    const app = this.app;
    if (!(await app.isCompatible("23.09.0"))) {
      throw new IncompatibleError("This function is supported by TriplyDB API version 23.09.0 or greater");
    }
    const accountToUse = account || (await app.getAccount());
    const accountName = accountToUse.slug;
    const queryToCopy = await this.getInfo();
    const newQuery: Models.QueryCreate = {
      name: queryName || queryToCopy.name,
      displayName: metadataToReplace?.displayName || queryToCopy.displayName,
      description: metadataToReplace?.description || queryToCopy.description,
      accessLevel: metadataToReplace?.accessLevel || queryToCopy.accessLevel,
      dataset:
        metadataToReplace && metadataToReplace.dataset
          ? (await metadataToReplace.dataset.getInfo()).id
          : queryToCopy.dataset?.id,
      requestConfig:
        metadataToReplace && metadataToReplace.queryString
          ? { payload: { query: metadataToReplace.queryString } }
          : queryToCopy.requestConfig,
      renderConfig: metadataToReplace?.output ? { output: metadataToReplace.output } : queryToCopy.renderConfig,
      variables: metadataToReplace?.variables || queryToCopy.variables,
      serviceConfig:
        metadataToReplace && metadataToReplace.serviceType
          ? { configuredAs: "serviceType", type: metadataToReplace.serviceType }
          : (("configuredAs" in queryToCopy.serviceConfig) as any) &&
              (queryToCopy.serviceConfig as any).configuredAs === "serviceType" // Any cast, for backwards compatability
            ? queryToCopy.serviceConfig
            : undefined,
    };

    return Query.create(
      accountToUse.app,
      accountToUse,
      newQuery,
      getErr(`Failed to make a copy of ${queryToCopy.name} to account ${accountName}.`),
    );
  }
  private static async create(
    app: App,
    ownerAccount: Account,
    data: Models.QueryCreate,
    errorWithCleanerStack: TriplyDbJsError,
  ) {
    return new Query(
      app,
      await _post<Routes.queries._account.Post>({
        app: app,
        path: "/queries/" + ownerAccount.slug,
        data,
        errorWithCleanerStack,
      }),
      ownerAccount,
    );
  }
}
