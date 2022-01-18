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
  let service2: Service;
  this.timeout(50000);
  before(async function () {
    app = App.get({ token: process.env.UNITTEST_TOKEN_ACCOUNT });
    user = await app.getUser();
    await resetUnittestAccount(user);
    testDs = await getNewTestDs(user, "private");
    await testDs.importFromFiles([buildPathToSrcPath(__dirname, "__data__", "small.nq")]);
    service = await testDs.addService("default", { type: "virtuoso" });
    service2 = await testDs.addService("serviceV1");
  });
  after(async function () {
    await Promise.all(datasetsToClean.map((ds) => ds.delete()));
  });
  it("Be able to start a service", async function () {
    const serviceInfo = await service.getInfo(true);
    expect(serviceInfo.status).to.equal("running");
  });
  it("Be able to stop a service", async function () {
    await service.stop();
    const serviceInfo = await service.getInfo(true);
    expect(serviceInfo.status).to.equal("stopped");
  });
  it("Be able to resume a service", async function () {
    let serviceInfo = await service.getInfo(true);
    expect(serviceInfo.status).to.equal("stopped");
    await service.start();
    await service.waitUntilRunning();
    serviceInfo = await service.getInfo(true);
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
    await testDs.importFromDataset(testDs);
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
  it("Creating a service of type V1 returns a service of type V2", async function () {
    const serviceInfo = await service2.getInfo(true);
    if (service2.isV1Service()) {
      expect(serviceInfo.status).to.equal("running");
      expect(serviceInfo.type).to.equal("sparql");
    } else {
      expect(serviceInfo.status).to.equal("running");
      expect(serviceInfo.type).to.equal("virtuoso");
    }
  });
  describe("Ensuring a service", function () {
    it("Should create when not already existing", async function () {
      const ensuredService = await testDs.ensureService(`${CommonUnittestPrefix}-ensured`, { type: "jena" });
      expect((await ensuredService?.getInfo()).name).to.equal(`${CommonUnittestPrefix}-ensured`);
      if (ensuredService.isV1Service()) expect((await ensuredService?.getInfo()).type).to.equal("sparql-jena");
      else expect((await ensuredService?.getInfo()).type).to.equal("jena");
    });
    it("Should get existing when already existing", async function () {
      const ensuredService = await testDs.ensureService("default");
      expect((await ensuredService?.getInfo()).name).to.equal("default");
      if (ensuredService.isV1Service()) expect((await ensuredService?.getInfo()).type).to.equal("sparql");
      else expect((await ensuredService?.getInfo()).type).to.equal("virtuoso");
    });
  });
});
