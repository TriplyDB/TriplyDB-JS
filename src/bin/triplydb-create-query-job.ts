#!/usr/bin/env node

import { program } from "commander";
import colors from "colors";
import App from "../App.js";
import QueryJob from "./QueryJob.js";
import { QueryJobCreate } from "./QueryJobModels.js";

let defaultTriplyDBToken = process.env["TRIPLYDB_TOKEN"];
let defaultTriplyDBAccount = process.env["TRIPLYDB_ACCOUNT"];
let defaultHttpsProxy = process.env["HTTPS_PROXY"];
let defaultHttpProxy = process.env["HTTP_PROXY"];

const command = program
  .createCommand("create-query-job")
  .summary("Creates a query job")
  .description(
    "Creates a query job from an existing saved query to execute on provided source dataset. The job will then overwite the target dataset with the results. Make sure that the account used for the query job has access to the saved query, source dataset & the target dataset."
  )
  .option("-t, --token <token>", "TriplyDB access token (default: $TRIPLYDB_TOKEN)", defaultTriplyDBToken || undefined)
  .option(
    "-a, --account <account>",
    "Source account used to create the query job. (default: the account that owns the token, or $TRIPLYDB_ACCOUNT)",
    defaultTriplyDBAccount
  )
  .option("-u, --url <url>", "Optional: Url of the triply API. (default: the API where the token was created)", String)
  .option(
    "--http-proxy <proxy>",
    "Use HTTP proxy for all requests (default: $HTTP_PROXY)",
    defaultHttpProxy || undefined
  )
  .option(
    "--https-proxy <proxy>",
    "Use HTTP proxy for all requests (default: $HTTPS_PROXY)",
    defaultHttpsProxy || undefined
  )
  .requiredOption("-q, --query <query>", "Name of the saved query used to created query job")
  .option("-v, --version <version>", "Version of the saved query used to created query job")
  .requiredOption("-s, --source-dataset <sourceDataset>", "Source dataset on which the query job runs on")
  .requiredOption("-t, --target-dataset <targetDataset>", "Target dataset to which the query job writes to")

  .action(async () => {
    function sanityCheckError(msg: string) {
      console.error(colors.red(msg));
      command.outputHelp();
      process.exit(1);
    }
    const options = command.opts();
    if (!options.token) sanityCheckError("Missing token as an argument");
    if (!options.account) sanityCheckError("Missing account as an argument");
    if (!options.query) sanityCheckError("Missing query name as an argument");
    if (!options.sourceDataset) sanityCheckError("Missing source dataset as an argument");
    if (!options.targetDataset) sanityCheckError("Missing target dataset as an argument");

    const app = App.get({
      url: options.url,
      token: options.token,
      httpProxy: options.httpProxy,
      httpsProxy: options.httpsProxy,
    });
    const account = await app.getUser(options.account);
    // check whether account name exists
    await account.getInfo();
    const queryId = (await (await account.getQuery(options.query)).getInfo()).id;
    const sourceDatasetId = (await (await account.getDataset(options.sourceDataset)).getInfo()).id;
    const targetDatasetId = (await (await account.getDataset(options.targetDataset)).getInfo()).id;

    const payload: QueryJobCreate = {
      queryId: queryId,
      queryVersion: options.version || undefined,
      sourceDatasetId: sourceDatasetId,
      targetDatasetId: targetDatasetId,
    };

    const queryJob: QueryJob = new QueryJob(app, account);
    try {
      await queryJob.createQueryJob(payload);
    } catch (e) {
      console.info(e);
    }
  });

export default command;
