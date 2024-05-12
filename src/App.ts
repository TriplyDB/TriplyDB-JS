import { Models, Routes } from "@triply/utils";
import User from "./User.js";
import { Account, getUserOrOrg } from "./Account.js";
import Org from "./Org.js";
import { jwtDecode } from "jwt-decode";
import { _get } from "./RequestHandler.js";
import { getErr } from "./utils/Error.js";
import AsyncIteratorHelper from "./utils/AsyncIteratorHelper.js";
import * as calver from "@triply/utils/calver.js";
import { bootstrap } from "global-agent";

if (typeof process === "object" && process.title === "node") bootstrap();
import semver from "semver";
import { MarkRequired } from "ts-essentials";
import Dataset from "./Dataset.js";
import Query from "./Query.js";
import Story from "./Story.js";

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
        const decodedToken: Models.JwtPayload = jwtDecode(this._config.token);
        // Skip old hardcoded issuer
        if (decodedToken && decodedToken.iss && decodedToken.iss !== "triply.cc") this._config.url = decodedToken.iss;
      } catch {
        throw getErr("Invalid token").addContext({ token: this._config.token });
      }
    }
    // Validate token, headers only allow ASCII range " "-"~"
    if (this._config.token && !/^[\x20-\x7F]+$/.test(this._config.token)) {
      throw getErr("Illegal character in token").addContext({ token: this._config.token });
    }
    if (this._config.httpProxy || this._config.httpsProxy) {
      /**
       * We cannot set the proxy per request, as we're not using fetch alone, but e.g. tus uses the http/https module directly.
       */
      bootstrap();
      (global as any).GLOBAL_AGENT.HTTP_PROXY = this._config.httpsProxy || this._config.httpProxy;
      (global as any).GLOBAL_AGENT.HTTPS_PROXY = this._config.httpsProxy;
    }
    if (this._config.url.endsWith("/")) this._config.url = this._config.url.slice(0, -1);
  }
  public get url() {
    return this._config.url;
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
    const info = await this.getInfo();
    let errMsg = `Failed to get account information of ${accountName}.`;
    if (!accountName) {
      errMsg = `Failed to fetch the current user, because no API token is configured. If you want to fetch the current user, you must create an API token on <${info.consoleUrl}/me/-/settings/tokens>.`;
    }
    return getUserOrOrg({
      accountName: accountName,
      app: this,
      notExistsErrorMessage: errMsg,
    });
  }
  public getAccounts() {
    return new AsyncIteratorHelper<Models.Account, Account>({
      potentialFutureError: getErr(`Failed to get accounts`),
      getErrorMessage: async () => `Failed to get all accounts.`,
      app: this,
      getUrl: async () => this.url + `/accounts`,
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
    const info = await this.getInfo();
    let errMsg = `Failed to get user information of ${accountName}.`;
    if (!accountName) {
      errMsg = `Failed to fetch the current user, because no API token is configured. If you want to fetch the current user, you must create an API token on <${info.consoleUrl}/me/-/settings/tokens>.`;
    }
    const getUser = await getUserOrOrg({
      accountName: accountName,
      app: this,
      notExistsErrorMessage: errMsg,
    });

    return getUser.asUser();
  }
  public async getOrganization(accountName: string) {
    const getOrganization = await getUserOrOrg({
      accountName: accountName,
      app: this,
      notExistsErrorMessage: `Failed to fetch organization ${accountName}.`,
    });
    return getOrganization.asOrganization();
  }

  /**
   * Get a TriplyDB resource using a string identifier.
   * Examples:
   * - To get one of your datasets, run `app.get('dataset/my-dataset-name')`
   * - To get a dataset of a different account, run `app.get('dataset/other-account/my-dataset-name')`
   * Apply the same for any string starting with user, account, org, dataset, query or story
   */
  public async get(idString: `account`): Promise<Account>;
  public async get(idString: `user`): Promise<User>;
  public async get(idString: `account/${string}`): Promise<Account>;
  public async get(idString: `user/${string}`): Promise<User>;
  public async get(idString: `org/${string}`): Promise<Org>;
  public async get(idString: `dataset/${string}`): Promise<Dataset>;
  public async get(idString: `query/${string}`): Promise<Query>;
  public async get(idString: `story/${string}`): Promise<Story>;
  public async get(idString: string) {
    const fragments = idString.split("/");
    const type = fragments[0];
    if (type === "account") return this.getAccount(fragments[1]);
    if (type === "user") return this.getUser(fragments[1]);
    if (type === "org") return this.getOrganization(fragments[1]);
    if (fragments.length > 3) throw new Error("Unrecognized identifier " + idString);
    // Check whether the account is mentioned explicitly
    const account = await this.getAccount(fragments.length > 2 ? fragments[1] : undefined);
    const resourceIdentifier = fragments[fragments.length - 1];
    if (type === "dataset") return account.getDataset(resourceIdentifier);
    if (type === "query") return account.getQuery(resourceIdentifier);
    if (type === "story") return account.getStory(resourceIdentifier);
    throw new Error("Unrecognized identifier " + idString);
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
   * There may be situations where we access the API via a different domain. E.g., we may
   * host TriplyDB on one domain, but have an ETL access it directly in the kubernetes cluster to avoid latency.
   * In that case we want the TriplyDB-API to post-process link headers from the API, so that we send a next page to
   * the correct location
   */
  // @ts-ignore Used other deps, but dont want to bloat the app js api
  private getPostProcessedApiUrl(urlFromApi: string) {
    const parsedApiUrl = new URL(urlFromApi);
    // Only modify when we explicitly pass a different URL as argument.
    // Assuming that the URL from the `/info` API route is already always the same as all other URLs used in
    // e.g. link headers that we get from that same API
    const parsedConfigUrl = new URL(this._config.url);
    // see https://nodejs.org/docs/latest-v14.x/api/url.html#url_url_strings_and_url_objects
    parsedApiUrl.host = parsedConfigUrl.host; // e.g. `triplydb.com:5000`
    parsedApiUrl.protocol = parsedConfigUrl.protocol; // e.g. `http`
    return parsedApiUrl.toString();
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
