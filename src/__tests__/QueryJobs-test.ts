import App from "../App.js";
import { Account } from "../Account.js";
import Dataset from "../Dataset.js";
import fs from "fs-extra";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;
import { resetUnittestAccount, CommonUnittestPrefix } from "./utils.js";
import User from "../User.js";
import Query from "../Query.js";

import dotenv from "dotenv";
import QueryJob from "../bin/QueryJob.js";
dotenv.config();

process.on("unhandledRejection", function (reason: any, p: any) {
  console.warn("Possibly Unhandled Rejection at: Promise ", p, " reason: ", reason);
});
const tmpDir = "./src/__tests__/tmp";
let testDsIndex = 0;
const getNewTestDs = async (account: Account, accessLevel: "public" | "private") => {
  const ds = await account.addDataset(
    // keep the name short to avoid hitting the 40-character limit
    `${CommonUnittestPrefix}-${testDsIndex++}`,
    { accessLevel: accessLevel }
  );
  return ds;
};

describe("Query Jobs", function () {
  let app: App;
  let user: User;
  let testDs: Dataset;
  let testQuery: Query;
  let testQueryJob: QueryJob;
  before(async function () {
    app = App.get({ token: process.env.UNITTEST_TOKEN_ACCOUNT });
    user = await app.getUser();
    await resetUnittestAccount(user);
    testDs = await getNewTestDs(user, "private");
    await fs.mkdirp(tmpDir);
    await testDs.importFromFiles(["./src/__tests__/__data__/small.nq"]);
    testQuery = await user.addQuery(`${CommonUnittestPrefix}-test-query`, {
      accessLevel: "private",
      queryString: "construct WHERE { ?x ?y ?z } limit 1",
      output: "table",
      dataset: testDs,
      serviceType: "speedy",
    });
    testQueryJob = new QueryJob(app, user);
  });
  after(async function () {
    await resetUnittestAccount(user);
  });
  it("Should create a query job and wait till it is finished", async function () {
    // Skipping this test case for now due to account permissions need to exec query job operations

    const createdQb = await testQueryJob.createQueryJob({
      queryId: (await testQuery.getInfo()).id,
      queryVersion: (await testQuery.getInfo()).version,
      sourceDatasetId: (await testDs.getInfo()).id,
      targetDatasetId: (await testDs.getInfo()).id,
    });
    expect(createdQb.queryName).to.equal((await testQuery.getInfo()).name);
    expect(createdQb.sourceDatasetName).to.equal((await testDs.getInfo()).name);
    expect(createdQb.targetDatasetName).to.equal((await testDs.getInfo()).name);
    expect(createdQb.status).to.equal("finished");
    after(function () {
      void testQueryJob.deleteQueryJob(createdQb.id);
    });
  });
});
