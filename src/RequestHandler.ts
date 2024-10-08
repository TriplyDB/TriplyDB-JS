import { HttpMethodTemplate, RequestTemplate } from "@triply/utils/Routes.js";
import App from "./App.js";
import { TriplyDbJsError } from "./utils/Error.js";
import fetch from "cross-fetch";
import FormData from "form-data";
import debug from "debug";
import fs from "fs";
const log = debug("triply:triplydb-js:http");
type ReqMethod = "GET" | "PUT" | "PATCH" | "DELETE" | "POST" | "HEAD";
type ErrorContext = { method: ReqMethod; url: string; message?: Response["statusText"] };
export interface ReqOptsObj<E extends RequestTemplate = any> {
  app: App;
  errorWithCleanerStack: TriplyDbJsError;
  url?: string; //Either path or url must be set
  path?: string;
  query?: E["Query"];
  data?: E["Body"];
  attach?: { [name: string]: Buffer | string | File };
  expectedResponseBody?: "empty" | "json" | "buffer" | "text"; //defaults to json
}
export function normalizePath(path = "") {
  return `/${path}`.replace(new RegExp("//", "g"), "/");
}
export function getUrl(opts: Pick<ReqOptsObj, "url" | "path" | "app" | "query">): string {
  let url: URL;
  if (opts.url) {
    url = new URL(opts.url);
  } else {
    if (opts.path?.startsWith("http")) {
      // There is a bug in triplydb-js: we should use `url:` instead of `path:` for these cases
      throw new Error(`Expected a path, but got URL ${opts.path} instead`);
    }
    const apiUrl = opts.app.url;
    if (!apiUrl) throw new Error("Expected a url or path to be set");
    url = new URL(apiUrl + normalizePath(opts?.path));
  }
  if (opts.query) {
    url.search = new URLSearchParams(opts.query).toString();
  }
  return url.toString();
}
/**
 * Either pass a full URL (incl domain) or pass a req opts with things like path
 */
export function _get<T extends HttpMethodTemplate>(opts: ReqOptsObj<T["Req"]>) {
  return handleFetchAsPromise("GET", opts);
}
export function _delete<T extends HttpMethodTemplate>(opts: ReqOptsObj<T["Req"]>) {
  return handleFetchAsPromise("DELETE", opts);
}
export function _post<T extends HttpMethodTemplate>(opts: ReqOptsObj<T["Req"]>) {
  return handleFetchAsPromise("POST", opts);
}
export function _patch<T extends HttpMethodTemplate>(opts: ReqOptsObj<T["Req"]>) {
  return handleFetchAsPromise("PATCH", opts);
}
type SimpleRequestInit = Omit<RequestInit, "headers"> & {
  // For ease of use, always use objects
  headers?: { [key: string]: string };
};
export function getFetchOpts(requestInit: SimpleRequestInit, opts: { app: App }): SimpleRequestInit {
  const token = opts.app["_config"].token;
  if (!requestInit.headers) requestInit.headers = {};
  requestInit.headers["X-Triply-Client"] = "triplydb-js";
  if (token) {
    requestInit.headers["Authorization"] = "Bearer " + token;
  }

  return requestInit;
}
export function requestConfigToFetchConfig(
  method: ReqMethod,
  config: Pick<ReqOptsObj, "app" | "data" | "attach">,
): SimpleRequestInit {
  const reqConfig: SimpleRequestInit = { method };
  const headers: { [key: string]: string } = {};
  if (config.data) {
    headers["Content-Type"] = "application/json";
    reqConfig.body = JSON.stringify(config.data);
  } else if (config.attach) {
    const data = new FormData();
    for (const [name, body] of Object.entries(config.attach)) {
      if (typeof body === "string") {
        data.append(name, fs.createReadStream(body));
      } else {
        data.append(name, body);
      }
    }
    reqConfig.body = data as any;
  }
  reqConfig.headers = headers;
  return getFetchOpts(reqConfig, { app: config.app });
}
async function handleFetchAsPromise<T extends HttpMethodTemplate>(
  method: ReqMethod,
  opts: ReqOptsObj<T["Req"]>,
): Promise<T["Res"]["Body"]> {
  const url = getUrl(opts);
  log(`_${method.toLowerCase()}`, url);
  const reqOpts = requestConfigToFetchConfig(method, opts);
  const errorContext: ErrorContext = { method, url };

  let response: Response;
  try {
    response = await fetch(url, reqOpts);
  } catch (e: any) {
    log(`Cannot get response`, e);
    // This error only occurs when there are network errors and such
    throw opts.errorWithCleanerStack.addContext(errorContext).setCause(e);
  }
  // We kept the statusCode outside errorContext because the tests were breaking, for example when testing ensureDataset().
  // We can fix the ensureDataset function in another ticket.
  opts.errorWithCleanerStack.statusCode = response.status;
  errorContext.message = response.statusText;
  const consoleOnlyHeader = response.headers.get("x-triply-api");
  if (consoleOnlyHeader) {
    throw opts.errorWithCleanerStack
      .addContext(errorContext)
      .setCause(
        new Error(
          `You tried connecting TriplyDB-js to a TriplyDB front-end. Please use the URL of the API instead: ${consoleOnlyHeader}`,
        ),
      );
  }

  const expectJsonResponse = !opts.expectedResponseBody || opts.expectedResponseBody === "json";
  const responseContentType = response.headers.get("Content-Type");
  const hasJsonResponse = responseContentType && responseContentType.indexOf("application/json") === 0;
  if (expectJsonResponse && !hasJsonResponse) {
    // This should never happen. If it does, there's probably a bug in our API
    throw opts.errorWithCleanerStack
      .addContext(errorContext)
      .setCause(new Error(`Expected a JSON response, but got ${responseContentType}.`));
  }
  let result: undefined | {} | [] | Buffer;
  if (hasJsonResponse) {
    try {
      result = await response.json();
    } catch (e: any) {
      // We failed to parse the response as json.
      // This should never happen. If it does, there's probably a bug in our API
      throw opts.errorWithCleanerStack.addContext(errorContext).setCause(e);
    }
  } else if (opts.expectedResponseBody === "buffer") {
    result = await (response as any).buffer();
  } else if (opts.expectedResponseBody === "text") {
    result = await response.text();
  }

  if (response.status === 404) {
    throw opts.errorWithCleanerStack.addContext(errorContext).setCause(new TriplyDbJsError(`It does not exist`));
  }

  if (response.status >= 400) {
    throw opts.errorWithCleanerStack
      .addContext(errorContext)
      .setCause(response, result instanceof Buffer ? undefined : result);
  }
  return result;
}
export async function handleFetchAsStream<T extends HttpMethodTemplate>(
  method: ReqMethod,
  opts: ReqOptsObj<T["Req"]>,
): Promise<ReadableStream<Uint8Array>> {
  const url = getUrl(opts);
  log(`_${method.toLowerCase()}`, url);
  const reqOpts = requestConfigToFetchConfig(method, opts);
  const errorContext = { method, url };
  let response: Response;
  try {
    response = await fetch(url, reqOpts);
  } catch (e: any) {
    // This error only occurs when there are network errors and such
    throw opts.errorWithCleanerStack.addContext(errorContext).setCause(e);
  }
  const consoleOnlyHeader = response.headers.get("x-triply-api");
  if (consoleOnlyHeader) {
    throw opts.errorWithCleanerStack
      .addContext(errorContext)
      .setCause(
        new Error(
          `You tried connecting TriplyDB-js to a TriplyDB front-end. Please use the URL of the API instead: ${consoleOnlyHeader}`,
        ),
      );
  }

  const responseContentType = response.headers.get("Content-Type");
  const hasJsonResponse = responseContentType && responseContentType.indexOf("application/json") === 0;
  let jsonResult: undefined | {} | [];
  if (hasJsonResponse) {
    //We're fetching something as a stream.
    //We're not expecing json here, so this is probably an error response (with json in it)
    try {
      jsonResult = await response.json();
    } catch (e: any) {
      throw opts.errorWithCleanerStack.addContext(errorContext).setCause(e);
    }
  }
  if (response.status >= 400) {
    throw opts.errorWithCleanerStack.addContext(errorContext).setCause(response, jsonResult);
  }
  if (!response.body) {
    throw opts.errorWithCleanerStack.addContext(errorContext).setCause(new Error(`Unexpected empty response.`));
  }
  return response.body;
}
