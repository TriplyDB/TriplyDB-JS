import { Models, Routes } from "@triply/utils";
import App from "./App.js";
import { AccountBase } from "./Account.js";
import User from "./User.js";
import { _delete, _patch, _post, _get } from "./RequestHandler.js";

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
  update,
  addStory,
  ensureDataset,
  ensureStory,
} from "./commonAccountFunctions.js";
import { getErr } from "./utils/Error.js";

export default class Org implements AccountBase {
  public app: App;
  // Info is undefined when we delete the organization or when we are constructing this class from an array of account.
  private _info?: Models.Org;
  public slug: string;
  public readonly type = "Org";
  public constructor(app: App, infoOrAccountName: Models.Org | string) {
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

  public get api() {
    const path = `/accounts/${this.slug}`;
    return {
      url: this.app.url + path,
      path,
    };
  }
  public async asUser(): Promise<User> {
    const info = await this.getInfo();
    throw getErr(`Failed to fetch user ${info.accountName}. Note that there is an organization with that name.`);
  }
  public async asOrganization(): Promise<this> {
    return this;
  }
  public async getInfo(refresh = false) {
    if (!refresh && this._info) return this._info;
    if (!this.slug) throw getErr("Missing name for organization");
    this._setInfo(
      (await _get<Routes.accounts._account.Get>({
        errorWithCleanerStack: getErr(`Failed to get information of organization ${this.slug}.`),
        app: this.app,
        path: this.api.path,
        query: { verbose: "" },
      })) as Models.Org,
    );
    return this._info!;
  }
  private _setInfo(info: Models.Org) {
    this._info = info;
    this.slug = info.accountName;
  }

  public async getMembers() {
    return _get<Routes.accounts._account.members.Get>({
      errorWithCleanerStack: getErr(`Failed to get members of organization ${this.slug}.`),
      app: this.app,
      path: `${this.api.path}/members`,
    });
  }
  public async addMember(user: User, role: Models.OrgRole = "member") {
    const orgName = this.slug;
    const memberName = user.slug;
    return _post<Routes.accounts._account.members.Post>({
      errorWithCleanerStack: getErr(`Failed to add ${memberName} as member to organization ${orgName}.`),
      app: this.app,
      data: { accountName: memberName, role },
      path: `${this.api.path}/members`,
    });
  }
  public async removeMember(member: User) {
    const memberName = member.slug;
    await _delete<Routes.accounts._account.members._member.Delete>({
      errorWithCleanerStack: getErr(`Failed to remove ${memberName} as member of organization ${this.slug}.`),
      app: this.app,
      path: `${this.api.path}/members/${memberName}`,
      expectedResponseBody: "empty",
    });
  }
  public async changeRole(member: User, role: Models.OrgRole) {
    const orgName = this.slug;
    const memberName = member.slug;
    await _patch<Routes.accounts._account.members._member.Patch>({
      errorWithCleanerStack: getErr(`Failed to change role of ${memberName} to ${role} in organization ${orgName}`),
      app: this.app,
      path: `${this.api.path}/members/${memberName}`,
      data: {
        role: role,
      },
    });
    return this.getMembers();
  }
  public async delete() {
    const orgName = this.slug;
    await _delete<Routes.accounts._account.Delete>({
      errorWithCleanerStack: getErr(`Failed to delete organization ${orgName}.`),
      app: this.app,
      path: this.api.path,
      expectedResponseBody: "empty",
    });
    delete this._info;
  }
}
