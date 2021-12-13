import App from "../App";
import User from "../User";

import * as chai from "chai";
import { Account } from "../Account";
import Dataset from "../Dataset";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;
import { resetUnittestAccount, CommonUnittestPrefix, buildPathToSrcPath } from "./utils";
import Service from "../Service";

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

describe("Services", function () {
  let app: App;
  let user: User;
  let testDs: Dataset;
  let service: Service;
  before(async function () {
    this.timeout(30000);
    app = App.get({ token: process.env.UNITTEST_TOKEN_ACCOUNT });
    user = await app.getUser();
    await resetUnittestAccount(user);
    testDs = await getNewTestDs(user, "private");
    await testDs.importFromFiles(buildPathToSrcPath(__dirname, "__data__", "small.nq"));
    service = await testDs.addService("virtuoso", "default");
  });
  after(async function () {
    await Promise.all(datasetsToClean.map((ds) => ds.delete()));
  });
  it("Be able to start a service", async function () {
    const serviceInfo = await service.getInfo(true);
    expect(serviceInfo.status).to.equal("running");
  });
  it("Be able to rename a service", async function () {
    if (service.isV1Service()) {
      return expect(service.rename("newName")).to.be.rejectedWith(
        "This TriplyDB API does not support renaming a service."
      );
    }
    await service.rename("newName");
    const serviceInfo = await service.getInfo(true);
    expect(serviceInfo.status).to.equal("running");
    expect(serviceInfo.name).to.equal("newName");
  });
  it("Should indicate when out of sync and be able to update", async function () {
    this.timeout(10000);
    expect(await service.isUpToDate()).to.equal(true);
    await testDs.importFromDataset({ fromDataset: testDs });
    expect(await service.isUpToDate()).to.equal(false);
    await service.update();
    expect(await service.isUpToDate()).to.equal(true);
  });
  it("Should be able to get graph info", async function () {
    const graphs = await service.getGraphs(true);
    if (service.isV1Service()) {
      expect(Object.keys(graphs).length).to.equal((await testDs.getGraphs().toArray()).length);
    } else {
      expect(graphs.length).to.equal((await testDs.getInfo(true)).graphCount);
    }
  });
});
