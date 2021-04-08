import { Models, Routes } from "@triply/utils";
import App from "./App";
import { _get, _patch, _delete } from "./RequestHandler";
import { Account } from "./Account";
import { getErr } from "./utils/Error";
import AsyncIteratorHelper from "./utils/AsyncIteratorHelper";
import * as n3 from "n3";
import sparqljs from "sparqljs";
import { stringify as stringifyQueryObj } from "query-string";
import AsyncIteratorHelperWithToFile from "./utils/AsyncIteratorHelperWithToFile";
export default class Query {
  private _app: App;
  private _info: Models.Query;
  private _owner: Account;

  constructor(app: App, info: Models.Query, owner: Account) {
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
  private async _getPath() {
    const ownerName = await this._owner.getName();
    return "/queries/" + ownerName + "/" + this._info.name;
  }
  private async _getQueryNameWithOwner() {
    const ownerName = await this._owner.getName();
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

  private _setInfo(info: Models.Query) {
    this._info = info;
    return this;
  }
  public async update(config: Models.QueryMetaUpdate) {
    const updateData = { ...config };
    if (!updateData.dataset) {
      updateData.dataset = this._info.dataset?.id;
    }
    this._setInfo(
      await _patch<Routes.queries._account._query.Patch>({
        errorWithCleanerStack: getErr(`Failed to update query information of ${this._info.name}.`),
        app: this._app,
        path: await this._getPath(),
        data: updateData,
      })
    );
    return this;
  }
  public async delete() {
    await _delete<Routes.queries._account._query.Delete>({
      errorWithCleanerStack: getErr(`Failed to delete query ${this._info.name}.`),
      app: this._app,
      path: await this._getPath(),
      expectedResponseBody: "empty",
    });
  }

  public results(variableValues?: { [variable: string]: string }) {
    const queryType = this._getQueryType();

    const queryString = stringifyQueryObj({
      page: 1,
      pageSize: 5000,
      ...(variableValues || {}),
    });

    const iteratorOptions = {
      error: getErr(`Failed to run query`),
      getErrorMessage: async () => `Failed to get results for query ${await this.getInfo().then((i) => i.name)}.`,
      app: this._app,
    };

    return {
      statements: () => {
        if (queryType !== "CONSTRUCT" && queryType !== "DESCRIBE") {
          throw getErr("Statements are only supported for CONSTRUCT and DESCRIBE queries.");
        }
        const parser = new n3.Parser();
        return new AsyncIteratorHelperWithToFile<n3.Quad, n3.Quad>({
          ...iteratorOptions,
          mapResult: async (result) => result,
          // use .ttl since it works both for jena and virtuoso.
          getUrl: async () => this._app["_config"].url + ((await this._getPath()) + "/run.ttl?" + queryString),
          parsePage: async (page: string) => {
            if (page === "OK") return []; // empty page (jena);
            // empty page (virtuoso) is a valid empty turtle doc, no check needed.
            return parser.parse(page);
          },
        });
      },
      bindings: () => {
        if (queryType !== "SELECT") {
          throw getErr("Bindings are only supported for SELECT queries.");
        }
        type Binding = { [key: string]: string };
        return new AsyncIteratorHelper<Binding, Binding>({
          ...iteratorOptions,
          mapResult: async (result) => result,
          getUrl: async () => this._app["_config"].url + ((await this._getPath()) + "/run?" + queryString),
        });
      },
    };
  }
}
