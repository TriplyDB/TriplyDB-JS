import parseLinkHeader from "parse-link-header";
import { _get, requestConfigToFetchConfig } from "../RequestHandler";
import { TriplyDbJsError } from "./Error";
import App from "../App";
import fetch from "cross-fetch";
import { CachedResult, Cache } from "./cache";
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
  cache?: Cache;
}

export default class AsyncIteratorHelper<ResultType, OutputClass> implements AsyncIterable<OutputClass> {
  /**
   *  undefined:  iteration hasn't started
   *  null:       iteration has finished
   */
  private _next: string | undefined | null;
  private _config: AsyncConfig<ResultType, OutputClass>;
  private _currentPage: ResultType[] = [];
  // @ts-ignore Used in AsyncIteratorHelperWithToFile
  private _page: string | undefined;
  constructor(conf: AsyncConfig<ResultType, OutputClass>) {
    this._config = conf;
  }

  private async possiblyCachedResults(url: string, reqConfig?: RequestInit): Promise<CachedResult> {
    if (this._config.cache) {
      try {
        const cached = await this._config.cache.read({ url, config: reqConfig });
        if (cached) {
          return cached;
        }
      } catch (e) {
        if ("message" in e) {
          e.message = "Error while reading from the cache: " + e.message;
        }
        throw e;
      }
    }
    const res = await fetch(url, reqConfig);
    const statusCode = res.status;
    const responseText = await res.text();
    const contentType = res.headers.get("content-type");
    const linkHeaders = parseLinkHeader(res.headers.get("link") || "");
    const nextPage = linkHeaders?.["next"] && linkHeaders["next"].url ? linkHeaders["next"].url : null;
    const result: CachedResult = {
      statusCode,
      responseText,
      contentType,
      nextPage,
      statusText: res.statusText,
    };

    this._config.error.statusCode = result.statusCode;
    if (result.statusCode >= 400) {
      let response: {} | undefined;
      if (result.contentType && result.contentType.indexOf("application/json") === 0) {
        response = JSON.parse(result.responseText);
      }
      this._config.error.message = await this._config.getErrorMessage();
      let context: any = { method: "GET", url };
      if (response) context.response = response;
      throw this._config.error.addContext(context).setCause(result, response);
    }

    if (this._config.cache) {
      // only write to cache after we check the status
      await this._config.cache.write({ url, config: reqConfig }, result);
    }
    return result;
  }

  private async _getPage(): Promise<ResultType[] | void> {
    if (this._next === null) return; // iteration has finished
    const reqConfig = requestConfigToFetchConfig("GET", {
      app: this._config.app,
    });
    const url = this._next || (await this._config.getUrl());
    try {
      const pageResponseInfo = await this.possiblyCachedResults(url, reqConfig);
      this._next = pageResponseInfo.nextPage;
      const parsePage = this._config.parsePage || JSON.parse;
      this._page = pageResponseInfo.responseText;
      let results: any;
      try {
        results = await parsePage(pageResponseInfo.responseText);
      } catch (e) {
        this._config.error.message = (await this._config.getErrorMessage()) + ": Failed to parse response.";
        this._config.error.addContext({ method: "GET", url }).setCause(pageResponseInfo, results);
        throw this._config.error;
      }
      return results;
    } catch (e) {
      if (e instanceof TriplyDbJsError) throw e;
      this._config.error.message = await this._config.getErrorMessage();
      throw this._config.error.addContext({ method: "GET", url }).setCause(e);
    }
  }

  private async _get(): Promise<ResultType | void> {
    // Reverse and use `.pop`, as `shift` is an O(n) operation.
    if (!this._currentPage.length) this._currentPage = ((await this._getPage()) || []).reverse();
    if (this._currentPage.length) return this._currentPage.pop();
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
            value: undefined,
          } as const;
        }
      },
    };
  }
}
