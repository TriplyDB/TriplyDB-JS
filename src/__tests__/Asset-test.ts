import App from "../App";
import { Account } from "../Account";
import Dataset from "../Dataset";

import * as chai from "chai";
import { resetUnittestAccount, CommonUnittestPrefix } from "./utils";
import User from "../User";

import * as fs from "fs-extra";
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
const otherfile = `${__dirname}/Dataset-test.js`;
describe("Assets", function () {
  let app: App;
  let user: User;
  let testDs: Dataset;
  before(async function () {
    this.timeout(10000);
    app = App.get({
      url: process.env.UNITTEST_API_URL,
      token: process.env.UNITTEST_TOKEN_ACCOUNT,
    });
    user = await app.getUser();

    await resetUnittestAccount(user);
    testDs = await getNewTestDs(user, "private");
  });

  it("Adding an asset", async function () {
    const newAsset = await testDs.uploadAsset(__filename, this.test?.title);
    expect(newAsset.getInfo().fileSize).to.equal((await fs.stat(__filename)).size);
  });
  it("Adding an asset for which the name already exists", async function () {
    await testDs.uploadAsset(__filename, this.test?.title);
    return expect(testDs.uploadAsset(otherfile, this.test?.title)).eventually.rejectedWith(
      /but an asset with that name already exists/
    );
  });
  it("Removing an asset", async function () {
    const assetsBefore = await testDs.getAssets().toArray();
    const newAsset = await testDs.uploadAsset(__filename, this.test?.title);
    expect((await testDs.getAssets().toArray()).length).to.equal(assetsBefore.length + 1);
    await newAsset.delete();
    expect((await testDs.getAssets().toArray()).length).to.equal(assetsBefore.length);
  });
  it("Adding a version to an asset", async function () {
    const newAsset = await testDs.uploadAsset(__filename, this.test?.title);
    expect(newAsset.getInfo().versions.length).to.equal(1);
    await newAsset.addVersion(otherfile);
    expect(newAsset.getInfo().versions.length).to.equal(2);
  });
  it("Removing a version that doesnt exist", async function () {
    const newAsset = await testDs.uploadAsset(__filename, this.test?.title);
    await newAsset.addVersion(otherfile);
    await expect(newAsset.delete(10)).eventually.rejectedWith("This asset has no version 10");
  });
  it("Removing a version", async function () {
    const newAsset = await testDs.uploadAsset(__filename, this.test?.title);
    await newAsset.addVersion(otherfile);
    await newAsset.delete(0);
    expect(newAsset.getInfo().versions.length).to.equal(1);
  });
  it("Removing the last version", async function () {
    const newAsset = await testDs.uploadAsset(__filename, this.test?.title);
    await newAsset.delete(0);
    expect(() => newAsset.getInfo()).to.throw("This asset does not exist");
  });
});
