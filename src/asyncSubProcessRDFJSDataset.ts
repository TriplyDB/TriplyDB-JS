import App, { AppConfig } from "./App";
import { Pattern } from "./Dataset";
interface Opts {
  config: AppConfig;
  accountName: string;
  datasetName: string;
}
export async function init(opts: Opts) {
  const { config, accountName, datasetName } = opts;
  const app = App.get(config);
  const account = await app.getAccount(accountName);
  const dataset = await account.getDataset(datasetName);
  // inspired by https://stackoverflow.com/a/55504596
  return async function (pattern: Pattern) {
    return dataset.statements(pattern);
  };
}
