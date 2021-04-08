import parseLinkHeader from "parse-link-header";
import { _get, getRequestConfig } from "../RequestHandler";
import { TriplyDbJsError } from "./Error";
import App from "../App";
import fetch from "cross-fetch";
if (!Symbol.asyncIterator) {
  (<any>Symbol).asyncIterator = Symbol.for("Symbol.asyncIterator");
}

export interface AsyncConfig<ResultType, OutputType> {
  getUrl: () => Promise<string>;
  mapResult: (resource: ResultType) => Promise<OutputType>;
  app: App;
  error: TriplyDbJsError;
  getErrorMessage: () => Promise<string>;
  parsePage?: (page: string) => Promise<ResultType[]>;
}

export default class AsyncIteratorHelper<ResultType, OutputClass> {
  private _next: string | undefined | null;
  private _config: AsyncConfig<ResultType, OutputClass>;
  private _currentPage: ResultType[] = [];
  private _page: string | undefined;

  constructor(conf: AsyncConfig<ResultType, OutputClass>) {
    this._config = conf;
  }

  private async _getNextPage(): Promise<ResultType[] | void> {
    if (this._next === null) return;
    const reqConfig = getRequestConfig("GET", { app: this._config.app, errorWithCleanerStack: this._config.error });
    const url = this._next || (await this._config.getUrl());
    try {
      const resp = await fetch(url, reqConfig);
      this._config.error.statusCode = resp.status;
      const pageString = await resp.text();
      if (resp.status >= 400) {
        const contentType = resp.headers.get("content-type");
        let response: {} | undefined;
        if (contentType && contentType.indexOf("application/json") === 0) {
          response = JSON.parse(pageString);
        }
        this._config.error.message = await this._config.getErrorMessage();
        let context: any = { method: "GET", url };
        if (response) context.response = response;
        throw this._config.error.addContext(context).setCause(resp, response);
      }
      const linkHeaders = parseLinkHeader(resp.headers.get("link") || "");
      this._next = linkHeaders?.["next"] && linkHeaders["next"].url ? linkHeaders["next"].url : null;
      const parsePage = this._config.parsePage || JSON.parse;

      this._page = pageString;
      let results: any;
      try {
        results = await parsePage(pageString);
      } catch (e) {
        this._config.error.message = (await this._config.getErrorMessage()) + ": Failed to parse response.";
        this._config.error.addContext({ method: "GET", url }).setCause(resp, results);
        throw this._config.error;
      }
      return results;
    } catch (e) {
      this._config.error.message = await this._config.getErrorMessage();
      throw this._config.error.addContext({ method: "GET", url }).setCause(e);
    }
  }

  private async _get(): Promise<ResultType | void> {
    if (!this._currentPage.length) this._currentPage = (await this._getNextPage()) || [];
    if (this._currentPage.length) return this._currentPage.shift();
  }
  public async toArray() {
    const results: OutputClass[] = [];
    for await (const result of this) {
      results.push(result);
    }
    return results;
  }
  public [Symbol.asyncIterator]() {
    return {
      next: async () => {
        const info = await this._get();
        if (info) {
          return {
            done: false,
            value: await this._config.mapResult(info),
          };
        } else {
          return {
            done: true,
          } as const;
        }
      },
    };
  }
}
