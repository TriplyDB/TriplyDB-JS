#!/usr/bin/env node

import program from "commander";
import colors from "colors";
import App from "../App";
import Dataset from "../Dataset";

let defaultTriplyDBToken = process.env["TRIPLYDB_TOKEN"];
let defaultTriplyDBAccount = process.env["TRIPLYDB_ACCOUNT"];
let defaultTriplyDBDataset = process.env["TRIPLYDB_DATASET"];
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
  .option("-p, --append", "Optional: Append the graphs. (default: false)")
  .action(async () => {
    const files = command.args;
    function sanityCheckError(msg: string) {
      console.error(colors.red(msg));
      command.outputHelp();
      process.exit(1);
    }
    const options = command.opts();
    if (!options.token) sanityCheckError("Missing token as argument");
    if (!options.dataset) sanityCheckError("Missing dataset as argument");
    if (!files.length) sanityCheckError("No files given to upload for");
    const account = await App.get({ url: options.url, token: options.token }).getAccount(options.account);

    ///check whether account name exists
    await account.getInfo();
    let dataset: Dataset;
    try {
      dataset = account.getDataset(options.dataset);
      await dataset.getInfo();
    } catch (e) {
      console.info("Creating dataset");
      dataset = await account.addDataset({ name: options.dataset, accessLevel: "public" });
    }

    //Clear all linked data in this dataset
    if (!options.append) await dataset.clear("graphs");

    console.info(`Uploading ${files.length} files`);
    await dataset.importFromFiles(...files);

    console.info("Done");
  });

export default command;
