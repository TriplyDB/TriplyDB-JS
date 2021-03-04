#!/usr/bin/env node

import program from "commander";
import colors from "colors";
import App from "../App";
import Dataset from "../Dataset";

let defaultTriplyDBToken = process.env["TRIPLYDB_TOKEN"];
let defaultTriplyDBAccount = process.env["TRIPLYDB_ACCOUNT"];
let defaultTriplyDBDataset = process.env["TRIPLYDB_DATASET"];
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
    const c = App.get({ url: options.url, token: options.token });
    const account = await c.getAccount(options.account);

    // check whether account name exists
    await account.getInfo();

    let dataset: Dataset;
    try {
      dataset = account.getDataset(options.dataset);
      await dataset.getInfo();
    } catch {
      console.info("Creating dataset");
      dataset = await account.addDataset({ name: options.dataset, accessLevel: "public" });
    }

    console.info(`Uploading ${files.length} files`);
    for (const file of files) {
      const filename = file.indexOf("/") === -1 ? file : file.split("/").pop();
      await dataset.uploadAsset(file, filename || "unknown");
      console.info("Uploaded", filename);
    }
    console.info("Done");
  });

export default command;
