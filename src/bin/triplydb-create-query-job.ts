#!/usr/bin/env node

import { program } from "commander";
import colors from "colors";
import App from "../App.js";
import QueryJob, { QueryInformation } from "./QueryJob.js";
import { QueryJobPipelineCreate as QueryJobPipelineCreate } from "./QueryJobModels.js";

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
  .option("-t, --token <token>", "TriplyDB access token (default: $TRIPLYDB_TOKEN)")
  .option(
    "-a, --account <account>",
    "Account where query job is created and stored. (default: the account that owns the token, or $TRIPLYDB_ACCOUNT)",
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
  .option(
    "-q, --query <query...>",
    "One or more saved queries create the query job pipeline with, in the form of <account>/<queryname>"
  )
  .option(
    "--query-with-priority <query...>",
    "One or more saved queries to be executed with priority in the query job pipeline, in the form of <account>/<queryname>"
  )
  .requiredOption(
    "-s, --source-dataset <sourceDataset>",
    "Source dataset where the query job runs on, in the form of <account>/<dataset>"
  )
  .requiredOption(
    "-d, --target-dataset <targetDataset>",
    "Target dataset the query job writes to, in the form of <account>/dataset>. Dataset is created when it doesn't exist"
  )
  .option("-g, --target-graph-name <graph-name>", "Target graph name to store the results in")

  .action(async () => {
    function sanityCheckError(msg: string) {
      console.error(colors.red(msg));
      command.outputHelp();
      process.exit(1);
    }
    const options = command.opts<{
      token: string;
      account?: string;
      query?: string[];
      queryWithPriority?: string[];
      version?: string;
      sourceDataset: string;
      targetDataset: string;
      targetGraphName?: string;
      url?: string;
      httpProxy?: string;
      httpsProxy?: string;
    }>();

    if (!options.token) sanityCheckError("Missing token as an argument");
    if (!options.query && !options.queryWithPriority) sanityCheckError("Missing query as an argument");
    const queryInfo: QueryInformation[] = [];
    if (options.query) {
      for (const query of options.query) {
        const [queryAccountName, queryName] = query.split("/");
        if (!queryAccountName) sanityCheckError(`Missing query account name for query "${query}"`);
        if (!queryName) sanityCheckError(`Missing query name for query "${query}"`);
        queryInfo.push({ queryAccountName, queryName });
      }
    }
    if (options.queryWithPriority) {
      for (const query of options.queryWithPriority) {
        const [queryAccountName, queryName] = query.split("/");
        if (!queryAccountName) sanityCheckError(`Missing query account name for query "${query}"`);
        if (!queryName) sanityCheckError(`Missing query name for query "${query}"`);
        queryInfo.push({ queryAccountName, queryName, priority: 1 });
      }
    }
    const [sourceDatasetAccountName, sourceDatasetName] = options.sourceDataset.split("/");
    if (!sourceDatasetAccountName) sanityCheckError("Missing source dataset account name");
    if (!sourceDatasetName) sanityCheckError("Missing source dataset name");
    const [targetDatasetAccountName, targetDatasetName] = options.targetDataset.split("/");
    if (!targetDatasetAccountName) sanityCheckError("Missing target dataset account name");
    if (!targetDatasetName) sanityCheckError("Missing target dataset name");

    const app = App.get({
      url: options.url,
      token: options.token ?? defaultTriplyDBToken,
      httpProxy: options.httpProxy,
      httpsProxy: options.httpsProxy,
    });
    const account = await app.getUser(options.account);
    // check whether account name exists
    await account.getInfo();
    const queries: { queryId: string; priority?: number }[] = [];
    for (const query of queryInfo) {
      const queryAccount = await app.getAccount(query.queryAccountName);
      const queryId = (await (await queryAccount.getQuery(query.queryName)).getInfo()).id;
      queries.push({ queryId, priority: query.priority });
    }
    const sourceDatasetAccount = await app.getAccount(sourceDatasetAccountName);
    const sourceDatasetId = (await (await sourceDatasetAccount.getDataset(sourceDatasetName)).getInfo()).id;
    const targetDatasetAccount = await app.getAccount(targetDatasetAccountName);
    const targetDatasetId = (await (await targetDatasetAccount.ensureDataset(targetDatasetName)).getInfo()).id;
    const payload: QueryJobPipelineCreate = {
      queries: queries,
      sourceDatasetId: sourceDatasetId,
      targetDatasetId: targetDatasetId,
      targetGraphName: options.targetGraphName,
    };
    const queryJob: QueryJob = new QueryJob(app, account);
    try {
      await queryJob.createQueryJobPipeline(payload, queryInfo);
    } catch (e) {
      console.error(e);
      process.exit(1);
    }
  });

export default command;
