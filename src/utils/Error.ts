import { CachedResult } from "./cache.js";
import { Response } from "cross-fetch";

const tokenRegex = /[a-z0-9\-\_\.]{280,}/gi;

type Context = { [key: string]: any };
export class IncompatibleError extends Error {}
export class TriplyDbJsError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    message = message.replaceAll(tokenRegex, "<token>");
    if (options?.cause) {
      if (options.cause instanceof Error) {
        options.cause.message = options.cause.message.replaceAll(tokenRegex, "<token>");
      }
    }
    super(message, options);
  }
  public statusCode?: number;
  public context: Context = {};

  public setMessage(msg: string) {
    this.message = msg.replaceAll(tokenRegex, "<token>");
    return this;
  }
  public addContext(data: Context) {
    this.context = { ...this.context, ...data };
    return this;
  }
  public setStatusCode(statusCode: number) {
    this.statusCode = statusCode;
    return this;
  }

  public setCause(error: Error | Response | CachedResult, jsonResult?: any) {
    if (error instanceof Error) {
      this.message = `${this.message} (${error.message.replaceAll(tokenRegex, "<token>")})`;
    } else if (error instanceof Response) {
      this.message = `${this.message} (${error.status}: ${
        jsonResult && jsonResult.message ? jsonResult.message : error.statusText
      })`;
    } else {
      this.message = `${this.message} (${error.statusCode}: ${
        jsonResult && jsonResult.message ? jsonResult.message : error.statusText
      })`;
    }
    return this;
  }
}
export function getErr(message: string) {
  const err = new TriplyDbJsError(message);
  // CaptureStackTrace is node-specific, so lets check if the function exists
  Error.captureStackTrace?.(err, getErr);
  return err;
}
