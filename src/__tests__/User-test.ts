import App from "../App";
import * as chai from "chai";
import { CommonUnittestPrefix } from "./utils";
import User from "../User";
import { times, random } from "lodash";
const expect = chai.expect;
process.on("unhandledRejection", function (reason: any, p: any) {
  console.warn("Possibly Unhandled Rejection at: Promise ", p, " reason: ", reason);
});
//Skipped. These are tests that are difficult to isolate and run on production
describe.skip("User", function () {
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
  it("rename account", async function () {
    const originalName = (await user.getInfo()).accountName;
    const newName = CommonUnittestPrefix + times(20, () => random(35).toString(36)).join("");
    await user.update({ accountName: newName });
    expect((await user.getInfo()).accountName).to.equal(newName);
    await user.update({ accountName: originalName as string });
    expect((await user.getInfo()).accountName).to.equal(originalName);
  });
});
