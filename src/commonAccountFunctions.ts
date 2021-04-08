import Query from "./Query";
import { Models, Routes } from "@triply/utils";
import AsyncIteratorHelper from "./utils/AsyncIteratorHelper";
import Story from "./Story";
import { Account } from "./Account";
import User from "./User";
import { _get, _post, _patch } from "./RequestHandler";
import Dataset from "./Dataset";
import { MarkRequired } from "ts-essentials";
import { getErr } from "./utils/Error";
import { NewDataset, PinnedItemUpdate } from "@triply/utils/lib/Models";

/* This file contains functions that are shared by the Org and User classes.
Since the classes are implementing an interface rather than extending a class,
'private' fields such as 'app' are not available on items of type Account.
As a workaround for this, we use as-casting to User within the functions.
This should not influence the interfaces of the functions.
*/

export async function getName<T extends Account>(this: T) {
  const name = (this as User)["_name"];
  if (name) return name;
  const info = await this.getInfo();
  if (!info.accountName) throw getErr("This account has no name");
  return info.accountName;
}

export async function addQuery<T extends Account>(this: T, query: Models.QueryCreate) {
  const app = (this as User)["_app"];
  const accountName = await this.getName();
  return new Query(
    app,
    await _post<Routes.queries._account.Post>({
      app: app,
      path: "/queries/" + accountName,
      data: query,
      errorWithCleanerStack: getErr(`Failed to add a query to account ${accountName}.`),
    }),
    this
  );
}

export async function getQuery<T extends Account>(this: T, name: string) {
  const app = (this as User)["_app"];
  const accountName = await this.getName();
  const query = (await _get<Routes.queries._account._query.Get>({
    app: app,
    path: "/queries/" + accountName + "/" + name,
    errorWithCleanerStack: getErr(`Failed to get query ${name} of account ${accountName}`),
  })) as Models.Query;
  return new Query(app, query, this);
}

export function getQueries<T extends Account>(this: T): AsyncIteratorHelper<Models.Query, Query> {
  const app = (this as User)["_app"];

  return new AsyncIteratorHelper<Models.Query, Query>({
    error: getErr(`Failed to get queries`),
    getErrorMessage: async () => `Failed to get queries of ${await this.getName()}`,
    app: app,
    getUrl: async () => app["_config"].url! + `/queries/${await this.getName()}`,
    mapResult: async (queryInfo) => new Query(app, queryInfo, this),
  });
}

export async function getStory<T extends Account>(this: T, name: string) {
  const app = (this as User)["_app"];
  const accountName = await this.getName();
  const story = await _get<Routes.stories._account._story.Get>({
    errorWithCleanerStack: getErr(`Failed to get story ${name} of ${accountName}.`),
    app: app,
    path: "/stories/" + accountName + "/" + name,
  });
  return new Story(app, story, this);
}

export function getStories<T extends Account>(this: T): AsyncIteratorHelper<Models.Story, Story> {
  const app = (this as User)["_app"];
  return new AsyncIteratorHelper<Models.Story, Story>({
    error: getErr(`Failed to get stories`),
    getErrorMessage: async () => `Failed to get stories of ${await this.getName()}`,
    app: app,
    getUrl: async () => app["_config"].url! + `/stories/${await this.getName()}`,
    mapResult: async (queryInfo) => new Story(app, queryInfo, this),
  });
}

export function getDatasets<T extends Account>(this: T) {
  const app = (this as User)["_app"];
  return new AsyncIteratorHelper<Models.Dataset, Dataset>({
    error: getErr(`Failed to get datasets`),
    getErrorMessage: async () => `Failed to get datasets of ${await this.getName()}`,
    app: app,
    getUrl: async () => app["_config"].url! + `/datasets/${await this.getName()}`,
    mapResult: async (dsInfo) => new Dataset(app, this, dsInfo.name, dsInfo),
  });
}

export async function addDataset<T extends Account>(this: T, ds: MarkRequired<Models.NewDataset, "name">) {
  const app = (this as User)["_app"];
  const accountName = await this.getName();
  const createdDs = await _post<Routes.datasets._account.Post>({
    errorWithCleanerStack: getErr(`Failed to add dataset ${ds.name} to account ${accountName}.`),
    app: app,
    path: `/datasets/${accountName}`,
    data: ds,
  });
  return new Dataset(app, this, createdDs.name, createdDs);
}

export async function getPinnedItems<T extends Account>(this: T): Promise<Array<Dataset | Story | Query>> {
  const app = (this as User)["_app"];
  const info = await this.getInfo();
  if (!info.pinnedItems) return [];
  return info.pinnedItems.map((pinnedItem) => {
    if (pinnedItem.type === "Dataset") {
      return new Dataset(app, this, pinnedItem.item.name, pinnedItem.item);
    } else if (pinnedItem.type === "Query") {
      return new Query(app, pinnedItem.item, this);
    } else if (pinnedItem.type === "Story") {
      return new Story(app, pinnedItem.item, this);
    } else {
      throw getErr("Unexpected pinned item type: " + pinnedItem);
    }
  });
}

export async function pinItems<T extends Account>(this: T, items: Array<Dataset | Story | Query>) {
  const app = (this as User)["_app"];
  const pinnedItems: PinnedItemUpdate[] = await Promise.all(
    items.map(async (item) => {
      let pinnedItemUpdate: PinnedItemUpdate;
      if (item instanceof Dataset) {
        const info = await item.getInfo();
        pinnedItemUpdate = { type: "Dataset", item: info.id };
      } else if (item instanceof Story) {
        const info = await item.getInfo();
        pinnedItemUpdate = { type: "Story", item: info.id };
      } else if (item instanceof Query) {
        const info = await item.getInfo();
        pinnedItemUpdate = { type: "Query", item: info.id };
      } else {
        throw getErr("Unrecognized pinned item " + item);
      }
      return pinnedItemUpdate;
    })
  );
  const accountName = await this.getName();
  (this as User)["_setInfo"](
    (await _patch<Routes.accounts._account.Patch>({
      errorWithCleanerStack: getErr(`Failed to pin ${items.length} items in ${accountName}`),
      app: app,
      path: "/accounts/" + accountName,
      data: {
        pinnedItems: pinnedItems,
      },
      query: { verbose: "" },
    })) as Models.User
  );
  return this;
}

export async function exists<T extends Account>(this: T): Promise<boolean> {
  try {
    await this.getInfo();
    return true;
  } catch (e) {
    if (e.statusCode === 404) return false;
    throw e;
  }
}

export function getDataset<T extends Account>(this: T, ds: string) {
  const app = (this as User)["_app"];
  return new Dataset(app, this, ds);
}

export async function update<T extends Account>(
  this: T,
  updateObj: Omit<Models.AccountUpdate, "pinnedDatasets">
): Promise<T> {
  const app = (this as User)["_app"];
  const accountName = await this.getName();
  (this as User)["_setInfo"](
    await _patch({
      errorWithCleanerStack: getErr(`Failed to update account information of ${accountName}`),
      app: app,
      path: "/accounts/" + accountName,
      data: updateObj,
    })
  );
  return this;
}

export async function setAvatar<T extends Account>(this: T, pathBufferOrFile: string | Buffer | File) {
  const app = (this as User)["_app"];
  const info = await this.getInfo();
  const accountName = await this.getName();
  await _post({
    errorWithCleanerStack: getErr(`Failed to add avatar to account ${accountName}.`),
    app: app,
    path: "/imgs/avatars/a/" + info.uid,
    attach: { avatar: pathBufferOrFile },
  });
}

export async function ensureDs<T extends Account>(
  this: T,
  name: string,
  newDsInfo?: Partial<Omit<NewDataset, "name">>
) {
  const ds = this.getDataset(name);
  if (await ds.exists()) return ds;
  return this.addDataset({ ...(newDsInfo || {}), name: name });
}
