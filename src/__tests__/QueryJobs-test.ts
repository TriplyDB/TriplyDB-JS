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
import QueryJob from "../bin/QueryJob.js";
import { _get } from "../RequestHandler.js";
import { getErr } from "../utils/Error.js";
import { Routes_queryJobs } from "../bin/QueryJobModels.js";
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

describe("Query Jobs", function () {
  let app: App;
  let user: User;
  let testDs: Dataset;
  let testQuery1: Query;
  let testQuery2: Query;
  let testQueryJob: QueryJob;
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
    testQueryJob = new QueryJob(app, user);
  });
  after(async function () {
    await resetUnittestAccount(user);
  });
  // Skipping this test case for now due to account permissions need to exec query job operations
  it("Should create a query job and wait till it is finished", async function () {
    const query1 = await testQuery1.getInfo();
    const query2 = await testQuery2.getInfo();
    const testDsInfo = await testDs.getInfo();
    const pipelineId = await testQueryJob.createQueryJobPipeline(
      {
        queries: [
          {
            name: `${query1.owner.accountName}/${query1.name}`,
            version: query1.version,
          },
          {
            name: `${query2.owner.accountName}/${query2.name}`,
            version: query2.version,
          },
        ],
        sourceDataset: `${testDsInfo.owner.accountName}/${testDsInfo.name}`,
        targetDataset: `${testDsInfo.owner.accountName}/${testDsInfo.name}`,
        version: 0.1,
      },
      [
        {
          queryAccountName: query1.owner.accountName,
          queryName: query1.name,
        },
        {
          queryAccountName: query2.owner.accountName,
          queryName: query2.name,
        },
      ],
    );

    const accountName = query1.owner.accountName;
    const pathChunks: string[] = ["queryJobs", accountName, "pipeline", pipelineId];
    const path = "/" + pathChunks.join("/");

    const pipeline = await _get<Routes_queryJobs._account.pipeline._pipeline.Get>({
      errorWithCleanerStack: getErr(`Failed to get pipeline status`),
      app: app,
      path: path,
      expectedResponseBody: "json",
    });

    chai.expect(pipeline.pipelineStatus).to.equal("finished");
    chai.expect(pipeline.progress).to.equal(1);
  });
});
