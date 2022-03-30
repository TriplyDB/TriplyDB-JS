import { Models, Routes } from "@triply/utils";
import User from "./User";
import { Account, getUserOrOrg } from "./Account";
import Org from "./Org";
import jwt_decode from "jwt-decode";
import { _get } from "./RequestHandler";
import { getErr } from "./utils/Error";
import AsyncIteratorHelper from "./utils/AsyncIteratorHelper";
import * as calver from "@triply/utils/lib/calver";
import { bootstrap } from "global-agent";

bootstrap();
import semver from "semver";
import { MarkRequired } from "ts-essentials";

export interface AppConfig {
  /**
   * Token
   */
  token?: string;
  /**
   * Api URL
   */
  url?: string;
  /**
   * HTTP proxy
   */
  httpProxy?: string;
  /**
   * HTTPS proxy
   */
  httpsProxy?: string;
}
const APP_CONFIG_DEFAULTS = {
  url: "https://api.triplydb.com",
};
export default class App {
  private _config: MarkRequired<AppConfig, "url">;
  private _info?: Models.ClientConfig;
  private constructor(conf: Readonly<AppConfig> = {}) {
    this._config = {
      ...APP_CONFIG_DEFAULTS,
      ...conf,
    };
    // Extract url from token
    if ((!this._config.url || this._config.url === APP_CONFIG_DEFAULTS.url) && this._config.token) {
      try {
        const decodedToken: Models.JwtPayload = jwt_decode(this._config.token);
        // Skip old hardcoded issuer
        if (decodedToken && decodedToken.iss !== "triply.cc") this._config.url = decodedToken.iss;
      } catch {
        throw getErr("Invalid token").addContext({ token: this._config.token });
      }
    }
    if (this._config.httpProxy || this._config.httpsProxy) {
      /**
       * We cannot set the proxy per request, as we're not using fetch alone, but e.g. tus uses the http/https module directly.
       */
      bootstrap();
      (global as any).GLOBAL_AGENT.HTTP_PROXY = this._config.httpsProxy || this._config.httpProxy;
      (global as any).GLOBAL_AGENT.HTTPS_PROXY = this._config.httpsProxy;
    }
  }

  public getConfig() {
    return this._config;
  }

  public async getInfo() {
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
    return getUserOrOrg({
      accountName: accountName,
      app: this,
      notExistsErrorMessage: `Failed to fetch account ${accountName}. This account does not exist.`,
    });
  }
  public getAccounts() {
    return new AsyncIteratorHelper<Models.Account, Account>({
      potentialFutureError: getErr(`Failed to get accounts`),
      getErrorMessage: async () => `Failed to get all accounts.`,
      app: this,
      getUrl: async () => this["_config"].url! + `/accounts`,
      mapResult: async (account) => {
        // We're explicitly not passing the account object to the _info parameter as it's not the verbose version.
        // On the TDB API, /accounts currently only returns simple information.
        if (account.type === "user") {
          return new User(this, account.accountName);
        } else {
          return new Org(this, account.accountName);
        }
      },
    });
  }
  public async getUser(accountName?: string) {
    if (!accountName) {
      return new User(this);
    }
    const getUser = await getUserOrOrg({
      accountName: accountName,
      app: this,
      notExistsErrorMessage: `Failed to fetch user ${accountName}. This user does not exist. Make sure that you have not mistyped the user name.`,
    });

    return getUser.asUser();
  }
  public async getOrganization(accountName: string) {
    const getOrganization = await getUserOrOrg({
      accountName: accountName,
      app: this,
      notExistsErrorMessage: `Failed to fetch organization ${accountName}. This organization does not exist.`,
    });
    return getOrganization.asOrganization();
  }
  public async isCompatible(minimumVersion: string) {
    const apiInfo = await this.getInfo();
    if (!apiInfo.version) throw getErr(`The TriplyDB API ${apiInfo.apiUrl} does not report its version.`);
    if (apiInfo.version === "unset") return true;
    if (calver.isSemver(apiInfo.version) && calver.isSemver(minimumVersion)) {
      return semver.gte(apiInfo.version, minimumVersion);
    } else {
      return calver.gte(apiInfo.version, minimumVersion);
    }
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
