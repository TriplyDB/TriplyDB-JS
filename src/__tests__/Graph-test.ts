import App from "../App.js";
import { Account } from "../Account.js";
import Dataset from "../Dataset.js";
import path from "path";
import * as chai from "chai";
import { resetUnittestAccount, CommonUnittestPrefix } from "./utils.js";
import User from "../User.js";
import dotenv from "dotenv";
dotenv.config();
const expect = chai.expect;
process.on("unhandledRejection", function (reason: any, p: any) {
  console.warn("Possibly Unhandled Rejection at: Promise ", p, " reason: ", reason);
});

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
const dataDir = "./src/__tests__/__data__";
describe("Graphs", function () {
  let app: App;
  let user: User;
  let testDs: Dataset;
  before(async function () {
    app = App.get({ token: process.env.UNITTEST_TOKEN_ACCOUNT });
    user = await app.getUser();
    await resetUnittestAccount(user);
    testDs = await getNewTestDs(user, "private");
    await testDs.importFromFiles([path.resolve(dataDir, "test102.nt")], { defaultGraphName: "https://somegraph.com" });
  });
  it("Should be able to fetch graph metadata", async function () {
    const graphs = await testDs.getGraphs().toArray();
    expect(graphs).to.have.lengthOf(1);
    const graphInfo = await graphs[0].getInfo();
    expect(graphInfo.graphName).to.equal("https://somegraph.com");
  });
  it("Should be able to fetch graph store", async function () {
    const graph = await testDs.getGraph("https://somegraph.com");
    const store = await graph.toStore();
    expect(store.size).to.equal(102);
  });
});
