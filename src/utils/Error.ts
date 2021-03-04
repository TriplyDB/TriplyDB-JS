type Context = { [key: string]: any };
export class IncompatibleError extends Error {}
export class TriplyDbJsError extends Error {
  public statusCode?: number;
  public context: Context = {};

  public setMessage(msg: string) {
    this.message = msg;
    return this;
  }
  public addContext(data: Context) {
    this.context = { ...this.context, ...data };
    return this;
  }

  public setCause(error: Error | Response, jsonResult?: any) {
    if (error instanceof Error) {
      this.message = `${this.message} (${error.message})`;
    } else {
      this.message = `${this.message} (${error.status}: ${
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
