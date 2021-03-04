import { Models, Routes } from "@triply/utils";
import App from "./App";
import { _get, _patch, _delete } from "./RequestHandler";
import { Account } from "./Account";
import { getErr } from "./utils/Error";

export default class Query {
  private _app: App;
  private _info: Models.Query;
  private _owner: Account;

  constructor(app: App, info: Models.Query, owner: Account) {
    this._app = app;
    this._info = info;
    this._owner = owner;
  }

  private async _getPath() {
    const ownerName = await this._owner.getName();
    return "/queries/" + ownerName + "/" + this._info.name;
  }
  private async _getQueryNameWithOwner() {
    const ownerName = await this._owner.getName();
    return `${ownerName}/${this._info.name}`;
  }
  public async getInfo(refresh = false): Promise<Models.Query> {
    if (!refresh && this._info) return this._info;
    this._info = (await _get<Routes.queries._account._query.Get>({
      errorWithCleanerStack: getErr(`Failed to get information of query ${await this._getQueryNameWithOwner()}.`),
      app: this._app,
      path: await this._getPath(),
    })) as Models.Query;
    return this._info;
  }

  private _setInfo(info: Models.Query) {
    this._info = info;
    return this;
  }
  public async update(config: Models.QueryMetaUpdate) {
    const updateData = { ...config };
    if (!updateData.dataset) {
      updateData.dataset = this._info.dataset?.id;
    }
    this._setInfo(
      await _patch<Routes.queries._account._query.Patch>({
        errorWithCleanerStack: getErr(`Failed to update query information of ${this._info.name}.`),
        app: this._app,
        path: await this._getPath(),
        data: updateData,
      })
    );
    return this;
  }
  public async delete() {
    await _delete<Routes.queries._account._query.Delete>({
      errorWithCleanerStack: getErr(`Failed to delete query ${this._info.name}.`),
      app: this._app,
      path: await this._getPath(),
      expectedResponseBody: "empty",
    });
  }
}
