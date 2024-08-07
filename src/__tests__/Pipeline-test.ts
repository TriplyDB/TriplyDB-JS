import App from "../App.js";
import { Account } from "../Account.js";
import Dataset from "../Dataset.js";
import fs from "fs-extra";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
import { resetUnittestAccount, CommonUnittestPrefix } from "./utils.js";
import User from "../User.js";
import Query from "../Query.js";

import dotenv from "dotenv";
import { _get } from "../RequestHandler.js";
import { getErr } from "../utils/Error.js";
import { Routes } from "@triply/utils";
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
    { accessLevel: accessLevel },
  );
  return ds;
};

describe("Pipeline", function () {
  let app: App;
  let user: User;
  let testDs: Dataset;
  let testQuery1: Query;
  let testQuery2: Query;
  let testQuery3: Query;
  let testQuery4: Query;
  let testQuery5: Query;
  before(async function () {
    app = App.get({ token: process.env.UNITTEST_TOKEN_ACCOUNT });
    user = await app.getUser();
    await resetUnittestAccount(user);
    testDs = await getNewTestDs(user, "private");
    await fs.mkdirp(tmpDir);
    await testDs.importFromFiles(["./src/__tests__/__data__/small.nq"]);
    testQuery1 = await user.addQuery(`${CommonUnittestPrefix}-test-query1`, {
      accessLevel: "private",
      queryString: "construct WHERE { <a:a> ?b ?c }",
      output: "table",
      dataset: testDs,
      serviceType: "speedy",
    });
    testQuery2 = await user.addQuery(`${CommonUnittestPrefix}-test-query2`, {
      accessLevel: "private",
      queryString: "construct WHERE { <x:x> ?y ?z }",
      output: "table",
      dataset: testDs,
      serviceType: "speedy",
    });
    testQuery3 = await user.addQuery(`${CommonUnittestPrefix}-test-query3`, {
      accessLevel: "private",
      queryString: "construct WHERE { <x:x3> ?y ?z }",
      output: "table",
      dataset: testDs,
      serviceType: "speedy",
    });
    testQuery4 = await user.addQuery(`${CommonUnittestPrefix}-test-query4`, {
      accessLevel: "private",
      queryString: "construct WHERE { <x:x4> ?y ?z }",
      output: "table",
      dataset: testDs,
      serviceType: "speedy",
    });
    testQuery5 = await user.addQuery(`${CommonUnittestPrefix}-test-query5`, {
      accessLevel: "private",
      queryString: "construct WHERE { <x:x5> ?y ?z }",
      output: "table",
      dataset: testDs,
      serviceType: "speedy",
    });
  });
  after(async function () {
    await resetUnittestAccount(user);
  });
  it("Should create a query job and wait till it is finished", async function () {
    const pipeline = await user.runPipeline({
      queries: [testQuery1, testQuery2, testQuery3, testQuery4, testQuery5],
      destination: {
        dataset: testDs,
      },
    });

    const finishedPipeline = await _get<Routes.pipelines._account._pipeline.Get>({
      errorWithCleanerStack: getErr(`Failed to get pipeline status`),
      app: app,
      path: `/pipelines/${user.slug}/${pipeline.slug}`,
      expectedResponseBody: "json",
    });

    chai.expect(finishedPipeline.status).to.equal("finished");
    chai.expect(finishedPipeline.progress).to.equal(1);
  });
});
