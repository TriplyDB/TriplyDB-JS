import App from "../App.js";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;
process.on("unhandledRejection", function (reason: any, p: any) {
  console.warn("Possibly Unhandled Rejection at: Promise ", p, " reason: ", reason);
});

describe("Account", function () {
  describe("Initialization", function () {
    it("Should throw error when account does not exist", async function () {
      //when getting an account with a name, app makes a request from the server side, however, when the accountName is not given, no request to the server side is make, so we need to call getInfo function so that a request to the server side can be made.
      return expect(App.get().getAccount("Triply_")).to.eventually.rejectedWith(
        "Failed to get account information of Triply_. (It does not exist)",
      );
    });
    it("Should throw error when default account without API token", async function () {
      const client = App.get();
      return expect(client.getAccount()).to.eventually.rejectedWith(
        `Failed to fetch the current user, because no API token is configured. If you want to fetch the current user, you must create an API token on <https://triplydb.com/me/-/settings/tokens>.`,
      );
    });
  });
});
