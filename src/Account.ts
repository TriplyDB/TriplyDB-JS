import { Routes, Models } from "@triply/utils";
import App from "./App";
import Dataset from "./Dataset";
import User from "./User";
import Org from "./Org";
import { _get } from "./RequestHandler";
import AsyncIteratorHelper from "./utils/AsyncIteratorHelper";
import Query from "./Query";
import Story from "./Story";
import { getErr } from "./utils/Error";
export interface AccountBase {
  getInfo(): Promise<Models.Account>;
  getDataset(name: string): Promise<Dataset>;
  getDatasets(): AsyncIteratorHelper<Models.Dataset, Dataset>;
  addDataset(name: string, ds?: Omit<Models.NewDataset, "name">): Promise<Dataset>;
  update(updateObj: Omit<Models.AccountUpdate, "pinnedDatasets">): Promise<User | Org>;
  asOrganization(): Org;
  asUser(): User;
  setAvatar(pathOrBuffer: string | Buffer): Promise<void>;
  getQuery(name: string): Promise<Query>;
  getQueries(): AsyncIteratorHelper<Models.Query, Query>;
  addQuery(query: Models.QueryCreate): Promise<Query>;
  getStory(name: string): Promise<Story>;
  getStories(): AsyncIteratorHelper<Models.Story, Story>;
  addStory(story: Models.StoryCreate): Promise<Story>;
  getPinnedItems(): Promise<Array<Dataset | Story | Query>>;
  pinItems(items: Array<Dataset | Story | Query>): Promise<User | Org>;
}
export type Account = User | Org;
export async function getUserOrOrg(accountName: string, app: App): Promise<User | Org> {
  const info = await _get<Routes.accounts._account.Get>({
    app: app,
    path: "/accounts/" + accountName,
    errorWithCleanerStack: getErr(`Failed to fetch information for account ${accountName}.`),
    query: { verbose: "" },
  });
  if (info.type === "user") {
    return new User(app, info.accountName, info);
  } else {
    return new Org(app, info.accountName, info);
  }
}
