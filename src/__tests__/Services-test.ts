import App from "../App.js";
import User from "../User.js";

import * as chai from "chai";
import { Account } from "../Account.js";
import Dataset from "../Dataset.js";
import chaiAsPromised from "chai-as-promised";
import dotenv from "dotenv";
dotenv.config();
chai.use(chaiAsPromised);
const expect = chai.expect;
import { resetUnittestAccount, CommonUnittestPrefix } from "./utils.js";
import Service from "../Service.js";

process.on("unhandledRejection", function (reason: any, p: any) {
  console.warn("Possibly Unhandled Rejection at: Promise ", p, " reason: ", reason);
});

const datasetsToClean: Dataset[] = [];
let testDsIndex = 0;
const getNewTestDs = async (account: Account, accessLevel: "public" | "private") => {
  const ds = await account.addDataset(
    // keep the name short to avoid hitting the 40-character limit
    `${CommonUnittestPrefix}-${testDsIndex++}`,
    { accessLevel: accessLevel },
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
    app = App.get({ token: process.env.UNITTEST_TOKEN_ACCOUNT });
    user = await app.getUser();
    await resetUnittestAccount(user);
    testDs = await getNewTestDs(user, "private");
    await testDs.importFromFiles(["./src/__tests__/__data__/small.nq"]);
  });
  after(async function () {
    await Promise.all(datasetsToClean.map((ds) => ds.delete()));
  });

  describe("Basic functionality", function () {
    before(async function () {
      service = await testDs.addService("default", { type: "virtuoso" });
    });
    after(async function () {
      await service.delete();
    });
    it("Be able to start a service", async function () {
      const serviceInfo = await service.getInfo(true);
      expect(serviceInfo.status).to.equal("running");
    });
    it("Be able to rename a service", async function () {
      await service.rename("newName");
      const serviceInfo = await service.getInfo(true);
      expect(serviceInfo.status).to.equal("running");
      expect(serviceInfo.name).to.equal("newName");
    });
    it("Should indicate when out of sync and be able to update", async function () {
      expect(await service.isUpToDate()).to.equal(true);
      await testDs.importFromDataset(testDs);
      expect(await service.isUpToDate()).to.equal(false);
      await service.update();
      expect(await service.isUpToDate()).to.equal(true);
    });
    it("Should be able to get graph info", async function () {
      const graphs = await service.getGraphs(true);
      expect(graphs.length).to.equal((await testDs.getInfo(true)).graphCount);
    });
  });
  describe("Ensuring a service", function () {
    before(async function () {
      service = await testDs.addService("default", { type: "virtuoso" });
    });
    it("Should create when not already existing", async function () {
      const ensuredService = await testDs.ensureService(`${CommonUnittestPrefix}-ensured`, { type: "jena" });
      expect((await ensuredService?.getInfo()).name).to.equal(`${CommonUnittestPrefix}-ensured`);
      expect((await ensuredService?.getInfo()).type).to.equal("jena");
      await ensuredService?.delete();
    });
    it("Should get existing when already existing", async function () {
      const ensuredService = await testDs.ensureService("default");
      expect((await ensuredService?.getInfo()).name).to.equal("default");
      expect((await ensuredService?.getInfo()).type).to.equal("virtuoso");
      await ensuredService?.delete();
    });
  });
  describe("Update a service without downtime", async function () {
    before(async function () {
      await testDs.ensureService(`${CommonUnittestPrefix}-ensured`, { type: "jena" });
      await testDs.importFromFiles(["./src/__tests__/__data__/anotherSmall.nq"]);
    });
    it("Should create when not already existing", async function () {
      const ensuredService = await testDs.ensureService(`${CommonUnittestPrefix}-ensured`, { type: "jena" });
      await ensuredService.updateWithNoDownTime();
      let serviceList: Service[] = [];
      for await (const s of testDs.getServices()) serviceList.push(s);
      expect(serviceList).to.have.length(1);
      expect((await serviceList[0].getInfo()).name).to.equal(`${CommonUnittestPrefix}-ensured`);
      expect((await serviceList[0].getInfo()).type).to.equal("jena");
    });
  });
});
