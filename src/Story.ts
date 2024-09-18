import { Models, Routes } from "@triply/utils";
import App from "./App.js";
import { _get, _delete, _post } from "./RequestHandler.js";
import { Account } from "./Account.js";
import { getErr } from "./utils/Error.js";
import { compact, uniq } from "lodash-es";
import Query from "./Query.js";
import { MarkOptional } from "ts-essentials";
export type StoryElementParagraph = Models.StoryElementParagraph;
export interface StoryElementQuery extends Omit<Models.StoryElementQuery, "query" | "queryVersion"> {
  query?: Query;
}

export type StoryElementUpdate = MarkOptional<StoryElementQuery, "id"> | MarkOptional<StoryElementParagraph, "id">;
export default class Story {
  public app: App;
  private _info: Models.Story;
  public owner: Account;
  public slug: string;
  public readonly type = "Story";
  constructor(app: App, info: Models.Story, owner: Account) {
    this.app = app;
    this._info = info;
    this.slug = info.name;
    this.owner = owner;
  }
  public get api() {
    const ownerName = this.owner.slug;
    const path = "/stories/" + ownerName + "/" + this.slug;
    return {
      url: this.app.url + path,
      path,
    };
  }

  private _getStoryNameWithOwner() {
    const ownerName = this.owner.slug;
    return `${ownerName}/${this.slug}`;
  }
  public async getInfo(refresh = false): Promise<Models.Story> {
    if (!refresh && this._info) return this._info;
    this._info = await _get<Routes.stories._account._story.Get>({
      errorWithCleanerStack: getErr(`Failed to get information of story ${this._getStoryNameWithOwner()}.`),
      app: this.app,
      path: this.api.path,
    });
    return this._info;
  }
  public async delete() {
    await _delete<Routes.stories._account._story.Delete>({
      errorWithCleanerStack: getErr(`Failed to delete story ${this.slug}.`),
      app: this.app,
      path: this.api.path,
      expectedResponseBody: "empty",
    });
  }
  public async setBanner(pathBufferOrFile: string | Buffer | File) {
    const info = await this.getInfo();
    await _post<Routes.stories._account._story.banner.Post>({
      errorWithCleanerStack: getErr(`Failed to set banner of story ${info.name}.`),
      app: this.app,
      path: `/stories/${info.owner.accountName}/${info.name}/banner.webp`,
      attach: { banner: pathBufferOrFile },
    });
    await this.getInfo(true);
    return this;
  }
  public async getContent(): Promise<Array<StoryElementParagraph | StoryElementQuery>> {
    // When we create the `Query` objects, we need a reference to the account owner. Make sure we fetch the account
    // references before in 1 go
    let referencedAccounts = new Map<string, Account>();
    const accounts = await Promise.all(
      uniq(
        compact(this._info.content.map((content) => content.type === "query" && content.query?.owner.accountName)),
      ).map((accountName) => this.app.getAccount(accountName)),
    );
    for (const account of accounts) {
      referencedAccounts.set(account.slug, account);
    }
    return Promise.all(
      this._info.content.map(async (element: Models.Story["content"][number]) => {
        if (element.type === "paragraph") return element;
        const { query, queryVersion, ...queryProps } = element;
        let queryObj: Query | undefined;
        if (query) {
          const queryOwner = referencedAccounts.get(query.owner.accountName) as Account;
          queryObj = new Query(this.app, query, queryOwner);
          if (queryVersion !== undefined) await queryObj.useVersion(queryVersion);
        }
        return {
          ...queryProps,
          query: queryObj,
        };
      }),
    );
  }
}
