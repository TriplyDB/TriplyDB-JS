#!/usr/bin/env node

import { program } from "commander";
import colors from "colors";
import App from "../App.js";
import QueryJob, { QueryInformation } from "./QueryJob.js";
import { readFile } from "fs";
import { QueryJobPipelineCreate } from "./QueryJobModels.js";

let defaultTriplyDBToken = process.env["TRIPLYDB_TOKEN"];
let defaultTriplyDBAccount = process.env["TRIPLYDB_ACCOUNT"];
let defaultHttpsProxy = process.env["HTTPS_PROXY"];
let defaultHttpProxy = process.env["HTTP_PROXY"];

const command = program
  .createCommand("create-query-job")
  .summary("Creates a query job")
  .usage("[options] <json config file>")
  .description(
    "Creates a query job from an existing saved query to execute on provided source dataset. The job will then overwite the target dataset with the results. Make sure that the account used for the query job has access to the saved query, source dataset & the target dataset."
  )
  .addHelpText(
    "after",
    `
    Sample json config:
    {
      "queries": [{
          "queryName": "accountName/queryName", (Required)
          "priority": 1, (Optional)
        
      },{
          "queryName": "accountName/queryName",
          "queryVersion": 2 (Optional)
      }],
      "sourceDataset": "accountName/queryName", (Required)
      "targetDataset": "accountName/queryName", (Required)
      "targetGraphName": "graphName", (Optional)
      "version": "0.1" (Required)
    } 
    `
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
    const configFile = command.args;
    if (!configFile.length) sanityCheckError("Missing query job config file");
    if (!options.token) sanityCheckError("Missing token as an argument");

    const app = App.get({
      url: options.url,
      token: options.token ?? defaultTriplyDBToken,
      httpProxy: options.httpProxy,
      httpsProxy: options.httpsProxy,
    });
    const account = await app.getUser(options.account);
    // check whether account name exists
    await account.getInfo();
    readFile(configFile[0], async function (err, data) {
      if (err) sanityCheckError(err.message);
      if (data) {
        let queryJobConfig: QueryJobPipelineCreate | undefined = undefined;
        try {
          queryJobConfig = JSON.parse(data.toString()) as QueryJobPipelineCreate;
        } catch (e) {
          console.error(e);
          process.exit(1);
        }
        if (queryJobConfig) {
          if ("version" in queryJobConfig) {
            const queryInfo: QueryInformation[] = [];
            if ("queries" in queryJobConfig && queryJobConfig.queries) {
              for (const query of queryJobConfig.queries as any[]) {
                const [queryAccountName, actualQueryName] = query.queryName.split("/");
                if (!queryAccountName) sanityCheckError(`Missing query account name for query "${query.queryName}"`);
                if (!actualQueryName) sanityCheckError(`Missing query name for query "${query.queryName}"`);
                queryInfo.push({
                  queryAccountName: queryAccountName,
                  queryName: actualQueryName,
                  priority: query.priority || 0,
                });
              }
            }
            const queryJob: QueryJob = new QueryJob(app, account);
            try {
              await queryJob.createQueryJobPipeline(queryJobConfig, queryInfo);
            } catch (e) {
              console.error(e);
              process.exit(1);
            }
          } else sanityCheckError("Version not found in query job config");
        } else sanityCheckError("Error in reading query job json config");
      } else sanityCheckError("Query job config not provided");
    });
  });

export default command;
