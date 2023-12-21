#!/usr/bin/env node

import { Option, program } from "commander";
import colors from "colors";
import App from "../App.js";
import Dataset from "../Dataset.js";

let defaultTriplyDBToken = process.env["TRIPLYDB_TOKEN"];
let defaultTriplyDBAccount = process.env["TRIPLYDB_ACCOUNT"];
let defaultTriplyDBDataset = process.env["TRIPLYDB_DATASET"];
let defaultHttpsProxy = process.env["HTTPS_PROXY"];
let defaultHttpProxy = process.env["HTTP_PROXY"];
const command = program
  .createCommand("import-from-file")
  .description("load files as graphs into a TriplyDB dataset")
  .option(
    "-d, --dataset <dataset>",
    "Dataset to upload file(s) to (default: $TRIPLYDB_DATASET)",
    defaultTriplyDBDataset || undefined
  )
  .option("-t, --token <token>", "TriplyDB access token (default: $TRIPLYDB_TOKEN)", defaultTriplyDBToken || undefined)
  .option(
    "-a, --account <account>",
    "Optional: Account to upload file(s) for. (default: the account that owns the token, or $TRIPLYDB_ACCOUNT)",
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
  // deprecated
  .addOption(new Option("-p, --append").hideHelp())
  .option("--default-graph-name <graph>", "Default graph, used when e.g. ntriples are uploaded")
  .addOption(
    new Option("--mode <mode>", "Defines how to resolve issues when graph name already exists")
      .choices(["overwrite", "rename", "merge"])
      .default("rename")
  )
  .action(async () => {
    const files = command.args;
    function sanityCheckError(msg: string): never {
      console.error(colors.red(msg));
      command.outputHelp();
      process.exit(1);
    }
    const options = command.opts<{
      token?: string;
      dataset?: string;
      url?: string;
      httpProxy?: string;
      httpsProxy?: string;
      account?: string;
      /**@deprecated */
      append?: boolean;
      defaultGraphName?: string;
      mode: "rename" | "overwrite" | "merge";
    }>();
    if (!options.token) sanityCheckError("Missing token as argument");
    if (!options.dataset) sanityCheckError("Missing dataset as argument");
    if (!files.length) sanityCheckError("No files given to upload for");
    if (options.append) {
      console.warn("Ignoring the 'append' option as it is deprecated. Use the --mode option instead.");
    }
    const account = await App.get({
      url: options.url,
      token: options.token,
      httpProxy: options.httpProxy,
      httpsProxy: options.httpsProxy,
    }).getAccount(options.account);

    ///check whether account name exists
    await account.getInfo();
    let dataset: Dataset;
    try {
      dataset = await account.getDataset(options.dataset);
    } catch (e) {
      console.info("Creating dataset");
      dataset = await account.addDataset(options.dataset, { accessLevel: "public" });
    }

    console.info(`Uploading ${files.length} files`);
    await dataset.importFromFiles(files, {
      defaultGraphName: options.defaultGraphName,
      overwriteAll: options.mode === "overwrite",
      mergeGraphs: options.mode === "merge",
    });

    console.info("Done");
  });

export default command;
