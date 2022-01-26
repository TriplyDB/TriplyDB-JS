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
import { NewDataset } from "@triply/utils/lib/Models";
import { NewQueryWithDataset, NewQueryWithService, NewStory } from "./commonAccountFunctions";
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
  addQuery(name: string, newQuery: Omit<Models.QueryCreate, "name">): Promise<Query>;
  getStory(name: string): Promise<Story>;
  getStories(): AsyncIteratorHelper<Models.Story, Story>;
  addStory(name: string, args?: Omit<Models.StoryCreate, "name">): Promise<Story>;
  getPinnedItems(): Promise<Array<Dataset | Story | Query>>;
  pinItems(items: Array<Dataset | Story | Query>): Promise<User | Org>;
  ensureDataset(name: string, newDs?: NewDataset): Promise<Dataset>;
  ensureQuery(name: string, newQuery: NewQueryWithService | NewQueryWithDataset): Promise<Query>;
  ensureStory(name: string, newStory?: NewStory): Promise<Story>;
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
