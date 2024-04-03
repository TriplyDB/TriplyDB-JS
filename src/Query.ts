import { Models, Routes } from "@triply/utils";
import { parseAndInjectVariablesIntoQuery, validate } from "@triply/utils/sparqlVarUtils.js";
import App from "./App.js";
import { _get, _patch, _delete, _post } from "./RequestHandler.js";
import { Account } from "./Account.js";
import { getErr, IncompatibleError } from "./utils/Error.js";
import { Cache } from "./utils/cache.js";
import * as n3 from "n3";
import sparqljs from "sparqljs";
import { stringify as stringifyQueryObj } from "query-string";
import AsyncIteratorHelperWithToFile from "./utils/AsyncIteratorHelperWithToFile.js";
import { VariableConfig } from "@triply/utils/Models.js";

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
export default class Query {
  private _app: App;
  private _info: Models.Query;
  private _owner: Account;
  private _version: number | undefined;
  public readonly type = "Query";
  public constructor(app: App, info: Models.Query, owner: Account) {
    this._app = app;
    this._info = info;
    this._owner = owner;
  }
  private _getQueryType() {
    const queryString = this["_info"].requestConfig?.payload.query;
    if (!queryString) throw getErr(`Query ${this._info.name} has no versions.`);
    const parser = new sparqljs.Parser();
    const parsed = parser.parse(queryString);
    if (parsed.type === "query") {
      return parsed.queryType;
    } else {
      throw getErr("Update-queries are not supported");
    }
  }
  private async _getPath(opts?: { ignoreVersion?: boolean }) {
    const accountName = (await this._owner.getInfo()).accountName;
    const pathChunks: string[] = ["queries", accountName, this._info.name];
    if (!opts?.ignoreVersion && typeof this._version === "number") {
      pathChunks.push(String(this._version));
    }
    return "/" + pathChunks.join("/");
  }
  private async _getQueryNameWithOwner() {
    const ownerName = (await this._owner.getInfo()).accountName;
    return `${ownerName}/${this._info.name}`;
  }
  public async getInfo(refresh = false): Promise<Models.Query> {
    if (!refresh && this._info) return this._info;
    this._info = (await _get<Routes.queries._account._query.Get>({
      errorWithCleanerStack: getErr(`Failed to get information of query ${await this._getQueryNameWithOwner()}.`),
      app: this._app,
      path: await this._getPath(),
    })) as Models.Query;
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
      app: this._app,
      errorWithCleanerStack: getErr(`Failed to add a new version to query '${this["_info"].name}'`),
      data: updateQueryInfo,
      path: await this._getPath(),
    });
    return this;
  }
  private _setInfo(info: Models.Query) {
    this._info = info;
    return this;
  }
  public async useVersion(version: number | "latest") {
    const numVersions = this._info.numberOfVersions;
    if (!numVersions) throw getErr(`Query ${this._info.name} has no versions.`);
    if (version === "latest") {
      this._version = undefined;
      return this;
    }
    if (version > numVersions || version < 0) {
      throw getErr(
        `Query ${this._info.name} has ${numVersions} ${
          numVersions > 1 ? "versions" : "version"
        }. Version ${version} does not exist.`
      );
    }
    this._version = version;
    await this.getInfo(true);
    return this;
  }
  public async update(config: Models.QueryMetaUpdate) {
    if (!(await this._app.isCompatible("23.09.0"))) {
      throw new IncompatibleError(
        "This function has been updated and is now supported by TriplyDB API version 23.09.0 or greater"
      );
    }
    const updateData = { ...config };
    if (!updateData.dataset) {
      updateData.dataset = this._info.dataset?.id;
    }
    this._setInfo(
      await _patch<Routes.queries._account._query.Patch>({
        errorWithCleanerStack: getErr(`Failed to update query information of ${this._info.name}.`),
        app: this._app,
        path: await this._getPath({ ignoreVersion: true }),
        data: updateData,
      })
    );
    return this;
  }
  public async delete() {
    await _delete<Routes.queries._account._query.Delete>({
      errorWithCleanerStack: getErr(`Failed to delete query ${this._info.name}.`),
      app: this._app,
      path: await this._getPath({ ignoreVersion: true }),
      expectedResponseBody: "empty",
    });
  }
  public async getString(variableValues?: VariableValues) {
    const info = await this.getInfo();
    if (!info.requestConfig?.payload.query) {
      throw getErr(`Query ${this._info.name} has no versions.`);
    }
    if (!info.variables) return info.requestConfig.payload.query;
    validate({ variableDefinitions: info.variables, variableValues: variableValues || {} });
    return parseAndInjectVariablesIntoQuery(info.requestConfig.payload.query, {
      variableDefinitions: info.variables,
      variableValues: variableValues || {},
    });
  }
  public async getApiUrl(subpath?: string) {
    return this._app["getPostProcessedApiUrl"]((await this.getInfo()).link + subpath);
  }
  public async getRunLink() {
    return this.getApiUrl("/run");
  }
  public results(variables?: VariableValues, opts?: { cache?: Cache }) {
    const queryType = this._getQueryType();

    const variablesInUrlString = stringifyQueryObj({
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
      app: this._app,
      cache: opts?.cache,
    };

    const getAsyncIteratorHelperWithToFile = <FromType, ToType>(mapResult: (result: FromType) => Promise<ToType>) => {
      return new AsyncIteratorHelperWithToFile<FromType, ToType>({
        ...iteratorOptions,
        isBindings: true,
        mapResult,
        getUrl: async (contentType) =>
          this._app["_config"].url +
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
          getUrl: async () => this._app["_config"].url + ((await this._getPath()) + "/run.nt?" + variablesInUrlString),
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
          Promise.resolve(result.boolean)
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
}
