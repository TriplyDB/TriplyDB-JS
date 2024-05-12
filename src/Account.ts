import { Routes, Models } from "@triply/utils";
import App from "./App.js";
import Dataset from "./Dataset.js";
import User from "./User.js";
import Org from "./Org.js";
import { _get } from "./RequestHandler.js";
import AsyncIteratorHelper from "./utils/AsyncIteratorHelper.js";
import Query from "./Query.js";
import Story from "./Story.js";
import { getErr } from "./utils/Error.js";
import { NewDataset } from "@triply/utils/Models.js";
import { AddQueryOptions, NewStory } from "./commonAccountFunctions.js";
export interface AccountBase {
  getInfo(): Promise<Models.Account>;
  getDataset(name: string): Promise<Dataset>;
  getDatasets(): AsyncIteratorHelper<Models.Dataset, Dataset>;
  addDataset(name: string, ds?: Omit<Models.NewDataset, "name">): Promise<Dataset>;
  update(updateObj: Omit<Models.AccountUpdate, "pinnedDatasets">): Promise<User | Org>;
  asOrganization(): Promise<Org>;
  asUser(): Promise<User>;
  setAvatar(pathOrBuffer: string | Buffer): Promise<void>;
  getQuery(name: string): Promise<Query>;
  getQueries(): AsyncIteratorHelper<Models.Query, Query>;
  addQuery(name: string, opts: AddQueryOptions): Promise<Query>;
  getStory(name: string): Promise<Story>;
  getStories(): AsyncIteratorHelper<Models.Story, Story>;
  addStory(name: string, args?: Omit<Models.StoryCreate, "name">): Promise<Story>;
  getPinnedItems(): Promise<Array<Dataset | Story | Query>>;
  pinItems(items: Array<Dataset | Story | Query>): Promise<User | Org>;
  ensureDataset(name: string, newDs?: NewDataset): Promise<Dataset>;
  ensureStory(name: string, newStory?: NewStory): Promise<Story>;
}
export type Account = User | Org;
export interface AccountType {
  accountName?: string;
  app: App;
  notExistsErrorMessage: string;
}
export async function getUserOrOrg({ accountName, app, notExistsErrorMessage }: AccountType): Promise<User | Org> {
  const info = await _get<Routes.accounts._account.Get>({
    app: app,
    path: accountName ? "/accounts/" + accountName : "/me",
    errorWithCleanerStack: getErr(notExistsErrorMessage),
    query: { verbose: "" }, // Verbose, so that we can see the account's pinned datasets/stories/queries.
  });

  if (info.type === "user") {
    return new User(app, info);
  } else {
    return new Org(app, info);
  }
}
