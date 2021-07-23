import * as fs from "fs-extra";
import AsyncIteratorHelper from "./AsyncIteratorHelper";
import zlib from "zlib";

export default class AsyncIteratorHelperWithToFile<ResultType, OutputClass> extends AsyncIteratorHelper<
  ResultType,
  OutputClass
> {
  private compress(data: string) {
    return new Promise<Buffer>((resolve, reject) => {
      zlib.gzip(data, (err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
    });
  }
  public async toFile(filePath: string, opts?: { compressed?: boolean }) {
    const f = await fs.open(filePath, "w");
    let results: ResultType[] | void;
    while ((results = await this["_getPage"]())) {
      if (results && results.length && this["_page"]) {
        if (opts?.compressed) {
          await fs.write(f, await this.compress(this["_page"]));
        } else {
          await fs.write(f, this["_page"]);
        }
      } else {
        break;
      }
    }
    await fs.close(f);
  }
}
