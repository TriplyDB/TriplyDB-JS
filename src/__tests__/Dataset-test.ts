import App from "../App";
import { Account } from "../Account";
import Dataset from "../Dataset";
import { size, times, random } from "lodash";
import * as chai from "chai";
import { promisify } from "util";
import * as zlib from "zlib";
import { Store, DataFactory } from "n3";
import { resetUnittestAccount, buildPathToSrcPath, CommonUnittestPrefix } from "./utils";
import User from "../User";
import Graph from "../Graph";
import Service from "../Service";
import stream from "stream";
import path from "path";
import * as fs from "fs-extra";
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

describe("Dataset", function () {
  let app: App;
  let user: User;
  before(async function () {
    await fs.mkdirp(tmpDir);
    app = App.get({
      url: process.env.UNITTEST_API_URL,
      token: process.env.UNITTEST_TOKEN_ACCOUNT,
    });
    user = await app.getUser();

    await resetUnittestAccount(user);
  });

  describe("Adding datasets", function () {
    let testDs: Dataset;
    before(async function () {
      await resetUnittestAccount(user);
      testDs = await getNewTestDs(user, "private");
    });
    it("create dataset", async function () {
      expect(testDs["_info"]).to.exist;
    });
    it("create dataset with invalid name", async function () {
      try {
        await user.addDataset({ name: "____", accessLevel: "private" });
      } catch (e) {
        expect(e.message).to.contain("Dataset names can only contain");
        return;
      }
      throw new Error("Expected an err");
    });
  });
  describe("deleting dataset", function () {
    it("deleting an existing dataset", async function () {
      const testDs = await getNewTestDs(user, "private");
      await testDs.delete();
      expect(testDs["_info"]).to.be.undefined;
    });
  });
  describe("Ensuring dataset", function () {
    it("Should create when not already existing", async function () {
      const t = Date.now();
      const ensuredDs = await user.ensureDs(`${CommonUnittestPrefix}-ensured`, { license: "PDDL" });
      const dsInfo = await ensuredDs.getInfo();
      expect(new Date(dsInfo.createdAt).getTime()).to.be.greaterThan(t);
      expect(dsInfo.license).to.equal("PDDL");
    });
    it("Should get existing when already existing", async function () {
      const firstDataset = await user.addDataset({ name: `${CommonUnittestPrefix}-ensured2` });
      const firstDatasetInfo = await firstDataset.getInfo();
      const ensuredDs = await user.ensureDs(`${CommonUnittestPrefix}-ensured2`, { license: "PDDL" });
      const secondDsInfo = await ensuredDs.getInfo();
      expect(firstDatasetInfo.id).to.equal(secondDsInfo.id);
      // since the ensuredDs was not new, the newDsInfo should not have been applied
      expect(secondDsInfo.license).to.equal(undefined);
    });
  });

  describe("Change dataset metadata", function () {
    let testDs: Dataset;
    before(async function () {
      await resetUnittestAccount(user);
      testDs = await getNewTestDs(user, "private");
    });

    it("Set avatar", async function () {
      this.timeout(5000);
      let dsInfo = await testDs.getInfo();
      expect(dsInfo.avatarUrl).to.be.undefined;
      await testDs.setAvatar(buildPathToSrcPath(__dirname, "__data__", "logo.png"));
      dsInfo = await testDs.getInfo();
      expect(dsInfo.avatarUrl).to.contain("imgs/avatars/d/");
    });
  });
  describe("Manage prefixes", function () {
    let testDs: Dataset;
    before(async function () {
      testDs = await getNewTestDs(user, "private");
    });

    it("Get all prefixes", async function () {
      const prefixes = await testDs.getPrefixes();
      expect(size(prefixes)).to.be.gt(0);
    });
    it("Remove unknown prefixes", async function () {
      await testDs.removeDatasetPrefixes(["sdg"]); //should not throw
    });
    it("Add / remove prefixes", async function () {
      /**
       * Add 2
       */
      const listBefore = await testDs.getPrefixes();
      await testDs.addDatasetPrefixes({ test1: "https://test1", test2: "https://test2" });
      const listAfterAdding = await testDs.getPrefixes();
      expect(size(listAfterAdding) - size(listBefore)).to.equal(2);
      expect(listAfterAdding["test1"]).to.equal("https://test1");
      /**
       * Delete 1
       */
      await testDs.removeDatasetPrefixes(["test1"]);
      const listAfterRemoving = await testDs.getPrefixes();
      expect(size(listAfterRemoving) - size(listBefore)).to.equal(1);
      expect(listAfterRemoving["test1"]).to.be.undefined;
    });
  });
  describe("Import from files", function () {
    let testDs: Dataset;
    before(async function () {
      await resetUnittestAccount(user);
      testDs = await getNewTestDs(user, "private");
    });

    it("Upload", async function () {
      this.timeout(15000);

      await testDs.importFromFiles(
        buildPathToSrcPath(__dirname, "__data__", "test102.nt"),
        buildPathToSrcPath(__dirname, "__data__", "test103.nq")
      );
      const info = testDs["lastJob"]?.info();
      expect(info?.files).to.have.lengthOf(2);
    });
    it("Run job", async function () {
      this.timeout(15000);
      expect(testDs["lastJob"]?.info()?.status).to.equal("finished");
    });
  });
  describe("Import from files with overwrite", function () {
    let testDs: Dataset;
    before(async function () {
      await resetUnittestAccount(user);
      testDs = await getNewTestDs(user, "private");
    });

    it.skip("Upload", async function () {
      this.timeout(15000);
      await testDs.importFromFiles(
        buildPathToSrcPath(__dirname, "__data__", "test102.nt"),
        buildPathToSrcPath(__dirname, "__data__", "test103.nq")
      );
      let info = testDs["lastJob"]?.info();
      expect(info?.files).to.have.lengthOf(2);
      this.timeout(15000);
      expect(testDs["lastJob"]?.info()?.status).to.equal("finished");
      await testDs.importFromFiles(
        { overwriteAll: true },
        buildPathToSrcPath(__dirname, "__data__", "test102.nt"),
        buildPathToSrcPath(__dirname, "__data__", "test103.nq")
      );
      info = testDs["lastJob"]?.info();
      expect(info?.files).to.have.lengthOf(2);
      expect(await testDs.getGraphs().toArray()).to.have.lengthOf(2);
      const ds2 = user.getDataset((await testDs.getInfo()).name);

      expect(await ds2.getGraphs().toArray()).to.have.lengthOf(2);
      expect((await ds2.getInfo()).graphCount).to.equal(2);
    });
  });
  describe("Import from store", function () {
    let testDs: Dataset;
    before(async function () {
      this.timeout(10000);
      await resetUnittestAccount(user);
      testDs = await getNewTestDs(user, "private");
    });
    it("Import", async function () {
      this.timeout(10000);
      const store = new Store();
      const term = DataFactory.namedNode("a:a");
      store.addQuad(term, term, term, term);
      await testDs.importFromStore(store);
      const dsInfo = await testDs.getInfo();
      expect(dsInfo.statements).to.equal(1);
    });
  });
  describe("Describing IRI", function () {
    let testDs: Dataset;
    before(async function () {
      this.timeout(5000);
      testDs = await getNewTestDs(user, "private");
      await testDs.importFromFiles(buildPathToSrcPath(__dirname, "__data__", "test102.nt"));
    });
    it("With empty iri", async function () {
      await expect(testDs.describe("")).eventually.rejectedWith(/Failed to describe '' of/);
    });
    it("With iri that does not exist", async function () {
      const results = await testDs.describe("https://whatever");
      expect(results).to.have.lengthOf(0);
    });
    it("With iri that exists", async function () {
      const results = await testDs.describe("http://data.socialhistory.org/vocab/hisco/entry/");
      expect(results).to.have.lengthOf(8);
    });
  });
  describe("Blocking simultaneous jobs for same dataset", function () {
    it("Should block two simultaneous jobs for the same dataset", async function () {
      this.timeout(10000);
      const ds = await getNewTestDs(user, "private");
      return expect(
        Promise.all([
          ds.importFromUrls("https://api.triplydb.com/datasets/vocabulary/music-keys/download"),
          ds.importFromFiles(buildPathToSrcPath(__dirname, "__data__", "test103.nq")),
        ])
      ).to.eventually.rejectedWith("There is already an ongoing job for this dataset. Await that one first.");
    });
    it("Should not block two consequtive jobs for the same dataset", async function () {
      this.timeout(15000);
      const ds = await getNewTestDs(user, "private");
      await ds.importFromUrls("https://api.triplydb.com/datasets/vocabulary/music-keys/download");
      await ds.importFromFiles(buildPathToSrcPath(__dirname, "__data__", "test103.nq"));
    });
  });
  describe("Clear resources", function () {
    let testDs: Dataset;
    beforeEach(async function () {
      testDs = await getNewTestDs(user, "private");
    });
    it("Clear graphs", async function () {
      this.timeout(10000);
      await testDs.importFromFiles(buildPathToSrcPath(__dirname, "__data__", "small.nq"));
      expect((await testDs.getInfo(true)).graphCount).to.equal(2);
      await testDs.clear("graphs");
      expect((await testDs.getInfo(true)).graphCount).to.equal(0);
    });
    it("Clear assets", async function () {
      await testDs.uploadAsset(buildPathToSrcPath(__dirname, "__data__", "small.nq"), "small.nq");
      expect((await testDs.getInfo(true)).assetCount).to.equal(1);
      await testDs.clear("assets");
      expect((await testDs.getInfo(true)).assetCount).to.equal(0);
    });
    it.skip("Clear services", async function () {
      this.timeout(30000);
      await testDs.importFromFiles(buildPathToSrcPath(__dirname, "__data__", "small.nq"));
      await testDs.addService("sparql", "sparql");
      expect((await testDs.getInfo(true)).serviceCount).to.equal(1);
      await testDs.clear("services");
      expect((await testDs.getInfo(true)).serviceCount).to.equal(0);
    });

    it.skip("Clear all resources", async function () {
      this.timeout(35000);
      await Promise.all([
        testDs
          .importFromFiles(buildPathToSrcPath(__dirname, "__data__", "small.nq"))
          .then(() => testDs.addService("sparql", "sparql")),
        testDs.uploadAsset(buildPathToSrcPath(__dirname, "__data__", "small.nq"), "small.nq"),
      ]).then(() => testDs.getInfo(true));
      const preClear = await testDs.getInfo();
      expect(preClear.serviceCount).to.equal(1);
      expect(preClear.assetCount).to.equal(1);
      expect(preClear.graphCount).to.equal(2);
      await testDs.clear("assets", "graphs", "services");
      const postClear = await testDs.getInfo();
      expect(postClear.serviceCount).to.equal(0);
      expect(postClear.assetCount).to.equal(0);
      expect(postClear.graphCount).to.equal(0);
    });
    it("Should throw on wrong key", async function () {
      return expect(testDs.clear("no" as any)).eventually.rejectedWith(`Unrecognized resource type: no`);
    });
  });
  describe("Assets", function () {
    let testDs: Dataset;
    beforeEach(async function () {
      testDs = await getNewTestDs(user, "private");
    });

    it("add an asset", async function () {
      this.timeout(5000);
      expect(
        (await testDs.uploadAsset(buildPathToSrcPath(__dirname, "__data__", "test102.nt"), "test102.nt")).getInfo()
          .versions.length
      ).to.equal(1);
      let assetCount = 0;
      for await (let asset of testDs.getAssets()) asset && assetCount++;
      expect(assetCount).to.equal(1);
    });
    it("add and remove an asset", async function () {
      this.timeout(5000);
      const assetsBefore = await testDs.getAssets().toArray();
      const addedAsset = await testDs.uploadAsset(__filename, "test");
      expect(await testDs.getAssets().toArray()).to.have.lengthOf(assetsBefore.length + 1);
      await addedAsset.delete();
      expect(await testDs.getAssets().toArray()).to.have.lengthOf(assetsBefore.length);
    });

    it("download an asset", async function () {
      this.timeout(15000);
      const originalFile = buildPathToSrcPath(__dirname, "__data__", "test102.nt");

      const toLocation = path.resolve(tmpDir, "test102.nt");
      await testDs.uploadAsset(originalFile, "test102.nt");
      const asset = await testDs.getAsset("test102.nt");
      await asset.toFile(toLocation);
      expect(await fs.pathExists(toLocation)).to.be.true;
      const originalFileContent = await fs.readFile(originalFile, "utf8");
      const downloadedFileContent = await fs.readFile(toLocation, "utf8");
      expect(originalFileContent).to.equal(downloadedFileContent);
    });

    it("stream through an asset", async function () {
      this.timeout(10000);

      const originalFile = buildPathToSrcPath(__dirname, "__data__", "test102.nt");
      await testDs.uploadAsset(originalFile, "test102.nt");
      const asset = await testDs.getAsset("test102.nt");

      let content = Buffer.from("");
      const stream = await asset.toStream();
      await new Promise((resolve, reject) => {
        stream.on("data", (data) => {
          content += data;
        });
        stream.on("error", reject);
        stream.on("finish", resolve);
      });

      const originalFileContent = (await fs.readFile(originalFile)).toString();
      expect(originalFileContent).to.equal(content.toString());
    });

    it("add asset with used name", async function () {
      this.timeout(5000);
      // this test fails, but shouldn't.
      // it leads to assets with the same name for the same ds. This shouldn't happen.
      // this is a problem with the server, not triplydb-js
      await testDs.uploadAsset(buildPathToSrcPath(__dirname, "__data__", "test102.nt"), "test102.nt");
      try {
        await testDs.uploadAsset(buildPathToSrcPath(__dirname, "__data__", "test102.nt"), "test102.nt");
      } catch (e) {
        return;
      }
      throw new Error("should have thrown");
    });
  });

  describe("With dataset that has graphs", function () {
    let testDs: Dataset;
    before(async function () {
      this.timeout(10000);
      testDs = await getNewTestDs(user, "private");
      await testDs.importFromFiles(
        buildPathToSrcPath(__dirname, "__data__", "test102.nt"),
        buildPathToSrcPath(__dirname, "__data__", "test103.nq")
      );
    });
    describe("Download graphs", function () {
      it("and decompress", async function () {
        await testDs.graphsToFile(path.resolve(tmpDir, "out.trig"));
      });
      it("keep compression", async function () {
        const outfile = path.resolve(tmpDir, "out.trig.gz");
        await testDs.graphsToFile(outfile);
        //should be compressed (the below fails if it isnt)

        await promisify(zlib.gunzip)(await fs.readFile(outfile));
      });
    });
    it("Should have graphs", async function () {
      let graphs: Graph[] = [];
      for await (let graph of testDs.getGraphs()) graph && graphs.push(graph);
      expect(graphs).to.have.lengthOf(2);
      expect(graphs.find((g) => g["_info"].numberOfStatements === 103)).to.exist;
      expect(graphs.find((g) => g["_info"].numberOfStatements === 1)).to.exist;
    });
    it("download a graph", async function () {
      this.timeout(10000);
      await fs.mkdirp(buildPathToSrcPath(__dirname, "tmp"));
      for await (let g of testDs.getGraphs()) {
        if (g) {
          const gzipped = buildPathToSrcPath(__dirname, "tmp", "testf.trig.gz");
          const gunzipped = buildPathToSrcPath(__dirname, "tmp", "testf.trig");

          await g.toFile(buildPathToSrcPath(__dirname, "tmp", "testf.trig.gz"));
          await g.toFile(buildPathToSrcPath(__dirname, "tmp", "testf.trig"));
          expect(await fs.pathExists(gzipped));
          expect(await fs.pathExists(gunzipped));
        }
        break;
      }
    });
    it("stream through a graph", async function () {
      this.timeout(10000);
      for await (let g of testDs.getGraphs()) {
        if (g) {
          const stream = (await g.toStream("rdf-js")) as stream.Readable;
          await new Promise((resolve, reject) => {
            stream.on("error", (e) => reject(e));
            stream.on("finish", resolve);
          });
        }
        break;
      }
    });
    it("Should be able to rename", async function () {
      const newName = CommonUnittestPrefix + times(20, () => random(35).toString(36)).join("");
      await testDs.update({ name: newName });
      expect((await testDs.getInfo()).name).to.equal(newName);
    });
    describe("Import from dataset", function () {
      let dsToImportFrom: Dataset;
      before(async function () {
        this.timeout(10000);
        dsToImportFrom = await getNewTestDs(user, "private");
        await dsToImportFrom.importFromFiles(
          buildPathToSrcPath(__dirname, "__data__", "test102.nt"),
          buildPathToSrcPath(__dirname, "__data__", "test103.nq")
        );
        // Sanity check
        expect(testDs["lastJob"]?.info()?.status).to.equal("finished");
      });

      it("import empty graphs", async function () {
        const importedGraphs = await testDs.importFromDataset({ fromDataset: dsToImportFrom, graphs: {} });
        expect(importedGraphs).to.have.lengthOf(0);
      });
      it("import graph that doesnt exist", async function () {
        try {
          await testDs.importFromDataset({
            fromDataset: dsToImportFrom,
            graphs: { blaaaaaaa: "http://tosomethingelse" },
          });
        } catch {
          //expected this
          return;
        }
        throw new Error("Expected an err");
      });
      it("import single graph", async function () {
        let testDsGraphs: Graph[] = [];
        for await (let graph of testDs.getGraphs()) graph && testDsGraphs.push(graph);
        const importedGraphs = await testDs.importFromDataset({
          fromDataset: dsToImportFrom,
          graphs: {
            [testDsGraphs[0]["_info"].graphName]: "http://tosomethingelse",
          },
        });
        expect(importedGraphs).to.have.lengthOf(1);
      });
      it("import graph with overwrite", async function () {
        let testDsGraphs: Graph[] = [];
        for await (let graph of dsToImportFrom.getGraphs()) graph && testDsGraphs.push(graph);
        const numPreGraphs = (await testDs.getGraphs().toArray()).length;
        await testDs.importFromDataset({
          fromDataset: dsToImportFrom,
          graphs: {
            [testDsGraphs[0]["_info"].graphName]: "http://new-name",
            [testDsGraphs[1]["_info"].graphName]: "http://new-name-2",
          },
          overwrite: false,
        });
        const importedGraphs = await testDs.importFromDataset({
          fromDataset: dsToImportFrom,
          graphs: {
            [testDsGraphs[0]["_info"].graphName]: "http://new-name",
            [testDsGraphs[1]["_info"].graphName]: "http://new-name-3",
          },
          overwrite: true,
        });

        expect(importedGraphs).to.have.lengthOf(1);
        expect(await testDs.getGraphs().toArray()).to.have.length(3 + numPreGraphs);
      });
      it("import all graphs", async function () {
        const sourceDs = dsToImportFrom;
        const targetDs = await getNewTestDs(user, "private");

        const sourceDsGraphCount = (await sourceDs.getGraphs().toArray()).length;
        const targetDsGraphCount = (await targetDs.getGraphs().toArray()).length;

        // without overwrite
        let importedGraphs = await targetDs.importFromDataset({ fromDataset: sourceDs });
        expect(importedGraphs[0].graphs).to.have.lengthOf(sourceDsGraphCount);
        expect(await targetDs.getGraphs().toArray()).to.have.length(sourceDsGraphCount + targetDsGraphCount);

        // with overwrite
        importedGraphs = await targetDs.importFromDataset({ fromDataset: sourceDs, overwrite: true });
        expect(importedGraphs[0].graphs).to.have.lengthOf(sourceDsGraphCount);
        expect(await targetDs.getGraphs().toArray()).to.have.length(sourceDsGraphCount + targetDsGraphCount);
      });
    });
    describe.skip("Service tests", function () {
      it("Should make, restart, and delete a service", async function () {
        this.timeout(60000); // needs to start and restart a service. takes some time

        /**
         * Create dataset
         */
        const dsToImportFrom = await getNewTestDs(user, "private");
        await dsToImportFrom.importFromFiles(buildPathToSrcPath(__dirname, "__data__", "test103.nq"));
        await dsToImportFrom["lastJob"]?.exec();
        let testDsGraphs: Graph[] = [];
        for await (let graph of testDs.getGraphs()) graph && testDsGraphs.push(graph);
        await testDs.importFromDataset({
          fromDataset: dsToImportFrom,
          graphs: {
            [testDsGraphs[0]["_info"].graphName]: "http://tosomethingelse",
          },
        });

        /**
         * Add service
         */
        const service = await testDs.addService("sparql", "testService");
        let serviceList: Service[] = [];
        for await (let s of testDs.getServices()) s && serviceList.push(s);
        expect((await service.getInfo()).id).to.equal((await serviceList[0].getInfo()).id);
        expect(await service.isUpToDate()).to.be.true;

        /**
         * Change dataset
         */
        await testDs.importFromDataset({
          fromDataset: dsToImportFrom,
          graphs: {
            [testDsGraphs[1]["_info"].graphName]: "http://tosomethingelse2",
          },
        });

        /**
         * Sync service
         */
        expect(await service.isUpToDate()).to.be.false;
        await service.update();
        expect(await service.isUpToDate()).to.be.true;
        serviceList = [];
        for await (let s of testDs.getServices()) s && serviceList.push(s);
        expect(serviceList).to.have.length(1);

        /**
         * Delete service
         */
        await service.delete();
        serviceList = [];
        for await (let s of testDs.getServices()) s && serviceList.push(s);
        expect(serviceList).to.have.length(0);
      });
    });
  });
});
