# TriplyDB javascript client

## Documentation

See [here](https://triply.cc/docs/triplydb-js) for the TriplyDB JavaScript client documentation.

## Local development

### Prerequisites

- NodeJS and Yarn should be installed
- For unit-testing we recommend having [direnv](https://direnv.net) installed.
- Run `yarn` to install all dependencies

### Setting up test environment

To run the tests you need to set the API server URL and a access token in your `./envrc-local` variable first: `UNITTEST_TOKEN_READ`, `UNITTEST_TOKEN_WRITE`, `UNITTEST_TOKEN_ACCOUNT` and `UNITTEST_API_URL`.

Recommendations for these tokens:

- Create a separate user (e.g. `<MyUserName>-triplydb-js`) the TriplyDB instance you're using, as the unittest will thoroughly **removes all datasets** from this account before starting the test
- Create the tokens for that one, and use these tokens in `./envrc-local`

### Running the tests

`yarn test`.

### Building locally

- `yarn build` transpiles the typescript code, and stores the JS results in the `./lib` directory
- `yarn dev` does the same, but watches for any changes to the typescript files and incrementally transpiles them when needed

### Building the TriplyDB-js binaries

TriplyDB-js is also available as a CLI. This CLI supports uploading files to TriplyDB from the command-line. To build the executable, run `yarn run package`.
Run the stored executable (e.g. `./triplydb-linux`) with a `--help` argument to find the supported command line arguments.
