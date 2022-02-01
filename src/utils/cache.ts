import * as fs from "fs-extra";
import md5 from "md5";
import path from "path";
import { gzip, gunzip } from "zlib";
export interface CachedResult {
  statusCode: number;
  responseText: string;
  nextPage: string | null;
  contentType: string | null;
  statusText: string;
}

export interface CacheKey {
  url: string;
  config?: RequestInit;
}
/**
 *  Given a description of a request and the response from that request, save
 *  the response to cache.
 */
export type ToCacheFn = (key: CacheKey, result: CachedResult) => Promise<void>;
/**
 *  Given a description of a request, find whether it exists in the cache.
 *  If so, return the cached result. Otherwise return `undefined`.
 */
export type FromCacheFn = (key: CacheKey) => Promise<CachedResult | undefined>;
export type Cache = {
  write: ToCacheFn;
  read: FromCacheFn;
  cacheId: string | undefined;
};
export function fileCache({ cacheDir, compression }: { cacheDir: string; compression: "gz" | undefined }): Cache {
  const compress =
    compression === "gz"
      ? async (data: string) =>
          new Promise<Buffer>((resolve, reject) =>
            gzip(data, (error, result) => {
              if (error) return reject(error);
              resolve(result);
            })
          )
      : (data: string) => Buffer.from(data);

  const inflate =
    compression === "gz"
      ? async (data: Buffer) =>
          new Promise<string>((resolve, reject) =>
            gunzip(data, (error, result) => {
              if (error) return reject(error);
              resolve(result.toString("utf-8"));
            })
          )
      : (data: Buffer) => data.toString("utf-8");

  function getCacheFile(key: CacheKey) {
    return path.resolve(cacheDir, md5(JSON.stringify(key) + cache.cacheId));
  }
  const cache: Cache = {
    // We don't know the cache ID yet, but it may be set/changed by whetever we use this function, e.g. in the Query class
    cacheId: undefined,
    read: async (key) => {
      const cacheFile = getCacheFile(key);
      if (await fs.pathExists(cacheFile)) {
        return JSON.parse(await inflate(await fs.readFile(cacheFile)));
      }
    },
    write: async (key, result) => {
      await fs.writeFile(getCacheFile(key), await compress(JSON.stringify(result)));
    },
  };
  return cache;
}
