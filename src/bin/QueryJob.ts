import App from "../App.js";
import { Account } from "../Account.js";
import { getErr } from "../utils/Error.js";
import { _get, _delete, _patch, _post } from "../RequestHandler.js";
import { wait } from "../utils/index.js";
import { QueryJobPipelineCreate, Routes_queryJobs } from "./QueryJobModels.js";
import { isEqual } from "lodash-es";

const time = () => new Date().toISOString();

export type QueryNames = {
  queryAccountName: string;
  queryName: string;
}[];

type PipelineProgress = {
  pending: QueryJobStatus[];
  running: QueryJobStatus[];
  finished: QueryJobStatus[];
};

type QueryJobStatus = {
  ownerName: string;
  queryName: string;
  status: string;
  progress: number;
};

export default class QueryJob {
  private _app: App;
  private _account: Account;

  constructor(app: App, account: Account) {
    this._app = app;
    this._account = account;
  }

  public async createQueryJobPipeline(args: QueryJobPipelineCreate, queryNames: QueryNames) {
    const accountName = (await this._account.getInfo()).accountName;
    const pathChunks: string[] = ["queryJobs", accountName, "pipeline"];
    const path = "/" + pathChunks.join("/");

    console.info(`[${time()}] Attempting to create pipeline`);
    const createdQueryJob = await _post<Routes_queryJobs._account.pipeline.Post>({
      app: this._app,
      errorWithCleanerStack: getErr(`Failed to create query job pipeline'`),
      data: args,
      path: path,
      expectedResponseBody: "json",
    });
    console.info(`[${time()}] Pipeline created (${createdQueryJob.pipelineId}) for ${args.queries.length} queries:`);
    for (const queryName of queryNames) {
      console.info(`[${time()}]   - ${queryName.queryAccountName}/${queryName.queryName}`);
    }
    await this.waitForPipelineToFinish(createdQueryJob.pipelineId);
    return createdQueryJob.pipelineId;
  }

  private async waitForPipelineToFinish(pipelineId: string) {
    let waitFor = 100; //100ms
    const accountName = (await this._account.getInfo()).accountName;
    const pathChunks: string[] = ["queryJobs", accountName, "pipeline", pipelineId];
    const path = "/" + pathChunks.join("/");
    let lastProgressLogged: string | undefined;
    let lastPipelineProgress: PipelineProgress | undefined;
    const check = async (): Promise<void> => {
      const pipeline = await _get<Routes_queryJobs._account.pipeline._pipeline.Get>({
        errorWithCleanerStack: getErr(`Failed to get pipeline status`),
        app: this._app,
        path: path,
        expectedResponseBody: "json",
      });

      const progress = `${(pipeline.progress * 100).toFixed(0)}%`;
      if (progress !== lastProgressLogged) {
        console.info(`[${time()}] Progress: ${progress}`);
        lastProgressLogged = progress;
      }

      const pipelineProgress = {
        pending: pipeline.queries.filter((qj) => qj.status === "pending"),
        running: pipeline.queries.filter(
          (qj) => qj.status === "running" || qj.status === "resultsReady" || qj.status === "servingResults"
        ),
        finished: pipeline.queries.filter((qj) => qj.status === "finished"),
      } satisfies PipelineProgress;

      if (!isEqual(pipelineProgress, lastPipelineProgress)) {
        console.info(`[${time()}] Latest pipeline jobs:`);
        console.info(
          `[${time()}]   - Running: ${pipelineProgress.running.length} ${
            pipelineProgress.running.length > 0 ? "| " : ""
          }${pipelineProgress.running
            .map((qj) => {
              const progress = `${(qj.progress * 100).toFixed(0)}%`;
              return `${qj.ownerName}/${qj.queryName} (${progress})`;
            })
            .join(", ")}`
        );
        console.info(`[${time()}]   - Pending: ${pipelineProgress.pending.length}`);
        console.info(`[${time()}]   - Finished: ${pipelineProgress.finished.length}`);
        if (pipeline.pipelineStatus === "importing") {
          console.info(`[${time()}] All query jobs completed. Generating final graph.`);
        }
        lastPipelineProgress = pipelineProgress;
      }

      switch (true) {
        case pipeline.pipelineStatus === "error": {
          if (pipeline.pipelineError && "message" in pipeline.pipelineError) {
            throw getErr(`[${time()}] Pipeline failed : ${pipeline.pipelineError.message}`);
          } else {
            throw getErr(`[${time()}] Pipeline failed with an error`);
          }
        }
        case pipeline.pipelineStatus === "finished": {
          console.info(`[${time()}] Pipeline is finished`);
          return;
        }
        case pipeline.pipelineStatus === "cancelled":
          throw getErr(`[${time()}] Pipeline was canceled`);
      }
      await wait(waitFor);
      if (waitFor < 300000) waitFor = waitFor * 2; //max 5 mins
      return check();
    };
    return check();
  }
}
