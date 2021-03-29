import { Account } from "../Account";
import * as path from "path";
export const CommonUnittestPrefix = process.env["UNITTEST_NAMESPACE"] + "-triplydb-js";
import App from "../App";
import { TriplyDbJsError, getErr } from "../utils/Error";
import User from "../User";
function throwErrorWhenNameNotPrefixed(name: string) {
  if (!name.startsWith(CommonUnittestPrefix)) {
    throw new Error(
      `Resetting unittest account, and found a resource called ${name}. ` +
        `Expected this to be prefixed with ${CommonUnittestPrefix} to avoid ` +
        `throwing too many things away while testing...`
    );
  }
}

async function removeDatasetsOfAccount(account: Account) {
  for await (const dataset of account.getDatasets()) {
    if (!dataset) break;
    const info = await dataset.getInfo();
    throwErrorWhenNameNotPrefixed(info.name);
    await dataset.delete();
  }
}
export async function resetUnittestAccount(user: User) {
  await removeDatasetsOfAccount(user);
  const orgs = await user.getOrganizations();
  for (const org of orgs) {
    throwErrorWhenNameNotPrefixed(await org.getName());
    await org.delete();
  }

  //empty pinned datasetes
  await user.pinItems([]);
}
/**
 * Rewrite a build path (e.g. /home/...../api/build/src/_data) to a src path
 * (e.g. /home/...../api/src/_data)
 */
export function buildPathToSrcPath(...pathInBuildDir: string[]) {
  const fullBuildPath = path.resolve(...pathInBuildDir);
  //Assume the current-working-dir is the root of this triplydb-js package
  //(ie the place where we find the package.json of the triplydb-js

  const relativeToCwd = path.relative(path.resolve("./"), fullBuildPath);

  const [, ...newRelative] = path.normalize(relativeToCwd).split("/");
  return path.resolve("src", ...newRelative);
}
//Expecting this username to exist on the instance.
export const staticOtherUser = "triplydb-js-testuser";
export async function getOtherUser(app: App) {
  try {
    return await app.getUser(staticOtherUser);
  } catch (e) {
    if (e instanceof TriplyDbJsError && e.statusCode === 404) {
      throw getErr(
        `User ${staticOtherUser} does not exist. Please create it manually via the console, and rerun the test`
      );
    }
    throw e;
  }
}
