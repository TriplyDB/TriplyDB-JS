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
  private _name?: string;
  public readonly type = "Org";
  //leave accountname empty to get account belonging to token
  public constructor(app: App, accountName: string, info?: Models.Org) {
    this.app = app;
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
  public ensureStory = ensureStory;

  public async asUser(): Promise<User> {
    const info = await this.getInfo();
    throw getErr(`Failed to fetch user ${info.accountName}. Note that there is an organization with that name.`);
  }
  public async asOrganization(): Promise<this> {
    return this;
  }
  public async getInfo(refresh = false) {
    if (!refresh && this._info) return this._info;
    if (!this._name) throw getErr("Missing name for organization");
    this._setInfo(
      (await _get<Routes.accounts._account.Get>({
        errorWithCleanerStack: getErr(`Failed to get information of organization ${this._name}.`),
        app: this.app,
        path: "/accounts/" + this._name,
        query: { verbose: "" },
      })) as Models.Org,
    );
    return this._info!;
  }
  private _setInfo(info: Models.Org) {
    this._info = info;
    this._name = info.accountName;
  }

  public async getMembers() {
    const orgName = (await this.getInfo()).accountName;
    return _get<Routes.accounts._account.members.Get>({
      errorWithCleanerStack: getErr(`Failed to get members of organization ${orgName}.`),
      app: this.app,
      path: `/accounts/${orgName}/members`,
    });
  }
  public async addMember(user: User, role: Models.OrgRole = "member") {
    const orgName = (await this.getInfo()).accountName;
    const memberName = (await user.getInfo()).accountName;
    return _post<Routes.accounts._account.members.Post>({
      errorWithCleanerStack: getErr(`Failed to add ${memberName} as member to organization ${orgName}.`),
      app: this.app,
      data: { accountName: memberName, role },
      path: `/accounts/${orgName}/members`,
    });
  }
  public async removeMember(member: User) {
    const orgName = (await this.getInfo()).accountName;
    const memberName = (await member.getInfo()).accountName;
    await _delete<Routes.accounts._account.members._member.Delete>({
      errorWithCleanerStack: getErr(`Failed to remove ${memberName} as member of organization ${this._name}.`),
      app: this.app,
      path: `/accounts/${orgName}/members/${memberName}`,
      expectedResponseBody: "empty",
    });
  }
  public async changeRole(member: User, role: Models.OrgRole) {
    const orgName = (await this.getInfo()).accountName;
    const memberName = (await member.getInfo()).accountName;
    await _patch<Routes.accounts._account.members._member.Patch>({
      errorWithCleanerStack: getErr(`Failed to change role of ${memberName} to ${role} in organization ${orgName}`),
      app: this.app,
      path: `/accounts/${orgName}/members/${memberName}`,
      data: {
        role: role,
      },
    });
    return this.getMembers();
  }
  public async delete() {
    const orgName = (await this.getInfo()).accountName;
    await _delete<Routes.accounts._account.Delete>({
      errorWithCleanerStack: getErr(`Failed to delete organization ${orgName}.`),
      app: this.app,
      path: `/accounts/${orgName}`,
      expectedResponseBody: "empty",
    });
    delete this._info;
  }
}
