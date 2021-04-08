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
  exists,
  update,
  getName,
  ensureDs,
} from "./commonAccountFunctions";
import { getErr } from "./utils/Error";

export default class Org implements AccountBase {
  private _app: App;
  private _info?: Models.Org;
  private _members?: Models.OrgMember[];
  private _name?: string;
  //leave accountname empty to get account belonging to token
  public constructor(app: App, accountName: string, info: Models.Org) {
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

  public asUser(): User {
    throw getErr(`${this._info?.accountName || "This"} is an organization. Cannot fetch this as a user.`);
  }
  public asOrg(): this {
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

  public async getMembers(refresh = false) {
    if (refresh || !this._members) {
      const name = await this.getName();
      this._members = await _get<Routes.accounts._account.members.Get>({
        errorWithCleanerStack: getErr(`Failed to get members of organization ${name}.`),
        app: this._app,
        path: `/accounts/${name}/members`,
      });
    }
    return this._members;
  }
  public async addMembers(...members: Array<{ user: User | string; role: Models.OrgRole }>) {
    const name = await this.getName();
    await Promise.all(
      members.map(async (m) => {
        const memberName = typeof m.user === "string" ? m.user : await m.user.getName();
        return _post<Routes.accounts._account.members.Post>({
          errorWithCleanerStack: getErr(`Failed to add ${m.user} as member to organization ${this._name}.`).addContext(
            m
          ),
          app: this._app,
          data: { accountName: memberName, role: m.role },
          path: `/accounts/${name}/members`,
        });
      })
    );
    return this.getMembers(true);
  }
  public async removeMembers(...members: Array<User | string>) {
    const name = await this.getName();
    await Promise.all(
      members.map(async (m) => {
        const memberName = typeof m === "string" ? m : await m.getName();
        return _delete<Routes.accounts._account.members._member.Delete>({
          errorWithCleanerStack: getErr(`Failed to remove ${memberName} as member of organization ${this._name}.`),
          app: this._app,
          path: `/accounts/${name}/members/${memberName}`,
          expectedResponseBody: "empty",
        });
      })
    );
    return this.getMembers(true);
  }
  public async changeRole(member: User, role: Models.OrgRole) {
    const orgName = await this.getName();
    const memberName = await member.getName();
    await _patch<Routes.accounts._account.members._member.Patch>({
      errorWithCleanerStack: getErr(`Failed to change role of ${memberName} to ${role} in organization ${orgName}`),
      app: this._app,
      path: `/accounts/${orgName}/members/${memberName}`,
      data: {
        role: role,
      },
    });
    return this.getMembers(true);
  }
  public async delete() {
    const name = await this.getName();
    await _delete<Routes.accounts._account.Delete>({
      errorWithCleanerStack: getErr(`Failed to delete organization ${name}.`),
      app: this._app,
      path: `/accounts/${name}`,
      expectedResponseBody: "empty",
    });
    delete this._info;
    delete this._members;
  }
}
