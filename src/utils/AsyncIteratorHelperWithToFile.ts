import * as fs from "fs-extra";
import AsyncIteratorHelper, { AsyncConfig } from "./AsyncIteratorHelper";
import zlib from "zlib";

export interface AsyncConfigWithToFile<ResultType, OutputClass> extends AsyncConfig<ResultType, OutputClass> {
  isBindings?: boolean;
}
export default class AsyncIteratorHelperWithToFile<ResultType, OutputClass> extends AsyncIteratorHelper<
  ResultType,
  OutputClass
> {
  private isBindings?: boolean;
  constructor(config: AsyncConfigWithToFile<ResultType, OutputClass>) {
    super(config);
    this.isBindings = config.isBindings;
  }
  private compress(data: string) {
    return new Promise<Buffer>((resolve, reject) => {
      zlib.gzip(data, (err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
    });
  }
  private getFileHandle(filepath: string) {
    return fs.open(filepath, "w");
  }
  private async writeToFile(fileHandle: number, body: string, opts?: { compressed?: boolean }) {
    if (opts?.compressed) {
      await fs.write(fileHandle, await this.compress(body));
    } else {
      await fs.write(fileHandle, body);
    }
  }
  private async closeFile(fileHandle: number) {
    await fs.close(fileHandle);
  }
  public async toFile(filePath: string, opts?: { compressed?: boolean }) {
    const f = await this.getFileHandle(filePath);
    let results: ResultType[] | string | void;
    if (this.isBindings) {
      // Write bindings to file as tsv
      let writeHeader = true;
      while ((results = (await this["_requestPage"]("tsv"))?.pageInfo.responseText)) {
        if (results && results.length && this["_page"]) {
          const page = this["_page"];
          if (writeHeader) {
            await this.writeToFile(f, page, opts);
          } else {
            const lineBreak = "\n";
            const indexOfLineBreak = page.indexOf(lineBreak);
            const pageNoHeader = page.substring(indexOfLineBreak + lineBreak.length);
            await this.writeToFile(f, pageNoHeader, opts);
          }
          writeHeader = false;
        } else {
          break;
        }
      }
    } else {
      // Write statements to file
      while ((results = await this["_requestParsedPage"]())) {
        if (results && results.length && this["_page"]) {
          await this.writeToFile(f, this["_page"], opts);
        } else {
          break;
        }
      }
    }
    await this.closeFile(f);
  }
}
