import * as fs from "fs-extra";
import AsyncIteratorHelper, { AsyncConfig } from "./AsyncIteratorHelper";

export default class AsyncIteratorHelperWithToFile<ResultType, OutputClass> extends AsyncIteratorHelper<
  ResultType,
  OutputClass
> {
  constructor(config: AsyncConfig<ResultType, OutputClass>) {
    super(config);
  }
  public async toFile(filePath: string) {
    const f = await fs.open(filePath, "w");
    let results: ResultType[] | void;
    while ((results = await this["_getNextPage"]())) {
      if (results && results.length) {
        await fs.write(f, this["_page"]);
      } else {
        break;
      }
    }
    await fs.close(f);
  }
}
