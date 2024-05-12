import { Models, Routes } from "@triply/utils";
import App from "./App.js";
import { _get, _delete } from "./RequestHandler.js";
import { Account } from "./Account.js";
import { getErr } from "./utils/Error.js";

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
}
