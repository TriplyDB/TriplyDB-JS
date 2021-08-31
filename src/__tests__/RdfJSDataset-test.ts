import App from "../App";
import { Account } from "../Account";
import Dataset from "../Dataset";
import * as chai from "chai";
import { DataFactory } from "n3";
import { resetUnittestAccount, buildPathToSrcPath, CommonUnittestPrefix } from "./utils";
import User from "../User";
import * as fs from "fs-extra";
import { TriplyRdfJSDataset } from "../RdfJSDataset";
const expect = chai.expect;
process.on("unhandledRejection", function (reason: any, p: any) {
  console.warn("Possibly Unhandled Rejection at: Promise ", p, " reason: ", reason);
});
const tmpDir = buildPathToSrcPath(__dirname, "tmp");
const datasetsToClean: Dataset[] = [];
let testDsIndex = 0;
const getNewTestDs = async (account: Account, accessLevel: "public" | "private") => {
  const ds = await account.addDataset(
    // keep the name short to avoid hitting the 40-character limit
    `${CommonUnittestPrefix}-${testDsIndex++}`,
    { accessLevel: accessLevel }
  );
  datasetsToClean.push(ds);
  return ds;
};

describe("RDFJS Dataset", function () {
  let app: App;
  let user: User;
  before(async function () {
    await fs.mkdirp(tmpDir);
    app = App.get({
      url: process.env.UNITTEST_API_URL,
      token: process.env.UNITTEST_TOKEN_ACCOUNT,
    });
    user = await app.getUser();

    await resetUnittestAccount(user);
  });

  describe("Getting statements", function () {
    this.timeout(15000);
    let testDs: Dataset;
    before(async function () {
      await resetUnittestAccount(user);
      testDs = await getNewTestDs(user, "private");
      await testDs.importFromFiles(
        buildPathToSrcPath(__dirname, "__data__", "test102.nt"),
        buildPathToSrcPath(__dirname, "__data__", "test103.nq")
      );
    });
    it("without constraints", function () {
      const dataset = new TriplyRdfJSDataset(testDs);
      let i = 0;
      for (const _statement of dataset) {
        i++;
      }
      expect(i).to.equal(104);
    });
    it("with a certain subject", async function () {
      const dataset = new TriplyRdfJSDataset(testDs).match(
        DataFactory.namedNode("http://data.socialhistory.org/vocab/hisco/entry/")
      );
      let i = 0;
      for (const _statement of dataset) {
        i++;
      }
      expect(i).to.equal(8);
    });
  });
});
