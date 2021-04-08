import { Models, Routes } from "@triply/utils";
import App from "./App";
import { AccountBase } from "./Account";
import Org from "./Org";
import { MarkRequired } from "ts-essentials";
import { _patch, _get, _post } from "./RequestHandler";
import {
  addQuery,
  getStories,
  getStory,
  getQueries,
  getQuery,
  getDatasets,
  addDataset,
  pinItems,
  getPinnedItems,
  setAvatar,
  getDataset,
  exists,
  update,
  getName,
  ensureDs,
} from "./commonAccountFunctions";
import { getErr } from "./utils/Error";

export default class User implements AccountBase {
  private _app: App;
  private _info?: Models.User;
  private _name?: string;
  //leave accountname empty to get account belonging to token
  public constructor(app: App, accountName?: string, info?: Models.User) {
    this._app = app;
    this._name = accountName;
    this._info = info;
  }
  public getDataset = getDataset;
  public exists = exists;
  public update = update;
  public setAvatar = setAvatar;
  public getQuery = getQuery;
  public getQueries = getQueries;
  public getStory = getStory;
  public getStories = getStories;
  public addQuery = addQuery;
  public getDatasets = getDatasets;
  public addDataset = addDataset;
  public getPinnedItems = getPinnedItems;
  public pinItems = pinItems;
  public getName = getName;
  public ensureDs = ensureDs;

  private _setInfo(info: Models.User) {
    this._info = info;
    this._name = info.accountName;
  }

  public asUser(): User {
    return this;
  }
  public asOrg(): Org {
    throw getErr(`${this._info?.accountName || "This"} is a user. Cannot fetch this as an organization.`);
  }
  public async getInfo(refresh = false) {
    if (refresh || !this._info) {
      let errMsg: string;
      if (this._name) {
        errMsg = `Failed to get user information of ${this._name}.`;
      } else {
        errMsg = "Failed to get user information for this token.";
      }
      const info = (await _get<Routes.accounts._account.Get>({
        errorWithCleanerStack: getErr(errMsg),
        app: this._app,
        path: this._name ? "/accounts/" + this._name : "/me",
        query: { verbose: "" },
      })) as Models.User;
      this._setInfo(info);
    }
    return this._info as Models.User;
  }

  public async createOrganization(
    info: Omit<MarkRequired<Models.AccountUpdate, "accountName">, "pinnedDatasets">
  ): Promise<Org> {
    const newOrgJson = await _post<Routes.accounts._account.orgs.Post>({
      errorWithCleanerStack: getErr(
        `Failed to create organization ${info.accountName} and set ${this._name} as it's owner.`
      ),
      app: this._app,
      path: "/accounts/" + this._name + "/orgs",
      data: info,
    });
    return new Org(this._app, newOrgJson.accountName as string, newOrgJson);
  }

  public async getOrganizations() {
    const orgs = await _get<Routes.accounts._account.orgs.Get>({
      errorWithCleanerStack: getErr(`Failed to get organizations of ${this._name}`),
      app: this._app,
      path: "/accounts/" + this._name + "/orgs",
    });
    return orgs.map((o) => {
      if (!o.accountName) throw getErr("Expected accountname to exist for org");
      return new Org(this._app, o.accountName, o);
    });
  }
}
