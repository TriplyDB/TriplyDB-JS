import Dataset from "./Dataset";

import { Models, Routes } from "@triply/utils";

import User from "./User";
import { getUserOrOrg } from "./Account";
import jwt_decode from "jwt-decode";
import { _get } from "./RequestHandler";
import { getErr } from "./utils/Error";
import semver from "semver";

export interface AppConfig {
  /**
   * Token
   */
  token?: string;
  /**
   * Api URL
   */
  url?: string;
}
const APP_CONFIG_DEFAULTS = {
  url: "https://api.triplydb.com",
};
export default class App {
  private _config: AppConfig;
  private _info?: Models.ClientConfig;
  private constructor(conf: AppConfig = {}) {
    this._config = { ...conf };
    // Extract url form token
    if (!this._config.url && this._config.token) {
      try {
        const decodedToken: Models.JwtPayload = jwt_decode(this._config.token);
        // Skip old hardcoded issuer
        if (decodedToken && decodedToken.iss !== "triply.cc") this._config.url = decodedToken.iss;
      } catch {
        throw new Error("Invalid token");
      }
    }
    this._config = {
      ...APP_CONFIG_DEFAULTS,
      ...this._config,
    };
    this.validateConf();
  }

  private validateConf(): void {
    if (!this._config) throw new Error("No configuration object set");
    if (!this._config.url) throw new Error("No domain specified in configuration");
  }

  public async getApiInfo() {
    if (this._info) return this._info;
    this._info = await _get<Routes.info.Get>({
      app: this,
      path: "/info",
      errorWithCleanerStack: getErr(`Failed to fetch API information of ${this._config.url}.`),
    });
    return this._info;
  }

  public async getAccount(accountName?: string) {
    if (!accountName) {
      //no account name passed, this must be a user as we'll be using the token
      //to fetch the account info
      return new User(this);
    }
    return getUserOrOrg(accountName, this);
  }
  public async getUser(accountName?: string) {
    if (!accountName) {
      return new User(this);
    }
    return (await getUserOrOrg(accountName, this)).asUser();
  }
  public async getOrganization(accountName: string) {
    return (await getUserOrOrg(accountName, this)).asOrg();
  }
  public async getDataset(accountName: string, dsName: string): Promise<Dataset> {
    const account = await this.getAccount(accountName);
    return new Dataset(this, account, dsName);
  }
  public async isCompatible(minimumVersion: string) {
    const apiVersion = await this.getApiInfo().then((info) => info.version);
    if (!apiVersion) throw new Error("API does not report its version.");
    return apiVersion === "unset" || semver.gte(apiVersion, minimumVersion);
  }

  /**
   * Get a TriplyDB-JS instance.
   */
  public static get(conf?: AppConfig | string) {
    let app: App;
    if (typeof conf === "string") {
      app = new App({ token: conf });
    } else {
      app = new App(conf);
    }
    return app;
  }
}
