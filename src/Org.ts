import { Models, Routes } from "@triply/utils";
import App from "./App";
import { AccountBase } from "./Account";
import User from "./User";
import { _delete, _patch, _post, _get } from "./RequestHandler";

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
  getName,
  ensureDataset,
} from "./commonAccountFunctions";
import { getErr } from "./utils/Error";

export default class Org implements AccountBase {
  private _app: App;
  private _info?: Models.Org;
  private _name?: string;
  public readonly type = "Org";
  //leave accountname empty to get account belonging to token
  public constructor(app: App, accountName: string, info?: Models.Org) {
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
  /** @deprecated Use (await getInfo()).accountName instead. */
  public getName = getName;
  public ensureDataset = ensureDataset;

  public asUser(): User {
    throw getErr(`${this._info?.accountName || "This"} is an organization. Cannot fetch this as a user.`);
  }
  public asOrganization(): this {
    return this;
  }
  public async getInfo(refresh = false) {
    if (!refresh && this._info) return this._info;
    if (!this._name) throw getErr("Missing name for organization");
    this._setInfo(
      (await _get<Routes.accounts._account.Get>({
        errorWithCleanerStack: getErr(`Failed to get information of organization ${this._name}.`),
        app: this._app,
        path: "/accounts/" + this._name,
        query: { verbose: "" },
      })) as Models.Org
    );
    return this._info!;
  }
  private _setInfo(info: Models.Org) {
    this._info = info;
    this._name = info.accountName;
  }

  public async getMembers() {
    const orgName = (await this.getInfo()).accountName;
    return await _get<Routes.accounts._account.members.Get>({
      errorWithCleanerStack: getErr(`Failed to get members of organization ${orgName}.`),
      app: this._app,
      path: `/accounts/${orgName}/members`,
    });
  }
  public async addMember(user: User | string, role: Models.OrgRole = "member") {
    const orgName = (await this.getInfo()).accountName;
    const memberName = typeof user === "string" ? user : (await user.getInfo()).accountName;
    await _post<Routes.accounts._account.members.Post>({
      errorWithCleanerStack: getErr(`Failed to add ${user} as member to organization ${this._name}.`),
      app: this._app,
      data: { accountName: memberName, role },
      path: `/accounts/${orgName}/members`,
    });
    return this.getMembers();
  }
  public async removeMember(member: User | string) {
    const orgName = (await this.getInfo()).accountName;
    const memberName = typeof member === "string" ? member : (await member.getInfo()).accountName;
    await _delete<Routes.accounts._account.members._member.Delete>({
      errorWithCleanerStack: getErr(`Failed to remove ${memberName} as member of organization ${this._name}.`),
      app: this._app,
      path: `/accounts/${orgName}/members/${memberName}`,
      expectedResponseBody: "empty",
    });
    return this.getMembers();
  }
  public async changeRole(member: User, role: Models.OrgRole) {
    const orgName = (await this.getInfo()).accountName;
    const memberName = (await member.getInfo()).accountName;
    await _patch<Routes.accounts._account.members._member.Patch>({
      errorWithCleanerStack: getErr(`Failed to change role of ${memberName} to ${role} in organization ${orgName}`),
      app: this._app,
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
      app: this._app,
      path: `/accounts/${orgName}`,
      expectedResponseBody: "empty",
    });
    delete this._info;
  }
}
