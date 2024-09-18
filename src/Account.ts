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
import {
  AddQueryOptions,
  ImportDatasetOpts,
  ImportQueryOpts,
  ImportStoryOpts,
  NewStory,
  NewStory_deprecated,
} from "./commonAccountFunctions.js";
export interface AccountBase {
  hasDataset(name: string): Promise<boolean>;
  hasQuery(name: string): Promise<boolean>;
  hasStory(name: string): Promise<boolean>;
  importDataset(sourceDataset: Dataset, opts: ImportDatasetOpts): Promise<Dataset>;
  importQuery(sourceQuery: Query, opts: ImportQueryOpts): Promise<Query>;
  importStory(sourceStory: Story, opts: ImportStoryOpts): Promise<Story>;
  addDataset(name: string, ds?: Omit<Models.NewDataset, "name">): Promise<Dataset>;
  addQuery(name: string, opts: AddQueryOptions): Promise<Query>;
  addStory(name: string, args?: NewStory | NewStory_deprecated): Promise<Story>;
  asOrganization(): Promise<Org>;
  asUser(): Promise<User>;
  ensureDataset(name: string, newDs?: NewDataset): Promise<Dataset>;
  ensureStory(name: string, newStory?: NewStory | NewStory_deprecated): Promise<Story>;
  getDataset(name: string): Promise<Dataset>;
  getDatasets(): AsyncIteratorHelper<Models.Dataset, Dataset>;
  getInfo(): Promise<Models.Account>;
  getPinnedItems(): Promise<Array<Dataset | Story | Query>>;
  getQueries(): AsyncIteratorHelper<Models.Query, Query>;
  getQuery(name: string): Promise<Query>;
  getStories(): AsyncIteratorHelper<Models.Story, Story>;
  getStory(name: string): Promise<Story>;
  pinItems(items: Array<Dataset | Story | Query>): Promise<User | Org>;
  setAvatar(pathOrBuffer: string | Buffer): Promise<void>;
  update(updateObj: Omit<Models.AccountUpdate, "pinnedDatasets">): Promise<User | Org>;
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
