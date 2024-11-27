import Query from "./Query.js";
import { Models, Routes } from "@triply/utils";
import AsyncIteratorHelper from "./utils/AsyncIteratorHelper.js";
import Story, { StoryElementQuery, StoryElementUpdate } from "./Story.js";
import { Account } from "./Account.js";
import User from "./User.js";
import { _get, _post, _patch, getFetchOpts } from "./RequestHandler.js";
import Dataset, { Prefixes } from "./Dataset.js";
import { getErr, IncompatibleError } from "./utils/Error.js";
import { AccessLevel, PinnedItemUpdate, PipelineConfig, SparqlQuery, VariableConfig } from "@triply/utils/Models.js";
import { compact, omit, uniq } from "lodash-es";
import Graph from "./Graph.js";
import Pipeline, { PipelineProgress, createPipeline } from "./Pipeline.js";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { resolveAndCatchNotFound } from "./utils/index.js";
import debug from "debug";
const importLogger = debug("triply:triplydb-js:import");
/* This file contains functions that are shared by the Org and User classes.
Since the classes are implementing an interface rather than extending a class,
'private' fields such as 'app' are not available on items of type Account.
As a workaround for this, we use as-casting to User within the functions.
This should not influence the interfaces of the functions.
*/
export interface AddQueryOptions {
  queryString: SparqlQuery["query"];
  /**   * By Default "Table", other options may include: "Response", "Geo", "Gallery"  etc   */
  output?: string;
  accessLevel?: AccessLevel;
  variables?: Array<VariableConfig>;
  description?: string;
  displayName?: string;
  dataset: Dataset;
  serviceType: Models.SparqlQueryServiceType;
  ldFrame?: object;
}

export async function addQuery<T extends Account>(this: T, name: string, opts: AddQueryOptions) {
  const app = (this as User).app;
  if (!(await app.isCompatible("23.09.0"))) {
    // Service Config V2 changes
    throw new IncompatibleError(
      "This function has been updated and is now supported by TriplyDB API version 23.09.0 or greater",
    );
  }
  const accountName = this.slug;
  let datasetId = (await opts.dataset.getInfo()).id;

  let renderConfig: Models.QueryRenderConfig | undefined = undefined;
  let requestConfig: Models.QueryRequestConfig = { payload: { query: opts.queryString } };
  if (opts.output) {
    renderConfig = {
      output: opts.output,
    };
  } else if (opts.ldFrame) {
    // Adding header to be consistent with console code
    requestConfig.headers = { Accept: "application/ld+json;profile=http://www.w3.org/ns/json-ld#framed" };
    requestConfig.ldFrame = opts.ldFrame;
  } else {
    renderConfig = {
      output: "Table",
    };
  }

  let query: Models.QueryCreate = {
    name,
    dataset: datasetId,
    requestConfig: requestConfig,
    serviceConfig: {
      configuredAs: "serviceType",
      type: opts.serviceType,
    },
    accessLevel: opts.accessLevel ? opts.accessLevel : "private",
    renderConfig: renderConfig,
    variables: opts.variables,
    displayName: opts.displayName,
    description: opts.description,
  };
  return new Query(
    app,
    await _post<Routes.queries._account.Post>({
      app: app,
      path: "/queries/" + accountName,
      data: query,
      errorWithCleanerStack: getErr(`Failed to add a query to account ${accountName}.`),
    }),
    this,
  );
}

export type NewStory_deprecated = Omit<Models.StoryCreate, "name">;
export interface NewStory extends Omit<Models.StoryCreate, "name" | "content"> {
  content?: Array<StoryElementUpdate>;
}
export async function addStory<T extends Account>(this: T, name: string, args?: NewStory | NewStory_deprecated) {
  const app = (this as User).app;
  const accountName = this.slug;

  const story: Models.StoryCreate = { ...args, name, content: [] };
  if (!story.accessLevel) story.accessLevel = "private";

  /**
   * The POST route of stories doesn't support setting a width and height props. The Patch route does. This is fixed as
   * of 24.09.2.
   * For now, we've added a workaround, by creating an empty story, and using patch to set the content
   */
  await _post<Routes.stories._account.Post>({
    app: app,
    path: "/stories/" + accountName,
    data: story,
    errorWithCleanerStack: getErr(`Failed to add a story to account ${accountName}.`),
  });

  const content: Array<Models.StoryElementUpdate> = await Promise.all(
    (args?.content || []).map(async (element: StoryElementUpdate | Models.StoryElementUpdate) => {
      if (element.type === "paragraph") return element;
      if (element.query && typeof element.query === "object" && "getInfo" in element.query) {
        const info = await element.query.getInfo();
        return { ...element, query: info.id, queryVersion: element.query.version };
      }
      return { ...(element as Models.StoryElementUpdate) };
    }),
  );

  return new Story(
    app,
    await _patch<Routes.stories._account._story.Patch>({
      app: app,
      path: `/stories/${accountName}/${name}`,
      data: { content },
      errorWithCleanerStack: getErr(`Failed to add a story to account ${accountName}.`),
    }),
    this,
  );
}
export async function hasQuery<T extends Account>(this: T, name: string) {
  return !!(await resolveAndCatchNotFound(this.getQuery(name)));
}
export async function getQuery<T extends Account>(this: T, name: string) {
  const app = (this as User).app;
  const accountName = this.slug;
  const query = (await _get<Routes.queries._account._query.Get>({
    app: app,
    path: "/queries/" + accountName + "/" + name,
    errorWithCleanerStack: getErr(`Failed to get query ${name} of account ${accountName}`),
  })) as Models.Query;
  return new Query(app, query, this);
}
export interface RunPipelineOpts {
  onProgress?: (progress: PipelineProgress) => void;
  /**
   * Execute these queries in parallel
   */
  queries: Array<Query | { query: Query; priority?: number; variables?: { [variable: string]: string | undefined } }>;
  /**
   * Store the results in this dataset
   */
  destination: {
    dataset: Dataset;
    graph?: Graph | string;
  };
  /**
   * Execute the queries on this dataset. If all queries use the same dataset, you can leave this unset
   */
  source?: Dataset;
}
export async function runPipeline<T extends Account>(this: T, opts: RunPipelineOpts) {
  if (!opts.queries.length) throw getErr("No queries given to run pipeline on");
  const queries: Array<{ query: Query; priority?: number; variables?: { [variable: string]: string | undefined } }> =
    opts.queries.map((q) => {
      if (q instanceof Query) {
        return {
          query: q,
          priority: undefined,
          variables: undefined,
        };
      } else {
        return q;
      }
    });
  let sourceDataset: Dataset | undefined = opts.source;
  if (!sourceDataset) {
    const queryInfos = await Promise.all(
      queries.map(async (q) => {
        return {
          query: q.query,
          info: await q.query.getInfo(),
        };
      }),
    );
    let queryWithDataset: Query;
    const usedDatasets = uniq(
      compact(
        queryInfos.map((q) => {
          if (!q.info.dataset) return undefined;
          queryWithDataset = q.query;
          return `${q.info.dataset.owner.accountName}/${q.info.dataset.name}`;
        }),
      ),
    );
    if (usedDatasets.length === 0) {
      throw getErr(
        "Cannot create pipeline: the queries do not reference any dataset. Please pass the dataset you want to query as argument.",
      );
    }
    if (usedDatasets.length > 1) {
      throw getErr(
        `Cannot create pipeline: the queries reference different datasets. Therefore, please pass the dataset you want to query as argument explicitly.`,
      );
    }
    // We know we can populate this field
    // (otherwise, we wouldnt have had metadata info in the original pipeline object about this dataset)
    sourceDataset = (await queryWithDataset!.getDataset()) as Dataset;
  }
  let targetGraphName: undefined | string;
  if (opts.destination.graph) {
    targetGraphName =
      typeof opts.destination.graph === "string" ? opts.destination.graph : opts.destination.graph.graphName;
  }
  const pipelineConfig: PipelineConfig = {
    version: 0.2,
    queries: queries.map((q) => {
      if (q.query["_getQueryType"]() !== "CONSTRUCT")
        throw getErr(`Cannot run query ${this.slug} as pipeline: pipelines are only supported for construct queries`);
      return {
        name: `${q.query.owner.slug}/${q.query.slug}`,
        version: q.query.version,
        priority: q.priority,
        variables: q.variables,
      };
    }),
    sourceDataset: `${sourceDataset.owner.slug}/${sourceDataset.slug}`,
    targetDataset: `${opts.destination.dataset.owner.slug}/${opts.destination.dataset.slug}`,
    targetGraphName: targetGraphName,
  };
  const pipeline = new Pipeline(this.app, this, await createPipeline(this, pipelineConfig));
  await pipeline.waitForPipelineToFinish(opts);
  return pipeline;
}

export function getQueries<T extends Account>(this: T): AsyncIteratorHelper<Models.Query, Query> {
  const app = (this as User).app;

  return new AsyncIteratorHelper<Models.Query, Query>({
    potentialFutureError: getErr(`Failed to get queries`),
    getErrorMessage: async () => `Failed to get queries of ${this.slug}`,
    app: app,
    getUrl: async () => app.url + `/queries/${this.slug}`,
    mapResult: async (queryInfo) => new Query(app, queryInfo, this),
  });
}
export async function hasStory<T extends Account>(this: T, name: string) {
  return !!(await resolveAndCatchNotFound(this.getStory(name)));
}
export async function getStory<T extends Account>(this: T, name: string) {
  const app = (this as User).app;
  const accountName = this.slug;
  const story = await _get<Routes.stories._account._story.Get>({
    errorWithCleanerStack: getErr(`Failed to get story ${name} of ${accountName}.`),
    app: app,
    path: "/stories/" + accountName + "/" + name,
  });
  return new Story(app, story, this);
}

export function getStories<T extends Account>(this: T): AsyncIteratorHelper<Models.Story, Story> {
  const app = (this as User).app;
  return new AsyncIteratorHelper<Models.Story, Story>({
    potentialFutureError: getErr(`Failed to get stories`),
    getErrorMessage: async () => `Failed to get stories of ${this.slug}`,
    app: app,
    getUrl: async () => app.url + `/stories/${this.slug}`,
    mapResult: async (queryInfo) => new Story(app, queryInfo, this),
  });
}
export async function hasDataset<T extends Account>(this: T, name: string) {
  return !!(await resolveAndCatchNotFound(this.getDataset(name)));
}
export async function getDataset<T extends Account>(this: T, ds: string) {
  const app = (this as User).app;
  const accountName = this.slug;
  const dsInfo = await _get<Routes.datasets._account._dataset.Get>({
    errorWithCleanerStack: getErr(`Failed to get dataset ${ds} of account ${accountName}.`),
    app: app,
    path: `/datasets/${accountName}/${ds}`,
  });
  return new Dataset(app, this, dsInfo);
}

export function getDatasets<T extends Account>(this: T) {
  const app = (this as User).app;
  return new AsyncIteratorHelper<Models.Dataset, Dataset>({
    potentialFutureError: getErr(`Failed to get datasets`),
    getErrorMessage: async () => `Failed to get datasets of ${this.slug}`,
    app: app,
    getUrl: async () => app.url! + `/datasets/${this.slug}`,
    mapResult: async (dsInfo) => new Dataset(app, this, dsInfo),
  });
}

type NewDataset = Omit<Models.NewDataset, "name"> & { prefixes?: Prefixes };
export async function addDataset<T extends Account>(this: T, name: string, ds?: NewDataset) {
  const app = (this as User).app;
  const accountName = this.slug;
  const createdDs = await _post<Routes.datasets._account.Post>({
    errorWithCleanerStack: getErr(`Failed to add dataset ${name} to account ${accountName}.`),
    app: app,
    path: `/datasets/${accountName}`,
    data: { name, ...omit(ds, "prefixes") },
  });
  const newDs = new Dataset(app, this, createdDs);
  if (ds?.prefixes) await newDs.addPrefixes(ds.prefixes);
  return newDs;
}

export async function getPinnedItems<T extends Account>(this: T): Promise<Array<Dataset | Story | Query>> {
  const app = (this as User).app;
  const info = await this.getInfo();
  if (!info.pinnedItems) return [];
  return info.pinnedItems.map((pinnedItem) => {
    if (pinnedItem.type === "Dataset") {
      return new Dataset(app, this, pinnedItem.item);
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
  const app = (this as User).app;
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
    }),
  );
  const accountName = this.slug;
  (this as User)["_setInfo"](
    (await _patch<Routes.accounts._account.Patch>({
      errorWithCleanerStack: getErr(`Failed to pin ${items.length} items in ${accountName}`),
      app: app,
      path: "/accounts/" + accountName,
      data: {
        pinnedItems: pinnedItems,
      },
      query: { verbose: "" },
    })) as Models.User,
  );
  return this;
}

export async function update<T extends Account>(
  this: T,
  updateObj: Omit<Models.AccountUpdate, "pinnedDatasets">,
): Promise<T> {
  const app = (this as User).app;
  const accountName = this.slug;
  (this as User)["_setInfo"](
    await _patch({
      errorWithCleanerStack: getErr(`Failed to update account information of ${accountName}`),
      app: app,
      path: "/accounts/" + accountName,
      data: updateObj,
    }),
  );

  return this;
}

export async function setAvatar<T extends Account>(this: T, pathBufferOrFile: string | Buffer | File) {
  const app = (this as User).app;
  const info = await this.getInfo();
  const accountName = this.slug;
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
        `Dataset ${name} already exists with access level ${info.accessLevel}. Cannot ensure it with access level ${newDs?.accessLevel}. Please change the access level to match the dataset, or remove it entirely as a parameter.`,
      );
    }
    return ds;
  } catch (e: any) {
    if (e.statusCode !== 404) throw e;
    return this.addDataset(name, newDs);
  }
}
export interface ImportDatasetOpts {
  overwrite: true;
}
/**
 * Import query from a different TriplyDB deployment. This is a destructive operation, and overwrites an existing
 * dataset if it exists already
 */
export async function importDataset<T extends Account>(this: T, sourceDataset: Dataset, _opts: ImportDatasetOpts) {
  importLogger(`Importing dataset ${sourceDataset.slug}`);
  // For scoping purposes, only supporting import functionality between instances for now
  if (this.app.url === sourceDataset.app.url)
    throw getErr("Importing datasets is only supported between different instances.");
  const sourceDatasetInfo = await sourceDataset.getInfo();
  const tmpdir = path.resolve(os.tmpdir(), "triplydb-js-import-dataset", sourceDatasetInfo.id);
  await fs.ensureDir(tmpdir);
  /**
   * Create target dataset
   */
  let targetDataset = await resolveAndCatchNotFound(this.getDataset(sourceDataset.slug));
  if (targetDataset) {
    importLogger(`  Target dataset ${sourceDataset.slug} already exists. Deleting`);
    await targetDataset.delete();
  }
  // When creating, copy basic info
  importLogger(`  Creating target dataset ${sourceDataset.slug}`);
  targetDataset = await this.addDataset(sourceDataset.slug, {
    ...sourceDatasetInfo,
    prefixes: await sourceDataset.getPrefixes(),
  });
  /**
   * Copy assets
   */
  importLogger(`  Migrating assets to dataset ${sourceDataset.slug}`);
  for await (const asset of sourceDataset.getAssets()) {
    const name = asset.getInfo().assetName;
    const id = asset.getInfo().identifier;
    const tmpAssetFile = path.resolve(tmpdir, `asset-${id}`);
    await asset.toFile(tmpAssetFile);
    await targetDataset.uploadAsset(tmpAssetFile, { name: name });
    // cleanup
    await fs.remove(tmpAssetFile);
  }

  /**
   * Import data
   */
  importLogger(`  Importing graphs to dataset ${sourceDataset.slug}`);
  const tmpTrigFile = path.resolve(tmpdir, `${sourceDatasetInfo.id}.trig.gz`);
  await sourceDataset.graphsToFile(tmpTrigFile);
  await targetDataset.importFromFiles([tmpTrigFile]);
  await fs.remove(tmpTrigFile);
  /**
   * Import services
   */
  importLogger(`  Starting services on dataset ${sourceDataset.slug}`);
  for await (const service of sourceDataset.getServices()) {
    const serviceInfo = await service.getInfo();

    await targetDataset.addService(service.slug, {
      type: serviceInfo.type as any, // cast to any, as blazegraph is omitted from the tdbjs types
      config: serviceInfo.config,
    });
  }
  return targetDataset;
}

/**
 * Import query from a different TriplyDB deployment. This is a destructive operation, and overwrites an existing
 * query if it exists already
 *
 *
 */
export interface ImportQueryOpts {
  fallbackDataset: (sourceDataset?: Dataset) => Promise<Dataset | undefined>;
  overwrite: true;
}
export async function importQuery<T extends Account>(this: T, sourceQuery: Query, opts: ImportQueryOpts) {
  importLogger(`Importing query `, sourceQuery.slug);
  // For scoping purposes, only supporting import functionality between instances for now
  if (this.app.url === sourceQuery.app.url)
    throw getErr("Importing queries is only supported between different instances.");
  const sourceQueryInfo = await sourceQuery.getInfo();
  if (!sourceQueryInfo.requestConfig)
    throw getErr(`Cannot import ${sourceQuery.slug}: it does not contain any versions`);
  let targetDataset: Dataset | undefined;
  importLogger(`  Resolving source dataset of query ${sourceQuery.slug}`);
  let sourceDataset = await resolveAndCatchNotFound(sourceQuery.getDataset());
  if (sourceDataset) {
    importLogger(
      `  Found the source dataset ${sourceDataset.owner.slug}/${sourceDataset.slug} of query '${sourceQuery.slug}'`,
    );
    const targetDatasetOwner = await resolveAndCatchNotFound(this.app.getAccount(sourceDataset.owner.slug));
    if (targetDatasetOwner) {
      importLogger(`  Finding a target dataset for query '${sourceQuery.slug}'`);
      targetDataset = await resolveAndCatchNotFound(targetDatasetOwner.getDataset(sourceDataset.slug));
      importLogger(`  Found target dataset ${sourceDataset.slug}?`, !!targetDataset);
    } else {
      importLogger(`  Cannot find target account ${sourceDataset.owner.slug} for dataset '${sourceDataset.slug}'`);
    }
  }
  if (!targetDataset) {
    importLogger(
      `  Could not automatically resolve target dataset. Calling the fallback argument to fetch the dataset instead`,
    );
    targetDataset = await opts.fallbackDataset(sourceDataset);
    if (!targetDataset) throw getErr("Cannot import query: no dataset reference found.");
  }
  /**
   * Create target dataset
   */
  let targetQuery = await resolveAndCatchNotFound(this.getQuery(sourceQuery.slug));
  if (targetQuery) {
    importLogger(`  Target query ${targetQuery.slug} already exists. Deleting`);
    await targetQuery.delete();
  }

  const targetQueryInfo: Models.QueryCreate = {
    name: sourceQueryInfo.name,
    accessLevel: sourceQueryInfo.accessLevel,
    dataset: (await targetDataset.getInfo()).id,
    description: sourceQueryInfo.description,
    displayName: sourceQueryInfo.displayName,
    renderConfig: sourceQueryInfo.renderConfig,
    requestConfig: sourceQueryInfo.requestConfig,
    serviceConfig: {
      type: sourceQueryInfo.serviceConfig.type,
    },
    variables: sourceQueryInfo.variables,
  };
  importLogger(`  Creating target query ${sourceQuery.slug}`);
  return Query["create"](
    this.app,
    this,
    targetQueryInfo,
    getErr(`Failed to import ${sourceQueryInfo.name} to account ${this.slug}.`),
  );
}

export interface ImportStoryOpts {
  fallbackQuery: (sourceQuery: Query) => Promise<Query>;
  overwrite: true;
}
/**
 * Import query from a different TriplyDB deployment. This is a destructive operation, and overwrites an existing
 * query if it exists already
 */
export async function importStory<T extends Account>(this: T, sourceStory: Story, opts: ImportStoryOpts) {
  importLogger(`Importing story ${sourceStory.slug}`);
  // For scoping purposes, only supporting import functionality between instances for now
  if (this.app.url === sourceStory.app.url)
    throw getErr("Importing stories is only supported between different instances.");
  const sourceStoryInfo = await sourceStory.getInfo();
  const sourceContent = await sourceStory.getContent();

  const targetContent = compact(
    await Promise.all(
      sourceContent.map(async (sourceElement) => {
        if (sourceElement.type === "paragraph") return omit(sourceElement, "id");
        if (!sourceElement.query) {
          importLogger(`  Cannot find query for story element. Skipping this story element in the import`);
          return;
        }
        let targetQuery = await resolveAndCatchNotFound(this.getQuery(sourceElement.query.slug));
        if (!targetQuery) {
          targetQuery = await opts.fallbackQuery(sourceElement.query);
        }
        return {
          ...omit(sourceElement, "id"),
          query: targetQuery,
        };
      }),
    ),
  );

  let targetStory = await resolveAndCatchNotFound(this.getStory(sourceStory.slug));
  if (targetStory) {
    await targetStory.delete();
  }

  targetStory = await this.addStory(sourceStory.slug, {
    accessLevel: sourceStoryInfo.accessLevel,
    displayName: sourceStoryInfo.displayName,
    content: targetContent,
  });
  targetStory.getContent;

  if (sourceStoryInfo.bannerUrl) {
    const tmpDir = path.resolve(os.tmpdir(), "triplydb-js-import-story", sourceStoryInfo.id);
    await fs.ensureDir(tmpDir);
    const ext = path.extname(sourceStoryInfo.bannerUrl);
    const bannerFile = path.resolve(tmpDir, "banner." + ext);
    const bannerBuffer = await _get({
      errorWithCleanerStack: getErr(`Failed to get banner of story ${sourceStory.slug}.`),
      app: sourceStory.app,
      url: sourceStoryInfo.bannerUrl,
      expectedResponseBody: "buffer",
    });
    await fs.writeFile(bannerFile, bannerBuffer);
    await targetStory.setBanner(bannerFile);
  }
  return targetStory;
}

// ensureQuery functionality to be refined: https://issues.triply.cc/issues/6296
// Leave commented out meanwhile
// export async function ensureQuery<T extends Account>(this: T, name: string, opts: AddQueryDataset): Promise<Query>;
// export async function ensureQuery<T extends Account>(this: T, name: string, opts: AddQueryService): Promise<Query>;
// export async function ensureQuery<T extends Account>(this: T, name: string, opts: AddQueryDataset | AddQueryService) {
//   try {
//     const query = await this.getQuery(name);
//     const info = await query.getInfo();
//     if (opts?.accessLevel && opts?.accessLevel !== info.accessLevel) {
//       throw getErr(
//         `Query '${name}' already exists with access level '${info.accessLevel}'. Cannot ensure it with access level '${opts?.accessLevel}'. Please change the access level to match the Query, or remove it entirely as a parameter.`
//       );
//     }
//     if (info.requestConfig?.payload.query !== opts.queryString) {
//       throw getErr(
//         `Query '${name}' already exists but with a different query string. \n Please use 'Query.addVersion(opts)' with the correct options to add a new version to query '${name}'. \n The query string that already exists is: ${info.requestConfig?.payload.query}. \n It does not match: ${opts.queryString}  `
//       );
//     }
//     return query;
//   } catch (e: any) {
//     if (e.statusCode !== 404) throw e;
//     // Cast here to keep typescript happy
//     return this.addQuery(name, opts as AddQueryDataset);
//   }
// }

export async function ensureStory<T extends Account>(this: T, name: string, newStory?: NewStory | NewStory_deprecated) {
  try {
    const story = await this.getStory(name);
    const info = await story.getInfo();
    if (newStory?.accessLevel && info.accessLevel !== newStory?.accessLevel) {
      throw getErr(
        `Story ${name} already exists with access level ${info.accessLevel}. Cannot ensure it with access level ${newStory?.accessLevel}. Please change the access level to match the story, or remove it entirely as a parameter.`,
      );
    }
    return story;
  } catch (e: any) {
    if (e.statusCode !== 404) throw e;
    return this.addStory(name, newStory);
  }
}
