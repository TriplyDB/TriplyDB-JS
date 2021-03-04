const expensive = true;
const errLevel = process.env["ESLINT_STRICT"] ? "error" : "warn";
module.exports = {
  parser: "@typescript-eslint/parser", // Specifies the ESLint parser
  extends: [
    "prettier", // Uses eslint-config-prettier to disable ESLint rules from @typescript-eslint/eslint-plugin that would conflict with prettier
  ],
  parserOptions: {
    ecmaVersion: 2018, // Allows for the parsing of modern ECMAScript features
    sourceType: "module", // Allows for the use of imports,
    project: expensive ? "./tsconfig-build.json" : undefined,
    tsconfigRootDir: expensive ? "." : undefined,
  },
  plugins: ["@typescript-eslint", "jest", "lodash"],
  rules: {
    ...(expensive ? { "@typescript-eslint/no-floating-promises": errLevel } : {}),
    "no-console": [
      errLevel,
      { allow: ["time", "timeEnd", "trace", "warn", "error", "info", "groupEnd", "group", "groupCollapsed"] },
    ],
    "jest/no-focused-tests": errLevel,
    "lodash/import-scope": [errLevel, "member"],
  },
};
