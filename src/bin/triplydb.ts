#!/usr/bin/env node

import program from "commander";
import importFromFiles from "./triplydb-import-from-file";
import uploadAssets from "./triplydb-upload-asset";
import colors from "colors";
import * as fs from "fs-extra";

program.usage("[command] [options] <files...>");
program.addCommand(importFromFiles);
program.addCommand(uploadAssets);
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
