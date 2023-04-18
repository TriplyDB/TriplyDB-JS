// We need rollup, because `pkg` (used for building executables) does not support ESM yet.
// See here for the status: https://github.com/vercel/pkg/issues/1291
import sucrase from "@rollup/plugin-sucrase";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
export default {
  input: "src/bin/triplydb.ts",
  output: {
    file: "lib/triplydb.cjs",
    format: "cjs",
  },
  plugins: [
    resolve({
      extensions: [".js", ".ts"],
    }),
    commonjs(),
    json(),
    sucrase({
      exclude: ["node_modules/**"],
      transforms: ["typescript"],
      enableLegacyTypeScriptModuleInterop: true,
    }),
  ],
};
