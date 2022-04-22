import * as fs from "fs-extra";
import AsyncIteratorHelper, { AsyncConfig } from "./AsyncIteratorHelper";
import zlib from "zlib";

type CustomToFileFn<ResultType, OutputClass> = (iterator: AsyncIteratorHelperWithToFile<ResultType, OutputClass>,filePath: string, opts?: { compressed?: boolean } ) => Promise<void>
export interface AsyncConfigWithToFile<ResultType, OutputClass> extends   AsyncConfig<ResultType,OutputClass>{
  toFile?: CustomToFileFn<ResultType, OutputClass>
}
export default class AsyncIteratorHelperWithToFile<ResultType, OutputClass> extends AsyncIteratorHelper<
  ResultType,
  OutputClass
> {
  private customToFileFn:CustomToFileFn<ResultType, OutputClass> | undefined
  constructor(config: AsyncConfigWithToFile<ResultType,OutputClass>) {
    super(config)
    this.customToFileFn = config.toFile
  }
  private compress(data: string) {
    return new Promise<Buffer>((resolve, reject) => {
      zlib.gzip(data, (err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
    });
  }
  private getFileHandle(filepath:string) {
    return fs.open(filepath, "w");
  }
  private async writeToFile(fileHandle:number, body:string, opts?: { compressed?: boolean } ) {
    if (opts?.compressed) {
      await fs.write(fileHandle, await this.compress(body));
    } else {
      await fs.write(fileHandle, body);
    }
  }
  private async closeFile(fileHandle:number) {
    await fs.close(fileHandle);
  }
  private async _toFile(filePath: string, opts?: { compressed?: boolean }) {
    const f = await this.getFileHandle(filePath)
    let results: ResultType[] | void;
    while ((results = await this["_getPage"]())) {
      if (results && results.length && this["_page"]) {
        await this.writeToFile(f, this["_page"], opts)
      } else {
        break;
      }
    }
    await this.closeFile(f)
  }
  public async toFile(filePath: string, opts?: { compressed?: boolean }) {
    if (this.customToFileFn) {
      return this.customToFileFn(this, filePath, opts)
    }
    return this._toFile(filePath, opts)
  }
}
