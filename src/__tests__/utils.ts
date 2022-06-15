import { Account } from "../Account";
export const CommonUnittestPrefix = process.env["UNITTEST_NAMESPACE"] || "triplydb-js-";
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
async function removeQueriesOfAccount(account: Account) {
  for await (const query of account.getQueries()) {
    if (!query) break;
    const info = await query.getInfo();
    throwErrorWhenNameNotPrefixed(info.name);
    await query.delete();
  }
}
async function removeStoriesOfAccount(account: Account) {
  for await (const story of account.getStories()) {
    if (!story) break;
    const info = await story.getInfo();
    throwErrorWhenNameNotPrefixed(info.name);
    await story.delete();
  }
}
export async function resetUnittestAccount(user: User) {
  await removeDatasetsOfAccount(user);
  await removeQueriesOfAccount(user);
  await removeStoriesOfAccount(user);

  const orgs = await user.getOrganizations();
  for (const org of orgs) {
    throwErrorWhenNameNotPrefixed((await org.getInfo()).accountName);
    await org.delete();
  }

  //empty pinned datasetes
  await user.pinItems([]);
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
