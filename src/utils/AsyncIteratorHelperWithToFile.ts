import * as fs from "fs-extra";
import AsyncIteratorHelper, { AsyncConfig } from "./AsyncIteratorHelper";
import zlib from "zlib";
export interface AsyncConfigWithToFile<ResultType, OutputType> extends AsyncConfig<ResultType, OutputType> {
  compressed?: boolean;
}
export default class AsyncIteratorHelperWithToFile<ResultType, OutputClass> extends AsyncIteratorHelper<
  ResultType,
  OutputClass
> {
  private compressed = false;
  constructor(config: AsyncConfigWithToFile<ResultType, OutputClass>) {
    super(config);
    if (config.compressed !== undefined) this.compressed = config.compressed;
  }
  private compress(data: string) {
    return new Promise<Buffer>((resolve, reject) => {
      zlib.gzip(data, (err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
    });
  }
  public async toFile(filePath: string) {
    const f = await fs.open(filePath, "w");
    let results: ResultType[] | void;
    while ((results = await this["_getNextPage"]())) {
      if (results && results.length && this["_page"]) {
        if (this.compressed) {
          await fs.write(f, this.compress(this["_page"]));
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
