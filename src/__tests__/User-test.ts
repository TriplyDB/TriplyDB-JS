import App from "../App";
import * as chai from "chai";
import { CommonUnittestPrefix } from "./utils";
import User from "../User";
import { times, random } from "lodash";
const expect = chai.expect;
process.on("unhandledRejection", function (reason: any, p: any) {
  console.warn("Possibly Unhandled Rejection at: Promise ", p, " reason: ", reason);
});
describe("User", function () {
  let app: App;
  let user: User;
  before(async function () {
    app = App.get({
      url: process.env.UNITTEST_API_URL,
      token: process.env.UNITTEST_TOKEN_ACCOUNT,
    });
    user = await app.getUser();
    await user.getInfo();
  });
  it("get all users", async function () {
    // Expect that there is at least one user on the instance that they're testing.
    const accounts = await app.getAccounts().toArray();
    expect(accounts).to.have.length.greaterThan(0);
    expect(accounts.map((x) => (x as User)["_name"])).to.contain((await user.getInfo()).accountName);
  });
  it("rename account", async function () {
    const originalName = (await user.getInfo()).accountName;
    const newName = CommonUnittestPrefix + times(20, () => random(35).toString(36)).join("");
    await user.update({ accountName: newName });
    expect((await user.getInfo()).accountName).to.equal(newName);
    await user.update({ accountName: originalName });
    expect((await user.getInfo()).accountName).to.equal(originalName);
  });
  it("ensure that we get an error when the user doesn't exist", async function () {
    await expect(app.getAccount("maocpwnuzrls")).to.eventually.be.rejectedWith(/404: Account/);
  });
});
