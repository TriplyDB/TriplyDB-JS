import App from "../App.js";
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
        }).getInfo(),
      ).to.eventually.rejectedWith(
        "Failed to fetch API information of https://google.com. (Expected a JSON response, but got text/html",
      );
    });
    it("Should not break when the API url contains a trailing slash", async function () {
      return expect(
        (
          await App.get({
            url: "https://api.nightly.triplydb.com/",
          }).getInfo()
        ).apiUrl,
      ).to.equal("https://api.nightly.triplydb.com");
    });
    it("Should throw error on domain that doesnt exist", async function () {
      return expect(
        App.get({
          url: "https://googlsdfsdfsdfe.com",
        }).getInfo(),
      ).to.eventually.rejectedWith(
        "Failed to fetch API information of https://googlsdfsdfsdfe.com. (request to https://googlsdfsdfsdfe.com/info failed",
      );
    });
    it("Should extract api location from token", async function () {
      const app = App.get(process.env.UNITTEST_TOKEN_ACCOUNT);
      expect(app.url).not.be.undefined;
      expect(app.url).not.be.empty;
    });
    it("Should extract api location from token with empty string url", async function () {
      const app = App.get({ url: "", token: process.env.UNITTEST_TOKEN_ACCOUNT });
      expect(app.url).not.be.undefined;
      expect(app.url).not.be.empty;
    });
    it("Should throw on malformed jwt token", async function () {
      expect(() => App.get("InvalidToken")).to.throw("Invalid token");
    });
    it("Tokens which are invalid headers should throw", async function () {
      expect(() => App.get(`${process.env.UNITTEST_TOKEN_ACCOUNT}\n`)).to.throw("Illegal character in token");
      expect(() => App.get(`${process.env.UNITTEST_TOKEN_ACCOUNT}€`)).to.throw("Illegal character in token");
      expect(() => App.get(`${process.env.UNITTEST_TOKEN_ACCOUNT}🔵`)).to.throw("Illegal character in token");
      expect(() => App.get(`${process.env.UNITTEST_TOKEN_ACCOUNT} `)).to.not.throw("Illegal character in token");
      expect(() => App.get(`${process.env.UNITTEST_TOKEN_ACCOUNT}asd`)).to.not.throw("Illegal character in token");
    });
  });
  it("Should correctly compare versions", async function () {
    const app = App.get({ url: "https://api.collectiedata.hetnieuweinstituut.nl" });
    // old calver notation
    expect(await app.isCompatible("24.12.1-1")).to.equal(true);
    expect(await app.isCompatible("23.09.0")).to.equal(true);
    // new calver notation
    expect(await app.isCompatible("23.9.100")).to.equal(true);
    expect(await app.isCompatible("30.1.101")).to.equal(false);
  });
  it("Should postprocess URLs when needed", async function () {
    const app = App.get({ url: "http://something.com:5000/" });

    expect(
      app["getPostProcessedApiUrl"](
        "https://somethingelse.com/somepath/run.nt?somearg=https%3A%2F%2Fwww%2Frijksbegrotingsstructuur%2FBC6BA34-2018-27938&pageSize=5000",
      ),
    ).to.equal(
      "http://something.com:5000/somepath/run.nt?somearg=https%3A%2F%2Fwww%2Frijksbegrotingsstructuur%2FBC6BA34-2018-27938&pageSize=5000",
    );
  });
});
