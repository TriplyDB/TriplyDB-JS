import App from "../App.js";
import { Account } from "../Account.js";
import Dataset from "../Dataset.js";
import fs from "fs-extra";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;
import { resetUnittestAccount, CommonUnittestPrefix } from "./utils.js";
import User from "../User.js";
import path from "path";
import * as n3 from "n3";
import Query from "../Query.js";
import { fileCache } from "../utils/cache.js";
import { TriplyDbJsError } from "../utils/Error.js";
import { gzip, gunzip } from "zlib";
import Service from "../Service.js";
import dedent from "dedent";


import { Models } from "@triply/utils";


process.on("unhandledRejection", function (reason: any, p: any) {
  console.warn("Possibly Unhandled Rejection at: Promise ", p, " reason: ", reason);
});
const tmpDir = "./src/__tests__/tmp";
let testDsIndex = 0;
const getNewTestDs = async (account: Account, accessLevel: "public" | "private") => {
  const ds = await account.addDataset(
    // keep the name short to avoid hitting the 40-character limit
    `${CommonUnittestPrefix}-${testDsIndex++}`,
    { accessLevel: accessLevel },
  );
  return ds;
};

describe("Queries", function () {
  let app: App;
  let user: User;
  let testDs: Dataset;
  let testService: Service;
  before(async function () {
    app = App.get({ token: process.env.UNITTEST_TOKEN_ACCOUNT });
    user = await app.getUser();
    await resetUnittestAccount(user);
    testDs = await getNewTestDs(user, "private");
    await fs.mkdirp(tmpDir);
    await testDs.importFromFiles(["./src/__tests__/__data__/small.nq"]);
    testService = await testDs.addService("testService", { type: "virtuoso" });
  });
  after(async function () {
    await resetUnittestAccount(user);
  });
  it("Should create, update, and delete query", async function () {
    const query = await user.addQuery(`${CommonUnittestPrefix}-test-query`, {
      accessLevel: "private",
      queryString: "select ?s?p?o where {?s?p?o}",
      output: "Geo",
      dataset: testDs,
      serviceType: "speedy",
    });
    expect(await query.getInfo().then((q) => q.accessLevel)).to.equal("private");
    await query.update({ accessLevel: "internal" });
    expect(await query.getInfo().then((q) => q.accessLevel)).to.equal("internal");
  });
  it("Should create a query with all possible 'addQuery' options", async () => {
    const accessLevel = "internal";
    const queryString = "select ?s?p?o where {?s?p?o}";
    const output = "Response";
    const description = "description";
    const displayName = "displayName";
    const query = await user.addQuery(`${CommonUnittestPrefix}-test-query-properties`, {
      accessLevel,
      queryString,
      output,
      dataset: testDs,
      description,
      displayName,
      serviceType: "speedy",
      variables: [{ name: "s", termType: "Literal", language: "nl" }],
    });
    const queryInfo = await query.getInfo();
    expect(queryInfo.accessLevel).to.equal(accessLevel);
    expect(queryInfo.requestConfig?.payload.query).to.equal(queryString);
    expect(queryInfo.renderConfig?.output).to.equal(output);
    expect(queryInfo.dataset?.id).to.equal((await testDs.getInfo()).id);
    expect(queryInfo.description).to.equal(description);
    expect(queryInfo.displayName).to.equal(displayName);
    expect(queryInfo.variables && queryInfo.variables[0].name).to.equal("s");
  });
  it("Should create a query through a service", async function () {
    expect((await testService.getInfo()).status).to.equal("running");
    const query = await user.addQuery(`${CommonUnittestPrefix}-test-query-service`, {
      accessLevel: "private",
      dataset: testDs,
      queryString: "select ?s?p?o where {?s?p?o}",
      serviceType: "virtuoso",
    });
    // should automatically use virtuoso instead of speedy
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
      serviceType: "virtuoso",
    });
    expect((await query.getInfo(true)).numberOfVersions).to.equal(1);
    // Version 2
    await query.addVersion({ output: "Network", variables: [{ name: "version2", termType: "NamedNode" }] });
    expect((await query.getInfo(true)).numberOfVersions).to.equal(2);
    // Version 3
    await query.addVersion({ queryString: "select ?a?b?c where {?a?b?c}" });
    expect((await query.getInfo(true)).numberOfVersions).to.equal(3);
    // Version 4
    await query.addVersion({
      output: "Gallery",
      queryString: "select ?s?p?o where {?s?p?o}",
      variables: [{ name: "version4", termType: "NamedNode" }],
    });
    expect((await query.getInfo(true)).numberOfVersions).to.equal(4);
    // Version 5 (Ld frame)
    const frame = {
      "@context": {
        objectProperty: "https://trip.ly/p",
      },
      objectProperty: {},
    };
    await query.addVersion({
      queryString: "select ?s?p?o where {?s?p?o}",
      variables: [{ name: "version5", termType: "NamedNode" }],
      ldFrame: frame,
    });
    expect((await query.getInfo(true)).numberOfVersions).to.equal(5);

    // Check contents
    // Version 2 will have V1 queryString

    const queryVersion2String = await (await query.useVersion(2)).getString();

    expect(queryVersion2String).to.equal(dedent`
      select ?s ?p ?o where {
        ?s ?p ?o.
      }`);
    // Version 3 will have V2 output & variables
    const queryVersion3 = await query.useVersion(3);
    const queryVersion3Info = await queryVersion3.getInfo();
    expect(await queryVersion3.getString()).to.equal(dedent`select ?a ?b ?c where {
        ?a ?b ?c.
      }`);
    const version3Variable = queryVersion3Info.variables;
    expect(version3Variable?.map((v) => v.name))
      .to.be.an("array")
      .that.includes("version2");
    expect(queryVersion3Info.renderConfig?.output).to.equal("Network");
    // Version 4 will be completely different

    const queryVersion4 = await query.useVersion(4);
    const queryVersion4String = await queryVersion4.getString();
    expect(queryVersion4String).to.equal(dedent`
      select ?s ?p ?o where {
        ?s ?p ?o.
      }`);
    expect((await queryVersion4.getInfo()).renderConfig?.output).to.equal("Gallery");

    //Version 5 will be a ldFrame with no render config
    const queryVersion5 = await query.useVersion(5);
    const queryVersion5String = await queryVersion5.getString();
    expect(queryVersion5String).to.equal(dedent`
      select ?s ?p ?o where {
        ?s ?p ?o.
      }`);
    const queryVersion5Info = await queryVersion5.getInfo();
    expect(queryVersion5Info.renderConfig?.output).to.equal(undefined);
    expect(JSON.stringify(queryVersion5Info.requestConfig?.ldFrame)).to.equal(JSON.stringify(frame));
  });

  describe("Duplicate Queries", async function () {
    let query: Query;
    let queryInfo: Models.Query;
    before(async function () {
      query = await user.addQuery(`${CommonUnittestPrefix}-to-duplicate`, {
        accessLevel: "private",
        dataset: testDs,
        queryString: "select ?s?p?o where {?s?p?o}",
        serviceType: "virtuoso",
        description: "testDescription",
        displayName: "testDisplayName",
      });

      await query.addVersion({ output: "Network", variables: [{ name: "version2", termType: "NamedNode" }] });
      await query.addVersion({ output: "Gallery", variables: [{ name: "version3", termType: "NamedNode" }] });
      queryInfo = await query.getInfo(true);
    });

    it("Duplicate Query (latest version) with no non-mandatory metadata added", async function () {
      const duplicateQueryName = `${CommonUnittestPrefix}-duplicate-1`;
      const duplicateQuery = await query.copy(duplicateQueryName);
      const duplicateQueryInfo = await duplicateQuery.getInfo();
      expect(duplicateQueryInfo.name).equal(duplicateQueryName);
      expect(duplicateQueryInfo.displayName).equal(queryInfo.displayName);
      expect(duplicateQueryInfo.description).equal(queryInfo.description);
      expect(duplicateQueryInfo.accessLevel).equal(queryInfo.accessLevel);
      expect(duplicateQueryInfo.dataset?.id).equal(queryInfo.dataset?.id);
      expect(JSON.stringify(duplicateQueryInfo.serviceConfig)).equal(JSON.stringify(queryInfo.serviceConfig));
      expect(JSON.stringify(duplicateQueryInfo.requestConfig)).equal(JSON.stringify(queryInfo.requestConfig));
      expect(duplicateQueryInfo.renderConfig?.output).equal("Gallery");
      expect(JSON.stringify(duplicateQueryInfo.variables)).equal(
        JSON.stringify([{ name: "version3", termType: "NamedNode", required: false, allowedValues: [] }]),
      );
    });

    it("Duplicate Query (specific version) with non-mandatory metadata added", async function () {
      const duplicateQueryName = `${CommonUnittestPrefix}-duplicate-2`;
      const duplicateQuery = await (
        await query.useVersion(2)
      ).copy(duplicateQueryName, undefined, {
        displayName: "testDuplicateDisplayName",
        description: "testDuplicateDescription",
        accessLevel: "public",
        dataset: testDs,
      });
      const duplicateQueryInfo = await duplicateQuery.getInfo();
      expect(duplicateQueryInfo.name).equal(duplicateQueryName);
      expect(duplicateQueryInfo.displayName).equal("testDuplicateDisplayName");
      expect(duplicateQueryInfo.description).equal("testDuplicateDescription");
      expect(duplicateQueryInfo.accessLevel).equal("public");
      expect(duplicateQueryInfo.dataset?.id).equal(queryInfo.dataset?.id);
      expect(JSON.stringify(duplicateQueryInfo.serviceConfig)).equal(JSON.stringify(queryInfo.serviceConfig));
      expect(JSON.stringify(queryInfo.requestConfig)).equal(JSON.stringify(duplicateQueryInfo.requestConfig));
      expect(duplicateQueryInfo.renderConfig?.output).equal("Network");
      expect(JSON.stringify(duplicateQueryInfo.variables)).equal(
        JSON.stringify([{ name: "version2", termType: "NamedNode", required: false, allowedValues: [] }]),
      );
    });
    it("Allows for updateing the query visualization config", async function () {
      const duplicateQueryName = `${CommonUnittestPrefix}-duplicate-3`;
      const duplicateQuery = await (
        await query.useVersion(2)
      ).copy(duplicateQueryName, undefined, {
        output: "Geo",
        updateRenderConfig(renderConfig) {
          return { ...renderConfig, defaultBearing: 90, perspective: "Tilted" };
        },
      });
      const firstQueryInfo = await duplicateQuery.getInfo();
      expect(firstQueryInfo.renderConfig?.settings.defaultBearing).to.equal(90);
      expect(firstQueryInfo.renderConfig?.settings.perspective).to.equal("Tilted");
      const secondDuplicate = `${CommonUnittestPrefix}-duplicate-4`;
      const secondDuplicateQuery = await duplicateQuery.copy(secondDuplicate, undefined, {
        output: "Geo",
        updateRenderConfig(renderConfig) {
          return { ...renderConfig, defaultBearing: 180 };
        },
      });
      const secondQueryInfo = await secondDuplicateQuery.getInfo();
      expect(secondQueryInfo.renderConfig?.settings.defaultBearing).to.equal(180);
      expect(secondQueryInfo.renderConfig?.settings.perspective).to.equal("Tilted");
    });
  });

  // these tests are slow (~2 min combined)
  describe("Query results", function () {
    const DATA_SIZE = 10100; // enough for >1 page
    let dataset: Dataset;
    before(async function () {
      dataset = await getNewTestDs(user, "private");
      const dataFile = path.resolve(tmpDir, "query-test-source.ttl");
      await fs.writeFile(
        dataFile,
        [...Array(DATA_SIZE).keys()].map((i) => `<s:s${i}> <p:p${i}> <o:o${i}>.`).join("\n"),
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
          queryString: "construct {?s?p?o. ?s ?p ?newo} where {?s?p?o. bind(concat(str(?o), str(?o)) as ?newo)}",
          output: "Table",
          variables: [{ name: "s", termType: "NamedNode" }],
          dataset,
          serviceType: "speedy",
        });
      });
      describe("Fetching query string", function () {
        it("Should return stringified query", async function () {
          const populatedString = await constructQuery.getString({ s: "http://blaaa" });
          expect(populatedString).to.equal(dedent`construct {
            <http://blaaa> ?p ?o .
            <http://blaaa> ?p ?newo .}
            where {
            <http://blaaa> ?p ?o.
            bind(concat ( str ( ?o ), str ( ?o ) ) as ?newo)}`);
        });
      });
      it("Should query a saved construct-query (quad iterator)", async function () {
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
          output: "Table",
          variables: [{ name: "s", termType: "NamedNode" }],
          dataset,
          serviceType: "speedy",
        });
      });

      it("Should query a saved select-query (statements iterator)", async function () {
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
            }),
          );
          data.responseText = "[]";
          await fs.writeFile(
            file,
            (await new Promise<Buffer>((resolve, reject) =>
              gzip(JSON.stringify(data), (error, result) => {
                if (error) return reject(error);
                resolve(result);
              }),
            )) as any, // Casting goes wrong here.
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

      it("Should query a saved select-query (to file)", async function () {
        const targetFile = path.resolve(tmpDir, "query-test-select-target.tsv");
        const mockFile = "./src/__tests__/__data__/query-test-select-mock.tsv";
        await selectQuery.results().bindings().toFile(targetFile);
        const writtenContent = await fs.readFile(targetFile, "utf-8");
        const mockContent = await fs.readFile(mockFile, "utf-8");
        expect(writtenContent).to.equal(mockContent);
      });

      it("Should support query variables in select-queries", async function () {
        const results = await selectQuery.results({ s: "s:s1" }).bindings().toArray();
        expect(results.length).to.equal(1);
        expect(results[0]["p"]).to.not.be.undefined;
      });

      it("Should not support statements", async function () {
        expect(() => selectQuery.results().statements()).to.throw(TriplyDbJsError);
      });
    });
    it("Should use a cache fingerprint that's robust against renaming/replacing queries", async function () {
      await fs.emptyDir(tmpDir); //make sure we use a clean cache
      const queryName = `${CommonUnittestPrefix}-cache-test`;
      const query1 = await user.addQuery(queryName, {
        queryString: `select ("1" as ?a) where {}`,
        accessLevel: "private",
        output: "Table",
        dataset,
        serviceType: "speedy",
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
        output: "Table",
        dataset,
        serviceType: "speedy",
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
