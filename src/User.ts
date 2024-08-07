import { Models, Routes } from "@triply/utils";
import App from "./App.js";
import { AccountBase } from "./Account.js";
import Org from "./Org.js";
import { _patch, _get, _post } from "./RequestHandler.js";
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
  ensureStory,
  runPipeline,
} from "./commonAccountFunctions.js";
import { getErr } from "./utils/Error.js";

type NewOrganization = Omit<Models.AccountUpdate, "pinnedDatasets" | "accountName">;

export default class User implements AccountBase {
  public app: App;
  private _info?: Models.User;
  public slug: string;
  public readonly type = "User";

  public constructor(app: App, infoOrAccountName: Models.User | string) {
    this.app = app;
    if (typeof infoOrAccountName === "string") {
      this.slug = infoOrAccountName;
    } else {
      this._info = infoOrAccountName;
      this.slug = infoOrAccountName.accountName;
    }
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
  public ensureStory = ensureStory;
  public runPipeline = runPipeline;
  public get api() {
    const path = `/accounts/${this.slug}`;
    return {
      url: this.app.url + path,
      path,
    };
  }
  private _setInfo(info: Models.User) {
    this._info = info;
    this.slug = info.accountName;
  }

  public async asUser(): Promise<User> {
    this._setInfo(await this.getInfo());
    return this;
  }
  public async asOrganization(): Promise<Org> {
    const info = await this.getInfo();
    throw getErr(
      `Unable to cast user ${info.accountName} to an organization. A user cannot be cast to an organization.`,
    );
  }
  public async getInfo(refresh = false) {
    if (refresh || !this._info) {
      const info = (await _get<Routes.accounts._account.Get>({
        errorWithCleanerStack: getErr(`Failed to get user information of ${this.slug}.`),
        app: this.app,
        path: this.api.path,
        query: { verbose: "" },
      })) as Models.User;
      this._setInfo(info);
    }
    return this._info as Models.User;
  }

  public async createOrganization(accountName: string, info?: NewOrganization): Promise<Org> {
    const newOrgJson = await _post<Routes.accounts._account.orgs.Post>({
      errorWithCleanerStack: getErr(`Failed to create organization ${accountName} and set ${this.slug} as it's owner.`),
      app: this.app,
      path: this.api.path + "/orgs",
      data: { accountName, ...info },
    });
    return new Org(this.app, newOrgJson);
  }

  public async getOrganizations() {
    const orgs = await _get<Routes.accounts._account.orgs.Get>({
      errorWithCleanerStack: getErr(`Failed to get organizations of ${this.slug}`),
      app: this.app,
      path: this.api.path + "/orgs",
    });
    return orgs.map((org) => {
      // We're explicitly not passing the org object to the _info parameter as it's not the verbose version.
      // On the TDB API, /accounts/_account/orgs currently only returns simple information.
      return new Org(this.app, org.accountName);
    });
  }

  private async _getOrganization(name: string) {
    return (
      await _get<Routes.accounts._account.orgs.Get>({
        errorWithCleanerStack: getErr(`Failed to get organizations of ${this.slug}`),
        app: this.app,
        path: this.api.path + "/orgs",
      })
    )
      .filter((org) => org.accountName === name)
      .shift();
  }

  public async getOrganization(name: string) {
    const org = await this._getOrganization(name);
    if (org === undefined) {
      throw getErr(`Failed to get organization '${name}' of account '${this.slug}'`);
    }
    return new Org(this.app, name);
  }

  public async ensureOrganization(name: string, newOrg?: NewOrganization) {
    const org = await this._getOrganization(name);
    if (org !== undefined) return Promise.resolve(new Org(this.app, org.accountName));
    return this.createOrganization(name, newOrg);
  }
}
