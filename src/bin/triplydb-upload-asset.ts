#!/usr/bin/env node

import program from "commander";
import colors from "colors";
import App from "../App";
import Dataset from "../Dataset";
import { TriplyDbJsError } from "../utils/Error";
import statuses from "http-status-codes";
let defaultTriplyDBToken = process.env["TRIPLYDB_TOKEN"];
let defaultTriplyDBAccount = process.env["TRIPLYDB_ACCOUNT"];
let defaultTriplyDBDataset = process.env["TRIPLYDB_DATASET"];
let defaultHttpsProxy = process.env["HTTPS_PROXY"];
let defaultHttpProxy = process.env["HTTP_PROXY"];
const command = program
  .createCommand("upload-asset")
  .description("load files as assets into a TriplyDB dataset")
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
  .option("--http-proxy <proxy>", "TriplyDB access token (default: $HTTP_PROXY)", defaultHttpProxy || undefined)
  .option("--https-proxy <proxy>", "TriplyDB access token (default: $HTTPS_PROXY)", defaultHttpsProxy || undefined)
  .action(async () => {
    function sanityCheckError(msg: string) {
      console.error(colors.red(msg));
      command.outputHelp();
      process.exit(1);
    }
    const files = command.args;
    const options = command.opts();
    if (!options.token) sanityCheckError("Missing token as argument");
    if (!options.dataset) sanityCheckError("Missing dataset as argument");
    if (!files.length) sanityCheckError("No files given to upload for");
    const c = App.get({
      url: options.url,
      token: options.token,
      httpProxy: options.httpProxy,
      httpsProxy: options.httpsProxy,
    });
    const account = await c.getAccount(options.account);

    // check whether account name exists
    await account.getInfo();

    let dataset: Dataset;
    try {
      dataset = account.getDataset(options.dataset);
      await dataset.getInfo();
    } catch {
      console.info(`> Creating dataset ${options.dataset} in account ${await account.getName()}`);
      dataset = await account.addDataset({ name: options.dataset, accessLevel: "public" });
    }

    console.info(`> Uploading ${files.length} files`);
    for (const file of files) {
      const filename = file.indexOf("/") === -1 ? file : file.split("/").pop();
      console.info("  - Uploading", filename);
      const assetName = filename || "unknown";
      try {
        await dataset.uploadAsset(file, assetName);
      } catch (e) {
        if (e instanceof TriplyDbJsError && e.statusCode === statuses.CONFLICT) {
          const asset = await dataset.getAsset(assetName);
          await asset.addVersion(assetName);
          continue;
        }
        throw e;
      }
    }
    console.info(
      `> Finished uploading ${files.length} ${files.length > 2 ? "files" : "file"} to dataset ${
        options.dataset
      } in account ${await account.getName()}`
    );
  });

export default command;
