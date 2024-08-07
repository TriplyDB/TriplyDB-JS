import App from "./App.js";
import { Account } from "./Account.js";
import { getErr } from "./utils/Error.js";
import { _get, _delete, _patch, _post } from "./RequestHandler.js";
import { wait } from "./utils/index.js";
import { Routes, Models } from "@triply/utils";
import { isEqual } from "lodash-es";

export type PipelineProgress = {
  progress: number;
  status: Models.Pipeline["status"];
  pending: Models.PipelineJob[];
  running: Models.PipelineJob[];
  finished: Models.PipelineJob[];
};
const timeLog = (...args: string[]) => console.info(`[${new Date().toISOString()}]`, ...args);

export function defaultLogger(progress: PipelineProgress) {
  {
    const progressString = `${(progress.progress * 100).toFixed(0)}%`;
    timeLog(`Pipeline status (${progressString}):`);
    timeLog(
      `  - Running: ${progress.running.length} ${progress.running.length > 0 ? "| " : ""}${progress.running
        .map((qj) => {
          const progress = qj.progress >= 0 ? `${(qj.progress * 100).toFixed(0)}%` : "unknown";
          return `${qj.query?.owner}/${qj.query?.name} (${progress})`;
        })
        .join(", ")}`,
    );
    timeLog(`  - Pending: ${progress.pending.length}`);
    timeLog(`  - Finished: ${progress.finished.length}`);
    if (progress.status === "finished") timeLog("Pipeline finished");
  }
}

export async function createPipeline(forAccount: Account, args: Models.PipelineConfig) {
  const appInfo = await forAccount.app.getInfo();
  if (appInfo.featureToggles && "queryJobsApi" in appInfo.featureToggles && !appInfo.featureToggles.queryJobsApi) {
    throw getErr("Pipeline functionality is not yet enabled on this TriplyDB deployment.");
  }
  return _post<Routes.pipelines._account.Post>({
    app: forAccount.app,
    errorWithCleanerStack: getErr(`Failed to create pipeline'`),
    data: args,
    path: `/pipelines/${forAccount.slug}`,
    expectedResponseBody: "json",
  });
}

export default class Pipeline {
  private _app: App;
  private _account: Account;
  private _info: Models.Pipeline;
  public slug: string;
  constructor(app: App, account: Account, info: Models.Pipeline) {
    this._app = app;
    this._account = account;
    this._info = info;
    this.slug = info.id;
  }

  public async waitForPipelineToFinish(opts?: { onProgress?: (progress: PipelineProgress) => void }) {
    let waitForMs = 100;
    let lastPipelineProgress: PipelineProgress | undefined;
    while (true) {
      this._info = await _get<Routes.pipelines._account._pipeline.Get>({
        errorWithCleanerStack: getErr(`Failed to get pipeline status`),
        app: this._app,
        path: `/pipelines/${this._account.slug}/${this.slug}`,
        expectedResponseBody: "json",
      });
      const pipelineProgress = {
        progress: this._info.progress,
        status: this._info.status,
        pending: this._info.jobs.filter((qj) => qj.status === "pending"),
        running: this._info.jobs.filter((qj) => qj.status === "running"),
        finished: this._info.jobs.filter((qj) => qj.status === "finished"),
      } satisfies PipelineProgress;

      if (!isEqual(pipelineProgress, lastPipelineProgress)) {
        opts?.onProgress?.(pipelineProgress);
        lastPipelineProgress = pipelineProgress;
      }

      if (this._info.status === "error") {
        if (this._info.error && "message" in this._info.error) {
          throw getErr(`Pipeline failed : ${this._info.error.message}`);
        } else {
          throw getErr(`Pipeline failed with unknown error`);
        }
      }

      if (this._info.status === "cancelled") {
        throw getErr(`Pipeline was canceled`);
      }
      if (this._info.status === "finished") {
        return;
      }
      await wait(waitForMs);
      if (waitForMs < 300000) waitForMs = waitForMs * 2; //max 5 mins
    }
  }
}
