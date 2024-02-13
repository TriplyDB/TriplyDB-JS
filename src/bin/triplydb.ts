#!/usr/bin/env node
import "source-map-support/register.js";
import { program } from "commander";
import importFromFiles from "./triplydb-import-from-file.js";
import uploadAssets from "./triplydb-upload-asset.js";
import createQueryJob from "./triplydb-create-query-job.js";
import colors from "colors";
import fs from "fs-extra";

program.usage("[command] [options] <files...>");
program.addCommand(importFromFiles);
program.addCommand(uploadAssets);
program.addCommand(createQueryJob);
program.parseAsync(process.argv).then(
  () => {},
  (e) => {
    const errFile = ".triplydb-js.err";
    console.error(colors.red(e.message));
    console.error(colors.red("For more details, see " + errFile));
    fs.writeFileSync(errFile, JSON.stringify(e, Object.getOwnPropertyNames(e), 2));
    process.exit(1);
  }
);
