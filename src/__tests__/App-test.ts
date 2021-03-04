import App from "../App";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;
process.on("unhandledRejection", function (reason: any, p: any) {
  console.warn("Possibly Unhandled Rejection at: Promise ", p, " reason: ", reason);
});

describe("App", function () {
  describe("Initialization", function () {
    it("Should throw error on URL that isnt an API", async function () {
      return expect(
        App.get({
          url: "https://google.com",
        }).getApiInfo()
      ).to.eventually.rejectedWith(
        "Failed to fetch API information of https://google.com. (Expected a JSON response, but got text/html"
      );
    });
    it("Should throw error on domain that doesnt exist", async function () {
      return expect(
        App.get({
          url: "https://googlsdfsdfsdfe.com",
        }).getApiInfo()
      ).to.eventually.rejectedWith(
        "Failed to fetch API information of https://googlsdfsdfsdfe.com. (request to https://googlsdfsdfsdfe.com/info failed"
      );
    });
    it("Should extract api location from token", async function () {
      const app = App.get(process.env.UNITTEST_TOKEN_ACCOUNT);
      expect(app["_config"].url).not.be.undefined;
    });
    it("Should throw on malformed jwt token", async function () {
      expect(() => App.get("InvalidToken")).to.throw("Invalid token");
    });
  });
  it("Should correctly compare versions", async function () {
    const app = App.get({ url: "https://api.triplydb.com" });
    expect(await app.isCompatible("1.1.1")).to.equal(true);
    expect(await app.isCompatible("1.1.1-9")).to.equal(true);
    expect(await app.isCompatible("9.9.9")).to.equal(false);
    expect(await app.isCompatible("9.9.9-9")).to.equal(false);
  });
});
