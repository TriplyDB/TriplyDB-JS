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
        }).getInfo()
      ).to.eventually.rejectedWith(
        "Failed to fetch API information of https://google.com. (Expected a JSON response, but got text/html"
      );
    });
    it("Should throw error on domain that doesnt exist", async function () {
      return expect(
        App.get({
          url: "https://googlsdfsdfsdfe.com",
        }).getInfo()
      ).to.eventually.rejectedWith(
        "Failed to fetch API information of https://googlsdfsdfsdfe.com. (request to https://googlsdfsdfsdfe.com/info failed"
      );
    });
    it("Should extract api location from token", async function () {
      const app = App.get(process.env.UNITTEST_TOKEN_ACCOUNT);
      expect(app["_config"].url).not.be.undefined;
      expect(app["_config"].url).not.be.empty;
    });
    it("Should extract api location from token with empty string url", async function () {
      const app = App.get({ url: "", token: process.env.UNITTEST_TOKEN_ACCOUNT });
      expect(app["_config"].url).not.be.undefined;
      expect(app["_config"].url).not.be.empty;
    });
    it("Should throw on malformed jwt token", async function () {
      expect(() => App.get("InvalidToken")).to.throw("Invalid token");
    });
  });
  it("Should correctly compare versions", async function () {
    const app = App.get({ url: "https://api.triplydb.com" });
    expect(await app.isCompatible("1.1.1")).to.equal(true);
    expect(await app.isCompatible("1.1.1-9")).to.equal(true);
    expect(await app.isCompatible("9.9.9")).to.equal(true);
    expect(await app.isCompatible("9.9.9-9")).to.equal(true);
  });
  it("Should postprocess URLs when needed", async function () {
    const app = App.get({ url: "http://something.com:5000/" });

    expect(
      app["getPostProcessedApiUrl"](
        "https://somethingelse.com/somepath/run.nt?somearg=https%3A%2F%2Fwww%2Frijksbegrotingsstructuur%2FBC6BA34-2018-27938&pageSize=5000"
      )
    ).to.equal(
      "http://something.com:5000/somepath/run.nt?somearg=https%3A%2F%2Fwww%2Frijksbegrotingsstructuur%2FBC6BA34-2018-27938&pageSize=5000"
    );
  });
});
