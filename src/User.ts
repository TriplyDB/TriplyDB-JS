import { Models, Routes } from "@triply/utils";
import App from "./App";
import { AccountBase } from "./Account";
import Org from "./Org";
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
  addStory,
  update,
  ensureDataset,
} from "./commonAccountFunctions";
import { getErr } from "./utils/Error";

export default class User implements AccountBase {
  private _app: App;
  private _info?: Models.User;
  private _name?: string;
  public readonly type = "User";
  //leave accountname empty to get account belonging to token
  public constructor(app: App, accountName?: string, info?: Models.User) {
    this._app = app;
    this._name = accountName;
    this._info = info;
  }
  public getDataset = getDataset;
  public getDatasets = getDatasets;
  public addDataset = addDataset;
  public update = update;
  public setAvatar = setAvatar;
  public getQuery = getQuery;
  public getQueries = getQueries;
  public addQuery = addQuery;
  public getStory = getStory;
  public getStories = getStories;
  public addStory = addStory;
  public getPinnedItems = getPinnedItems;
  public pinItems = pinItems;
  public ensureDataset = ensureDataset;

  private _setInfo(info: Models.User) {
    this._info = info;
    this._name = info.accountName;
  }

  public asUser(): User {
    return this;
  }
  public asOrganization(): Org {
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
    accountName: string,
    info?: Omit<Models.AccountUpdate, "pinnedDatasets" | "accountName">
  ): Promise<Org> {
    const newOrgJson = await _post<Routes.accounts._account.orgs.Post>({
      errorWithCleanerStack: getErr(
        `Failed to create organization ${accountName} and set ${this._name} as it's owner.`
      ),
      app: this._app,
      path: "/accounts/" + this._name + "/orgs",
      data: { accountName, ...info },
    });
    return new Org(this._app, newOrgJson.accountName, newOrgJson);
  }

  public async getOrganizations() {
    const orgs = await _get<Routes.accounts._account.orgs.Get>({
      errorWithCleanerStack: getErr(`Failed to get organizations of ${this._name}`),
      app: this._app,
      path: "/accounts/" + this._name + "/orgs",
    });
    return orgs.map((org) => {
      // We're explicitly not passing the org object to the _info parameter as it's not the verbose version.
      // On the TDB API, /accounts/_account/orgs currently only returns simple information.
      return new Org(this._app, org.accountName);
    });
  }
}
