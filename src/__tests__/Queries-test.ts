import App from "../App";
import { Account } from "../Account";
import Dataset from "../Dataset";
import * as fs from "fs-extra";
import * as chai from "chai";
import { resetUnittestAccount, CommonUnittestPrefix, buildPathToSrcPath } from "./utils";
import User from "../User";
import path from "path";
import * as n3 from "n3";
import Query from "../Query";
const expect = chai.expect;
process.on("unhandledRejection", function (reason: any, p: any) {
  console.warn("Possibly Unhandled Rejection at: Promise ", p, " reason: ", reason);
});
const tmpDir = buildPathToSrcPath(__dirname, "tmp");
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

describe("Queries", function () {
  let app: App;
  let user: User;
  let testDs: Dataset;
  before(async function () {
    this.timeout(10000);
    app = App.get({ token: process.env.UNITTEST_TOKEN_ACCOUNT });
    user = await app.getUser();
    await resetUnittestAccount(user);
    testDs = await getNewTestDs(user, "private");
    await fs.mkdirp(tmpDir);
  });
  it("Should create, update, and delete query", async function () {
    const query = await user.addQuery({
      name: "test-query",
      accessLevel: "private",
      dataset: await testDs.getInfo().then((i) => i.id),
    });
    expect(await query.getInfo().then((q) => q.accessLevel)).to.equal("private");
    await query.update({ accessLevel: "internal" });
    expect(await query.getInfo().then((q) => q.accessLevel)).to.equal("internal");
    await query.delete();
  });

  // these tests are slow (~2 min combined)
  describe("Query results", function () {
    const DATA_SIZE = 10100; // enough for >1 page
    let dataset: Dataset;
    before(async function () {
      this.timeout(120000);
      dataset = await getNewTestDs(user, "private");
      const dataFile = path.resolve(tmpDir, "query-test-source.ttl");
      await fs.writeFile(
        dataFile,
        [...Array(DATA_SIZE).keys()].map((i) => `<s:s${i}> <p:p${i}> <o:o${i}>.`).join("\n")
      );
      await dataset.importFromFiles(dataFile);
      await dataset.addService("sparql", "sparql");
    });

    describe("Construct-queries", async function () {
      let constructQuery: Query;

      before(async function () {
        const constructQueryName = `${CommonUnittestPrefix}-construct`;
        await user
          .getQuery(constructQueryName)
          .then((q) => q.delete())
          .catch((e) => {
            if (e.status === 404) return;
            throw e;
          });
        constructQuery = await user.addQuery({
          name: constructQueryName,
          accessLevel: "private",
          // a construct query that gives same number of statements as there are in the dataset
          requestConfig: { payload: { query: "construct {?s?p?o} where {?s?p?o}" } },
          renderConfig: { output: "?" },
          variables: [{ name: "s", termType: "NamedNode" }],
          dataset: await dataset.getInfo().then((d) => d.id),
        });
      });
      it("Should query a saved construct-query (quad iterator)", async function () {
        this.timeout(60000);
        const expectedStatements = await constructQuery.getInfo().then((info) => info.dataset?.statements);
        let count = 0;
        for await (const _ of constructQuery.results().statements()) {
          count++;
        }
        expect(expectedStatements).to.equal(count);
        const asArrayCount = await constructQuery
          .results()
          .statements()
          .toArray()
          .then((a) => a.length);
        expect(count).to.equal(asArrayCount);
      });

      it("Should query a saved construct-query (to file)", async function () {
        this.timeout(30000);
        const targetFile = path.resolve(tmpDir, "query-test-results.ttl");
        await constructQuery.results().statements().toFile(targetFile);
        const fileContent = await fs.readFile(targetFile, "utf-8");
        const parser = new n3.Parser();
        const quads = parser.parse(fileContent);
        expect(quads.length).to.equal(await constructQuery.getInfo().then((info) => info.dataset?.statements));
      });

      it("Should support query variables in construct-queries", async function () {
        expect((await constructQuery.results({ s: "s:s1" }).statements().toArray()).length).to.equal(1);
      });

      it("Should not support bindings", async function () {
        expect(() => constructQuery.results().bindings()).to.throw();
      });
    });
    describe("Select-queries", async function () {
      let selectQuery: Query;
      before(async function () {
        const selectQueryName = `${CommonUnittestPrefix}-construct`;
        await user
          .getQuery(selectQueryName)
          .then((q) => q.delete())
          .catch((e) => {
            if (e.status === 404) return;
            throw e;
          });
        selectQuery = await user.addQuery({
          name: selectQueryName,
          accessLevel: "private",
          // a select query that gives same number of statements as there are in the dataset
          requestConfig: { payload: { query: "select ?s?p?o where {?s?p?o}" } },
          renderConfig: { output: "?" },
          variables: [{ name: "s", termType: "NamedNode" }],
          dataset: await dataset.getInfo().then((d) => d.id),
        });
      });

      it("Should query a saved select-query (statements iterator)", async function () {
        this.timeout(60000);
        const expectedStatements = await selectQuery.getInfo().then((info) => info.dataset?.statements);
        let count = 0;
        for await (const _ of selectQuery.results().bindings()) {
          count++;
        }
        expect(expectedStatements).to.equal(count);
        const asArrayCount = await selectQuery
          .results()
          .bindings()
          .toArray()
          .then((a) => a.length);
        expect(count).to.equal(asArrayCount);
      });

      it("Should support query variables in select-queries", async function () {
        const results = await selectQuery.results({ s: "s:s1" }).bindings().toArray();
        expect(results.length).to.equal(1);
        expect(results[0]["p"]).to.not.be.undefined;
      });

      it("Should not support statements", async function () {
        expect(() => selectQuery.results().statements()).to.throw();
      });
    });
  });
});
