import Query from "./Query";
import { Models, Routes } from "@triply/utils";
import AsyncIteratorHelper from "./utils/AsyncIteratorHelper";
import Story from "./Story";
import { Account } from "./Account";
import User from "./User";
import { _get, _post, _patch } from "./RequestHandler";
import Dataset, { Prefixes } from "./Dataset";
import { getErr } from "./utils/Error";
import { PinnedItemUpdate } from "@triply/utils/lib/Models";
import { omit } from "lodash";
import Service from "./Service";

/* This file contains functions that are shared by the Org and User classes.
Since the classes are implementing an interface rather than extending a class,
'private' fields such as 'app' are not available on items of type Account.
As a workaround for this, we use as-casting to User within the functions.
This should not influence the interfaces of the functions.
*/

type NewQueryBase = Omit<Models.QueryCreate, "name" | "dataset" | "preferredService">;
export type NewQueryWithDataset = NewQueryBase & { dataset: Dataset };
export type NewQueryWithService = NewQueryBase & { service: Service };
export async function addQuery<T extends Account>(this: T, name: string, newQuery: NewQueryWithDataset): Promise<Query>;
export async function addQuery<T extends Account>(this: T, name: string, newQuery: NewQueryWithService): Promise<Query>;
export async function addQuery<T extends Account>(
  this: T,
  name: string,
  newQuery: NewQueryWithService | NewQueryWithDataset
) {
  const app = (this as User)["_app"];
  const accountName = (await this.getInfo()).accountName;
  let query: Models.QueryCreate = { name, accessLevel: newQuery.accessLevel };
  if ("dataset" in newQuery && "service" in newQuery) {
    throw getErr("Can't use dataset and service options at the same time in the newQuery");
  } else if ("dataset" in newQuery) {
    const { dataset, ...newQueryOpts } = newQuery;
    query = { name, ...newQueryOpts, dataset: dataset["_info"]?.id };
  } else if ("service" in newQuery) {
    const { service, ...newQueryOpts } = newQuery;
    const dataset = service["_dataset"];
    query = {
      name,
      ...newQueryOpts,
      dataset: dataset["_info"]?.id,
      preferredService: (await service.getInfo()).endpoint,
    };
  }
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
export type NewStory = Omit<Models.StoryCreate, "name">;
export async function addStory<T extends Account>(this: T, name: string, args?: NewStory) {
  const app = (this as User)["_app"];
  const accountName = (await this.getInfo()).accountName;
  const story: Models.StoryCreate = { ...args, name };
  if (!story.accessLevel) story.accessLevel = "private";
  return new Story(
    app,
    await _post<Routes.stories._account.Post>({
      app: app,
      path: "/stories/" + accountName,
      data: story,
      errorWithCleanerStack: getErr(`Failed to add a story to account ${accountName}.`),
    }),
    this
  );
}

export async function getQuery<T extends Account>(this: T, name: string) {
  const app = (this as User)["_app"];
  const accountName = (await this.getInfo()).accountName;
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
    potentialFutureError: getErr(`Failed to get queries`),
    getErrorMessage: async () => `Failed to get queries of ${(await this.getInfo()).accountName}`,
    app: app,
    getUrl: async () => app["_config"].url! + `/queries/${(await this.getInfo()).accountName}`,
    mapResult: async (queryInfo) => new Query(app, queryInfo, this),
  });
}

export async function getStory<T extends Account>(this: T, name: string) {
  const app = (this as User)["_app"];
  const accountName = (await this.getInfo()).accountName;
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
    potentialFutureError: getErr(`Failed to get stories`),
    getErrorMessage: async () => `Failed to get stories of ${(await this.getInfo()).accountName}`,
    app: app,
    getUrl: async () => app["_config"].url! + `/stories/${(await this.getInfo()).accountName}`,
    mapResult: async (queryInfo) => new Story(app, queryInfo, this),
  });
}

export async function getDataset<T extends Account>(this: T, ds: string) {
  const app = (this as User)["_app"];
  const accountName = (await this.getInfo()).accountName;
  const dsInfo = await _get<Routes.datasets._account._dataset.Get>({
    errorWithCleanerStack: getErr(`Failed to get dataset ${ds} of account ${accountName}.`),
    app: app,
    path: `/datasets/${accountName}/${ds}`,
  });
  return new Dataset(app, this, ds, dsInfo);
}

export function getDatasets<T extends Account>(this: T) {
  const app = (this as User)["_app"];
  return new AsyncIteratorHelper<Models.Dataset, Dataset>({
    potentialFutureError: getErr(`Failed to get datasets`),
    getErrorMessage: async () => `Failed to get datasets of ${(await this.getInfo()).accountName}`,
    app: app,
    getUrl: async () => app["_config"].url! + `/datasets/${(await this.getInfo()).accountName}`,
    mapResult: async (dsInfo) => new Dataset(app, this, dsInfo.name, dsInfo),
  });
}

type NewDataset = Omit<Models.NewDataset, "name"> & { prefixes?: Prefixes };
export async function addDataset<T extends Account>(this: T, name: string, ds?: NewDataset) {
  const app = (this as User)["_app"];
  const accountName = (await this.getInfo()).accountName;
  const createdDs = await _post<Routes.datasets._account.Post>({
    errorWithCleanerStack: getErr(`Failed to add dataset ${name} to account ${accountName}.`),
    app: app,
    path: `/datasets/${accountName}`,
    data: { name, ...omit(ds, "prefixes") },
  });
  const newDs = new Dataset(app, this, createdDs.name, createdDs);
  if (ds?.prefixes) await newDs.addPrefixes(ds.prefixes);
  return newDs;
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
  const accountName = (await this.getInfo()).accountName;
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

export async function update<T extends Account>(
  this: T,
  updateObj: Omit<Models.AccountUpdate, "pinnedDatasets">
): Promise<T> {
  const app = (this as User)["_app"];
  const accountName = (await this.getInfo()).accountName;
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
  const accountName = (await this.getInfo()).accountName;
  await _post({
    errorWithCleanerStack: getErr(`Failed to add avatar to account ${accountName}.`),
    app: app,
    path: "/imgs/avatars/a/" + info.uid,
    attach: { avatar: pathBufferOrFile },
  });
}

export async function ensureDataset<T extends Account>(this: T, name: string, newDs?: NewDataset) {
  try {
    const ds = await this.getDataset(name);
    const info = await ds.getInfo();
    if (newDs?.accessLevel && info.accessLevel !== newDs?.accessLevel) {
      throw getErr(
        `Dataset ${name} already exists with access level ${info.accessLevel}. Cannot ensure it with access level ${newDs?.accessLevel}. Please change the access level to match the dataset, or remove it entirely as a parameter.`
      );
    }
    return ds;
  } catch (e: any) {
    if (e.statusCode !== 404) throw e;
    return this.addDataset(name, newDs);
  }
}

export async function ensureQuery<T extends Account>(
  this: T,
  name: string,
  newQuery: NewQueryWithService | NewQueryWithDataset
) {
  try {
    const query = await this.getQuery(name);
    const info = await query.getInfo();
    if (newQuery?.accessLevel && newQuery?.accessLevel !== info.accessLevel) {
      throw getErr(
        `Query ${name} already exists with access level ${info.accessLevel}. Cannot ensure it with access level ${newQuery?.accessLevel}. Please change the access level to match the Query, or remove it entirely as a parameter.`
      );
    }
    return query;
  } catch (e: any) {
    if (e.statusCode !== 404) throw e;
    // Cast here to keep typescript happy
    return this.addQuery(name, newQuery as NewQueryWithDataset);
  }
}

export async function ensureStory<T extends Account>(this: T, name: string, newStory?: NewStory) {
  try {
    const story = await this.getStory(name);
    const info = await story.getInfo();
    if (newStory?.accessLevel && info.accessLevel !== newStory?.accessLevel) {
      throw getErr(
        `Story ${name} already exists with access level ${info.accessLevel}. Cannot ensure it with access level ${newStory?.accessLevel}. Please change the access level to match the story, or remove it entirely as a parameter.`
      );
    }
    return story;
  } catch (e: any) {
    if (e.statusCode !== 404) throw e;
    return this.addStory(name, newStory);
  }
}
