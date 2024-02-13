import App from "../App.js";
import { Account } from "../Account.js";
import { getErr } from "../utils/Error.js";
import { _get, _delete, _patch, _post } from "../RequestHandler.js";
import { wait } from "../utils/index.js";
import { QueryJobCreate, QueryJobModel, Routes_queryJobs } from "./QueryJobModels.js";
export default class QueryJob {
  private _app: App;
  private _account: Account;

  constructor(app: App, account: Account) {
    this._app = app;
    this._account = account;
  }

  public async createQueryJob(args: QueryJobCreate) {
    const accountName = (await this._account.getInfo()).accountName;
    const pathChunks: string[] = ["queryJobs", accountName];
    const path = "/" + pathChunks.join("/");
    let waitFor = 100; // 100ms;

    const check = async (): Promise<any> => {
      try {
        console.info(`Attempting to create query job...`);
        const createdQueryJob = await _post<Routes_queryJobs._account.Post>({
          app: this._app,
          errorWithCleanerStack: getErr(`Failed to create query job'`),
          data: args,
          path: path,
          expectedResponseBody: "json",
        });
        console.info(`Query job created for ${createdQueryJob.query.name}`);
        return await this.checkIfJobIsFinished(createdQueryJob._id);
      } catch (e: any) {
        // Query job limit exceeded
        if ("context" in e && e.context.method === "POST" && "statusCode" in e && e.statusCode === 503) {
          // ensures this only executed on POST 503
          console.info(
            `Query job max limit exceeded. Retrying in ${
              waitFor > 1000 ? `${Math.floor(waitFor / 1000)}s` : `${waitFor}ms`
            }`
          );
          await wait(waitFor);
          if (waitFor < 600000) waitFor = waitFor * 2; //max 10 mins
          return check();
        } else {
          throw e;
        }
      }
    };
    return check();
  }

  private async checkIfJobIsFinished(queryJobId: string): Promise<QueryJobModel> {
    let waitFor = 100; //100ms
    const accountName = (await this._account.getInfo()).accountName;
    const pathChunks: string[] = ["queryJobs", accountName, queryJobId];
    const path = "/" + pathChunks.join("/");

    const check = async (): Promise<QueryJobModel> => {
      const queryJob = await _get<Routes_queryJobs._account._queryJob.Get>({
        errorWithCleanerStack: getErr(`Failed to get query job status`),
        app: this._app,
        path: path,
        expectedResponseBody: "json",
      });

      switch (true) {
        case queryJob.status === "error":
          throw getErr(queryJob.errorMessage || "Query job failed with an error");
        case queryJob.status === "finished":
          if (!!queryJob.progress && queryJob.progress !== -1)
            console.info(`Query job progress... ${queryJob.progress * 100}%`);

          console.info(`Query job is finished`);
          return queryJob;
        default:
          if (!!queryJob.progress && queryJob.progress !== -1)
            console.info(`Query job progress... ${queryJob.progress * 100}%`);
      }
      await wait(waitFor);
      if (waitFor < 300000) waitFor = waitFor * 2; //max 5 mins
      return check();
    };
    return check();
  }

  public async deleteQueryJob(queryJobId: string) {
    const accountName = (await this._account.getInfo()).accountName;
    const pathChunks: string[] = ["queryJobs", accountName, queryJobId];
    const path = "/" + pathChunks.join("/");

    await _delete<Routes_queryJobs._account._queryJob.Delete>({
      errorWithCleanerStack: getErr(`Failed to delete query job`),
      app: this._app,
      path: path,
      expectedResponseBody: "json",
    });
  }
}
