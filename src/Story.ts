import { Models, Routes } from "@triply/utils";
import App from "./App";
import { _get } from "./RequestHandler";
import { Account } from "./Account";
import { getErr } from "./utils/Error";

export default class Story {
  private _app: App;
  private _info: Models.Story;
  private _owner: Account;

  constructor(app: App, info: Models.Story, owner: Account) {
    this._app = app;
    this._info = info;
    this._owner = owner;
  }

  private async _getPath() {
    const ownerName = await this._owner.getName();
    return "/stories/" + ownerName + "/" + this._info.name;
  }
  private async _getStoryNameWithOwner() {
    const ownerName = await this._owner.getName();
    return `${ownerName}/${this._info.name}`;
  }
  public async getInfo(refresh = false): Promise<Models.Story> {
    if (!refresh && this._info) return this._info;
    this._info = await _get<Routes.stories._account._story.Get>({
      errorWithCleanerStack: getErr(`Failed to get information of story ${await this._getStoryNameWithOwner()}.`),
      app: this._app,
      path: await this._getPath(),
    });
    return this._info;
  }
}
