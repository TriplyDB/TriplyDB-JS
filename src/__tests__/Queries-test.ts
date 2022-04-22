import App from "../App";
import { Account } from "../Account";
import Dataset from "../Dataset";
import * as fs from "fs-extra";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;
import { resetUnittestAccount, CommonUnittestPrefix, buildPathToSrcPath } from "./utils";
import User from "../User";
import path from "path";
import * as n3 from "n3";
import Query from "../Query";
import { fileCache } from "../utils/cache";
import { TriplyDbJsError } from "../utils/Error";
import { gzip, gunzip } from "zlib";
import Service from "../Service";

process.on("unhandledRejection", function (reason: any, p: any) {
  console.warn("Possibly Unhandled Rejection at: Promise ", p, " reason: ", reason);
});
const tmpDir = buildPathToSrcPath(__dirname, "tmp");
const datasetsToClean: Dataset[] = [];
let testDsIndex = 0;
const getNewTestDs = async (account: Account, accessLevel: "public" | "private") => {
  const ds = await account.addDataset(
    // keep the name short to avoid hitting the 40-character limit
    `${CommonUnittestPrefix}-${testDsIndex++}`,
    { accessLevel: accessLevel }
  );
  datasetsToClean.push(ds);
  return ds;
};

describe("Queries", function () {
  let app: App;
  let user: User;
  let testDs: Dataset;
  let testService: Service;
  before(async function () {
    this.timeout(30000);
    app = App.get({ token: process.env.UNITTEST_TOKEN_ACCOUNT });
    user = await app.getUser();
    await resetUnittestAccount(user);
    testDs = await getNewTestDs(user, "private");
    await fs.mkdirp(tmpDir);
    await testDs.importFromFiles([buildPathToSrcPath(__dirname, "__data__", "small.nq")]);
    testService = await testDs.addService("testService", { type: "virtuoso" });
  });
  after(async function () {
    this.timeout(10000); // Resetting could take a while
    await resetUnittestAccount(user);
  });
  it("Should create, update, and delete query", async function () {
    const query = await user.addQuery(`${CommonUnittestPrefix}-test-query`, {
      accessLevel: "private",
      queryString: "select ?s?p?o where {?s?p?o}",
      output: "geo",
      dataset: testDs,
    });
    expect(await query.getInfo().then((q) => q.accessLevel)).to.equal("private");
    await query.update({ accessLevel: "internal" });
    expect(await query.getInfo().then((q) => q.accessLevel)).to.equal("internal");
  });
  it("Should create a query through a service", async function () {
    this.timeout(30000);
    expect((await testService.getInfo()).status).to.equal("running");
    const query = await user.addQuery(`${CommonUnittestPrefix}-test-query-service`, {
      accessLevel: "private",
      service: testService,
      queryString: "select ?s?p?o where {?s?p?o}",
    });
    const queryServiceEndpoint = (await query.getInfo()).service;
    const testServiceEndpoint = (await testService.getInfo()).endpoint;
    expect(queryServiceEndpoint).to.equal(testServiceEndpoint);
    expect(await query.getInfo().then((q) => q.accessLevel)).to.equal("private");
    await query.update({ accessLevel: "internal" });
    expect(await query.getInfo().then((q) => q.accessLevel)).to.equal("internal");
  });
  it("Should add a new version to an existing query", async function () {
    // Version 1
    const query = await user.addQuery(`${CommonUnittestPrefix}-new-version`, {
      accessLevel: "private",
      dataset: testDs,
      queryString: "select ?s?p?o where {?s?p?o}",
    });
    expect((await query.getInfo(true)).numberOfVersions).to.equal(1);
    // Version 2
    await query.addVersion({ output: "network", variables: [{ name: "version2", termType: "NamedNode" }] });
    expect((await query.getInfo(true)).numberOfVersions).to.equal(2);
    // Version 3
    await query.addVersion({ queryString: "select ?a?b?c where {?a?b?c}" });
    expect((await query.getInfo(true)).numberOfVersions).to.equal(3);
    // Version 4
    await query.addVersion({
      output: "markup",
      queryString: "select ?s?p?o where {?s?p?o}",
      variables: [{ name: "version4", termType: "NamedNode" }],
    });
    expect((await query.getInfo(true)).numberOfVersions).to.equal(4);

    // Check contents
    // Version 2 will have V1 queryString
    expect(await (await query.useVersion(2)).getString()).to.equal("SELECT ?s ?p ?o WHERE { ?s ?p ?o. }");
    // Version 3 will have V2 output & variables
    expect(await (await query.useVersion(3)).getString()).to.equal("SELECT ?a ?b ?c WHERE { ?a ?b ?c. }");
    const version3Variable = (await (await query.useVersion(3)).getInfo()).variables;
    expect(version3Variable?.map((v) => v.name))
      .to.be.an("array")
      .that.includes("version2");
    expect((await (await query.useVersion(3)).getInfo()).renderConfig?.output).to.equal("network");
    // Version 4 will be completely different
    expect(await (await query.useVersion(4)).getString()).to.equal("SELECT ?s ?p ?o WHERE { ?s ?p ?o. }");
    expect((await (await query.useVersion(4)).getInfo()).renderConfig?.output).to.equal("markup");
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
      await dataset.importFromFiles([dataFile]);
      await dataset.addService("sparql");
    });

    describe("Construct-queries", async function () {
      let constructQuery: Query;

      before(async function () {
        const constructQueryName = `${CommonUnittestPrefix}-construct`;
        await user
          .getQuery(constructQueryName)
          .then((q) => q.delete())
          .catch((e) => {
            if (e instanceof TriplyDbJsError && e.statusCode === 404) return;
            throw e;
          });
        constructQuery = await user.addQuery(constructQueryName, {
          accessLevel: "private",
          // a construct query that gives twice the number of statements as there are in the dataset
          queryString: "construct {?s?p?o. ?s ?p ?newo} where {?s?p?o. bind(concat(str(?o)) as ?newo)}",
          output: "table",
          variables: [{ name: "s", termType: "NamedNode" }],
          dataset,
        });
      });
      describe("Fetching query string", function () {
        it("Should return stringified query", async function () {
          const populatedString = await constructQuery.getString({ s: "http://blaaa" });
          expect(populatedString.trim()).to.equal(`CONSTRUCT {
  <http://blaaa> ?p ?o.
  <http://blaaa> ?p ?newo.
}
WHERE {
  <http://blaaa> ?p ?o.
  BIND(CONCAT(STR(?o)) AS ?newo)
}`);
        });
      });
      it("Should query a saved construct-query (quad iterator)", async function () {
        this.timeout(60000);
        const expectedStatements = await constructQuery.getInfo().then((info) => info.dataset!.statements * 2);
        expect(expectedStatements).to.equal(DATA_SIZE * 2);
        let count = 0;
        for await (const _ of constructQuery.results().statements()) {
          count++;
        }
        expect(count).to.equal(expectedStatements);
        const asArrayCount = await constructQuery
          .results()
          .statements()
          .toArray()
          .then((a) => a.length);
        expect(asArrayCount).to.equal(expectedStatements);
      });

      it("Should query a saved construct-query (to file)", async function () {
        this.timeout(30000);
        const targetFile = path.resolve(tmpDir, "query-test-results.nt");
        await constructQuery.results().statements().toFile(targetFile);
        const fileContent = await fs.readFile(targetFile, "utf-8");
        const parser = new n3.Parser();
        const quads = parser.parse(fileContent);
        expect(quads.length).to.equal(DATA_SIZE * 2);
      });

      it("Should support query variables in construct-queries", async function () {
        expect((await constructQuery.results({ s: "s:s1" }).statements().toArray()).length).to.equal(2);
      });

      it("Should not support bindings", async function () {
        expect(() => constructQuery.results().bindings()).to.throw();
      });
    });
    describe("Select-queries", async function () {
      let selectQuery: Query;
      before(async function () {
        const selectQueryName = `${CommonUnittestPrefix}-select`;
        await user
          .getQuery(selectQueryName)
          .then((q) => q.delete())
          .catch((e) => {
            if (e instanceof TriplyDbJsError && e.statusCode === 404) return;
            throw e;
          });
        selectQuery = await user.addQuery(selectQueryName, {
          accessLevel: "private",
          // a select query that gives same number of statements as there are in the dataset
          queryString: "select ?s?p?o where {?s?p?o}",
          output: "table",
          variables: [{ name: "s", termType: "NamedNode" }],
          dataset,
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
      it("Should cache page when needed", async function () {
        this.timeout(60000);

        await fs.remove(tmpDir);
        await fs.mkdir(tmpDir);

        const expectedStatements = await selectQuery.getInfo().then((info) => info.dataset?.statements);
        let count = 0;
        expect((await fs.readdir(tmpDir)).length).to.equal(0);
        const results = selectQuery.results({}, { cache: fileCache({ cacheDir: tmpDir, compression: "gz" }) });
        for await (const _ of results.bindings()) {
          count++;
        }
        expect((await fs.readdir(tmpDir)).length).to.not.equal(0);
        expect(expectedStatements).to.equal(count);
        const array = await selectQuery
          .results({}, { cache: fileCache({ cacheDir: tmpDir, compression: "gz" }) })
          .bindings()
          .toArray();
        expect(array).to.have.lengthOf(count);
        // break the cache file to make sure that it is being used
        for (let file of await fs.readdir(tmpDir)) {
          file = path.resolve(tmpDir, file);
          const data = await new Promise<any>(async (resolve, reject) =>
            gunzip(await fs.readFile(file), (error, result) => {
              if (error) return reject(error);
              resolve(JSON.parse(result.toString("utf-8")));
            })
          );
          data.responseText = "[]";
          await fs.writeFile(
            file,
            await new Promise<Buffer>((resolve, reject) =>
              gzip(JSON.stringify(data), (error, result) => {
                if (error) return reject(error);
                resolve(result);
              })
            )
          );
        }

        count = 0;
        for await (const _ of selectQuery
          .results({}, { cache: fileCache({ cacheDir: tmpDir, compression: "gz" }) })
          .bindings()) {
          count++;
        }
        expect(count).to.equal(0);
      });

      it.only("Should query a saved select-query (to file)", async function () {
        this.timeout(30000);
        const targetFile = path.resolve(tmpDir, "query-test-select-results.tsv");
        await selectQuery.results().bindings().toFile(targetFile);
        const fileContent = await fs.readFile(targetFile, "utf-8");
        const header = "?s\t?p\t?o\n"
        const split = fileContent.split(header);
        expect(split.length).to.equal(2)
        expect(fileContent.lastIndexOf(header)).to.equal(0)
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
    describe("Queries with an error", async function () {
      let tooLargeQuery: Query;
      before(async function () {
        const tooLargeQueryName = `${CommonUnittestPrefix}-too-large`;
        await user
          .getQuery(tooLargeQueryName)
          .then((q) => q.delete())
          .catch((e) => {
            if (e instanceof TriplyDbJsError && e.statusCode === 404) return;
            throw e;
          });
        tooLargeQuery = await user.addQuery(tooLargeQueryName, {
          queryString: "CONSTRUCT WHERE {?s?p?o} ORDER BY ?s LIMIT 10000 OFFSET 12000",
          accessLevel: "private",
          output: "table",
          dataset,
          variables: [{ name: "s", termType: "NamedNode" }],
        });
      });

      it("should report the problem for async iterator", async function () {
        try {
          for await (const _ of tooLargeQuery.results().statements()) {
          }
          throw new Error("This query shouldn't have finished returning results");
        } catch (e) {
          expect(e).to.be.instanceof(TriplyDbJsError);
          const ee = e as TriplyDbJsError;
          expect(ee.message).to.match(/Sorted TOP clause specifies more then \d+ rows to sort./);
          return;
        }
      });
      it("should report the problem for toFile", async function () {
        const tempfile = "./test-output.nt";
        try {
          await tooLargeQuery.results().statements().toFile(tempfile);
        } catch (e) {
          expect(e).to.be.instanceof(TriplyDbJsError);
          const ee = e as TriplyDbJsError;
          expect(ee.message).to.match(/Sorted TOP clause specifies more then \d+ rows to sort./);
          return;
        } finally {
          if (await fs.pathExists(tempfile)) {
            await fs.remove(tempfile);
          }
        }
        throw new Error("Expected an error to be thrown");
      });
    });
    it("Should use a cache fingerprint that's robust against renaming/replacing queries", async function () {
      await fs.emptyDir(tmpDir); //make sure we use a clean cache
      const queryName = `${CommonUnittestPrefix}-cache-test`;
      const query1 = await user.addQuery(queryName, {
        queryString: `select ("1" as ?a) where {}`,
        accessLevel: "private",
        output: "table",
        dataset,
      });

      const firstResults = await query1
        .results({}, { cache: fileCache({ cacheDir: tmpDir, compression: "gz" }) })
        .bindings()
        .toArray();
      expect(firstResults).to.deep.equal([{ a: "1" }]);
      await query1.delete();
      const query2 = await user.addQuery(queryName, {
        queryString: `select ("2" as ?a) where {}`,
        accessLevel: "private",
        output: "table",
        dataset,
      });
      const secondResults = await query2
        .results({}, { cache: fileCache({ cacheDir: tmpDir, compression: "gz" }) })
        .bindings()
        .toArray();
      // Sure, the query has the same name, but it's a different query (and query string)
      // I.e., the we should not re-use the cache of query1
      expect(secondResults).to.deep.equal([{ a: "2" }]);
    });
  });
});
