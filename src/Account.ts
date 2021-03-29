import { Routes, Models } from "@triply/utils";
import App from "./App";
import Dataset from "./Dataset";
import User from "./User";
import Org from "./Org";
import { MarkRequired } from "ts-essentials";
import { _get } from "./RequestHandler";
import AsyncIteratorHelper from "./utils/AsyncIteratorHelper";
import Query from "./Query";
import Story from "./Story";
import { getErr } from "./utils/Error";
export interface AccountBase {
  getName(): Promise<string>;
  getInfo(): Promise<Models.Account>;
  getDataset(name: string): Dataset;
  getDatasets(): AsyncIteratorHelper<Models.Dataset, Dataset>;
  addDataset(ds: MarkRequired<Models.NewDataset, "name">): Promise<Dataset>;
  exists(): Promise<boolean>;
  update(updateObj: Omit<Models.AccountUpdate, "pinnedDatasets">): Promise<User | Org>;
  asOrg(): Org;
  asUser(): User;
  setAvatar(pathOrBuffer: string | Buffer): Promise<void>;
  addQuery(query: Models.QueryCreate): Promise<Query>;
  getQuery(name: string): Promise<Query>;
  getQueries(): AsyncIteratorHelper<Models.Query, Query>;
  getStory(name: string): Promise<Story>;
  getStories(): AsyncIteratorHelper<Models.Story, Story>;
  getPinnedItems(): Promise<Array<Dataset | Story | Query>>;
  pinItems(datasets: Array<Dataset | Story | Query>): Promise<User | Org>;
}
export type Account = User | Org;
export async function getUserOrOrg(accountName: string, app: App): Promise<User | Org> {
  const info = await _get<Routes.accounts._account.Get>({
    app: app,
    path: "/accounts/" + accountName,
    errorWithCleanerStack: getErr(`Failed to fetch information for account ${accountName}.`),
  });
  if (info.type === "user") {
    return new User(app, info.accountName, info);
  } else {
    return new Org(app, info.accountName as string, info);
  }
}
