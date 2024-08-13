#!/usr/bin/env node

import { program } from "commander";
import colors from "colors";
import App from "../App.js";
import Pipeline, { createPipeline, defaultLogger } from "../Pipeline.js";
import { Models } from "@triply/utils";
import fs from "fs-extra";

let defaultTriplyDBToken = process.env["TRIPLYDB_TOKEN"];
let defaultTriplyDBAccount = process.env["TRIPLYDB_ACCOUNT"];
let defaultHttpsProxy = process.env["HTTPS_PROXY"];
let defaultHttpProxy = process.env["HTTP_PROXY"];
const timeLog = (...args: string[]) => console.info(`[${new Date().toISOString()}]`, ...args);

const command = program
  .createCommand("run-pipeline")
  .summary("Run a TriplyDB pipeline")
  .usage("[options] <json config file>")
  .description(
    "Run a TriplyDB pipeline. TriplyDB pipelines currently supports executing speedy construct queries. A pipeline can run for an arbitrary duration, and for arbitrarey result sizes.",
  )
  .addHelpText(
    "after",
    `
    Sample json config:
    {
      "queries": [{
          "name": "accountName/queryName", (Required)
          "priority": 1, (Optional)

      },{
          "name": "accountName/queryName",
          "version": 2 (Optional)
      }],
      "sourceDataset": "accountName/datasetName", (Required)
      "targetDataset": "accountName/datasetName", (Required)
      "targetGraphName": "graph:default", (Optional)
      "version": 0.1 (Required)
    }
    `,
  )
  .option("-t, --token <token>", "TriplyDB access token (default: $TRIPLYDB_TOKEN)")
  .option(
    "-a, --account <account>",
    "Account where query job is created and stored. (default: $TRIPLYDB_ACCOUNT, or otherwise the account that owns the token)",
    defaultTriplyDBAccount,
  )
  .option("-u, --url <url>", "Optional: Url of the triply API. (default: the API where the token was created)", String)
  .option(
    "--http-proxy <proxy>",
    "Use HTTP proxy for all requests (default: $HTTP_PROXY)",
    defaultHttpProxy || undefined,
  )
  .option(
    "--https-proxy <proxy>",
    "Use HTTP proxy for all requests (default: $HTTPS_PROXY)",
    defaultHttpsProxy || undefined,
  )

  .action(async () => {
    function sanityCheckError(msg: string) {
      console.error(colors.red(msg));
      command.outputHelp();
      process.exit(1);
    }
    const options = command.opts<{
      token: string;
      account?: string;
      url?: string;
      httpProxy?: string;
      httpsProxy?: string;
    }>();
    const [configFile] = command.args;
    if (!configFile || !configFile.length) sanityCheckError("Missing query job config file");
    const token = options.token ?? defaultTriplyDBToken;
    if (!token) sanityCheckError("Missing token as an argument");

    const app = App.get({
      url: options.url,
      token,
      httpProxy: options.httpProxy,
      httpsProxy: options.httpsProxy,
    });
    const account = await app.getUser(options.account);
    // check whether account name exists
    await account.getInfo();
    try {
      const pipelineConfig = (await fs.readJson(configFile)) as Models.PipelineConfig;
      if (!pipelineConfig) {
        sanityCheckError("Error in reading query job json config");
      }

      const pipeline: Pipeline = new Pipeline(app, account, await createPipeline(account, pipelineConfig));
      const pipelineJson = pipeline["_info"];
      timeLog(`Pipeline created (${pipelineJson.id}) for ${pipelineJson.jobs} queries:`);
      for (const job of pipelineJson.jobs) {
        timeLog(`  - ${job.query?.owner}/${job.query?.name}`);
      }

      await pipeline.waitForPipelineToFinish({
        onProgress: defaultLogger,
      });
    } catch (e) {
      console.error(e);
      process.exit(1);
    }
  });

export default command;
