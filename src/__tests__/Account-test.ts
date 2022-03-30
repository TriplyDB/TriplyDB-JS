import App from "../App";
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
        "Failed to fetch account Triply_. This account does not exist."
      );
    });
    it("Should throw error when default account without API token", async function () {
      const client = App.get();
      const account = await client.getAccount();
      return expect(account.getInfo()).to.eventually.rejectedWith(
        `Failed to fetch the current user, because no API token is configured. If you want to fetch the current user, you must create an API token on <https://triplydb.com/me/-/settings/tokens>.`
      );
    });
  });
});