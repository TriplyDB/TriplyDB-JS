import App from "../App";
import { Account } from "../Account";
import Dataset from "../Dataset";

import * as chai from "chai";
import { resetUnittestAccount, CommonUnittestPrefix } from "./utils";
import User from "../User";
const expect = chai.expect;
process.on("unhandledRejection", function (reason: any, p: any) {
  console.warn("Possibly Unhandled Rejection at: Promise ", p, " reason: ", reason);
});

const datasetsToClean: Dataset[] = [];
let testDsIndex = 0;
const getNewTestDs = async (account: Account, accessLevel: "public" | "private") => {
  const ds = await account.addDataset({
    // keep the name short to avoid hitting the 40-character limit
    name: `${CommonUnittestPrefix}-${testDsIndex++}`,
    accessLevel: accessLevel,
  });
  datasetsToClean.push(ds);
  return ds;
};

describe("Queries", function () {
  let app: App;
  let user: User;
  let testDs: Dataset;
  before(async function () {
    this.timeout(10000);
    app = App.get({ token: process.env.UNITTEST_TOKEN_ACCOUNT });
    user = await app.getUser();
    await resetUnittestAccount(user);
    testDs = await getNewTestDs(user, "private");
  });
  it("Should create, update, and delete query", async function () {
    const query = await user.addQuery({
      name: "test-query",
      accessLevel: "private",
      dataset: await testDs.getInfo().then((i) => i.id),
    });
    expect(await query.getInfo().then((q) => q.accessLevel)).to.equal("private");
    await query.update({ accessLevel: "internal" });
    expect(await query.getInfo().then((q) => q.accessLevel)).to.equal("internal");
    await query.delete();
  });
});
