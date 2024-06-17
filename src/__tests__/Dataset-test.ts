import App from "../App.js";
import { Account } from "../Account.js";
import Dataset from "../Dataset.js";
import { size, times, random } from "lodash-es";
import * as chai from "chai";
import { promisify } from "util";
import * as zlib from "zlib";
import { Store, DataFactory, Util } from "n3";
import { resetUnittestAccount, CommonUnittestPrefix } from "./utils.js";
import User from "../User.js";
import Graph from "../Graph.js";
import Service from "../Service.js";
import stream from "stream";
import path from "path";
import fs from "fs-extra";
import dotenv from "dotenv";
import { TriplyDbJsError } from "../utils/Error.js";
dotenv.config();
const expect = chai.expect;
process.on("unhandledRejection", function (reason: any, p: any) {
  console.warn("Possibly Unhandled Rejection at: Promise ", p, " reason: ", reason);
});
function getTmpDir(...subpaths: string[]) {
  return path.resolve("./src/__tests__/tmp", ...subpaths);
}
function getDataDir(...subpaths: string[]) {
  return path.resolve("./src/__tests__/__data__", ...subpaths);
}
const datasetsToClean: Dataset[] = [];
let testDsIndex = 0;
const getNewTestDs = async (account: Account, accessLevel: "public" | "private") => {
  const ds = await account.addDataset(
    // keep the name short to avoid hitting the 40-character limit
    `${CommonUnittestPrefix}-${testDsIndex++}`,
    { accessLevel: accessLevel },
  );
  datasetsToClean.push(ds);
  return ds;
};

describe("Dataset", function () {
  let app: App;
  let user: User;
  before(async function () {
    await fs.mkdirp(getTmpDir());
    app = App.get({
      url: process.env.UNITTEST_API_URL,
      token: process.env.UNITTEST_TOKEN_ACCOUNT,
    });
    user = await app.getUser();

    await resetUnittestAccount(user);
  });
  it("Race condition when removing datasets", async function () {
    await resetUnittestAccount(user);
    const testDs = await getNewTestDs(user, "private");
    await Promise.all([testDs.delete(), testDs.delete()]);
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
        await user.addDataset("____", { accessLevel: "private" });
      } catch (e: any) {
        expect(e.message).to.contain("A dataset name can only contain");
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
      const ensuredDs = await user.ensureDataset(`${CommonUnittestPrefix}-ensured`, { license: "PDDL" });
      const dsInfo = await ensuredDs.getInfo();
      expect(dsInfo.license).to.equal("PDDL");
    });
    it("Should get existing when already existing", async function () {
      const firstDataset = await user.addDataset(`${CommonUnittestPrefix}-ensured2`);
      const firstDatasetInfo = await firstDataset.getInfo();
      const ensuredDs = await user.ensureDataset(`${CommonUnittestPrefix}-ensured2`, { license: "PDDL" });
      const secondDsInfo = await ensuredDs.getInfo();
      expect(firstDatasetInfo.id).to.equal(secondDsInfo.id);
      // since the ensuredDs was not new, the newDsInfo should not have been applied
      expect(secondDsInfo.license).to.equal(undefined);
    });
    it("Should throw when access level doesn't match", async function () {
      await user.addDataset(`${CommonUnittestPrefix}-ensured3`);
      const ensuredDs = user.ensureDataset(`${CommonUnittestPrefix}-ensured3`, { accessLevel: "public" });
      await expect(ensuredDs).to.eventually.be.rejectedWith(/already exists with access level/);
    });
  });

  describe("Change dataset metadata", function () {
    let testDs: Dataset;
    before(async function () {
      await resetUnittestAccount(user);
      testDs = await getNewTestDs(user, "private");
    });

    it("Set avatar", async function () {
      let dsInfo = await testDs.getInfo();
      expect(dsInfo.avatarUrl).to.be.undefined;
      await testDs.setAvatar(getDataDir("logo.png"));
      dsInfo = await testDs.getInfo();
      expect(dsInfo.avatarUrl).to.contain("imgs/avatars/d/");
    });
  });
  describe("Manage prefixes", function () {
    let testDs: Dataset;
    before(async function () {
      await resetUnittestAccount(user);
      testDs = await getNewTestDs(user, "private");
    });

    it("Get all prefixes", async function () {
      const prefixes = await testDs.getPrefixes();
      expect(size(prefixes)).to.be.gt(0);
    });
    it("Remove unknown prefixes", async function () {
      await testDs.removePrefixes(["sdg"]); //should not throw
    });
    it("Add / remove prefixes", async function () {
      /**
       * Add 1 upon dataset creation
       */
      const newDs = await user.addDataset(`${CommonUnittestPrefix}-dataset-prefix-test`, {
        prefixes: {
          abc: "https://test1",
          abd: DataFactory.namedNode("https://test2"),
          abe: Util.prefix("https://test3"),
        },
      });
      const prefixes = await newDs.getPrefixes();
      expect(prefixes["abc"]).to.equal("https://test1");
      expect(prefixes["abd"]).to.equal("https://test2");
      expect(prefixes["abe"]).to.equal("https://test3");
      /**
       * Add 2
       */
      const listBefore = await testDs.getPrefixes();
      await testDs.addPrefixes({ test1: "https://test1", test2: "https://test2" });
      const listAfterAdding = await testDs.getPrefixes();
      expect(size(listAfterAdding) - size(listBefore)).to.equal(2);
      expect(listAfterAdding["test1"]).to.equal("https://test1");
      /**
       * Delete 1
       */
      await testDs.removePrefixes(["test1"]);
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
      await testDs.importFromFiles([getDataDir("test102.nt"), getDataDir("test103.nq")]);
      const info = testDs["_lastJob"]?.info();
      expect(info?.files).to.have.lengthOf(2);
    });

    it.skip("Large Upload", async function () {
      const filename = "PATH TO A 250MB FILE";
      await testDs.importFromFiles([filename]);
    });

    it("Run job", async function () {
      expect(testDs["_lastJob"]?.info()?.status).to.equal("finished");
    });
  });
  describe("Import from files with overwrite", function () {
    let testDs: Dataset;
    before(async function () {
      await resetUnittestAccount(user);
      testDs = await getNewTestDs(user, "private");
    });

    it("Upload", async function () {
      await testDs.importFromFiles([getDataDir("test102.nt"), getDataDir("test103.nq")]);
      let info = testDs["_lastJob"]?.info();
      expect(info?.files).to.have.lengthOf(2);
      expect(testDs["_lastJob"]?.info()?.status).to.equal("finished");
      await testDs.importFromFiles([getDataDir("test102.nt"), getDataDir("test103.nq")], { overwriteAll: true });
      info = testDs["_lastJob"]?.info();
      expect(info?.files).to.have.lengthOf(2);
      expect(await testDs.getGraphs().toArray()).to.have.lengthOf(2);
      const ds2 = await user.getDataset((await testDs.getInfo()).name);

      expect(await ds2.getGraphs().toArray()).to.have.lengthOf(2);
      expect((await ds2.getInfo()).graphCount).to.equal(2);
    });
  });
  describe("Import from files with merge", function () {
    let testDs: Dataset;
    before(async function () {
      await resetUnittestAccount(user);
      testDs = await getNewTestDs(user, "private");
    });

    it("Upload", async function () {
      await testDs.importFromFiles([getDataDir("test102.nt"), getDataDir("test103.nq")]);
      let info = testDs["_lastJob"]?.info();
      expect(info?.files).to.have.lengthOf(2, "initially");

      expect(testDs["_lastJob"]?.info()?.status).to.equal("finished");
      await testDs.importFromFiles([getDataDir("test102.nt"), getDataDir("test103.nq")], { mergeGraphs: true });
      info = testDs["_lastJob"]?.info();
      expect(info?.files).to.have.lengthOf(2);

      const graphs1 = await testDs.getGraphs().toArray();
      expect(graphs1).to.have.lengthOf(2, "after merging with duplicate data");
      const ds2 = await user.getDataset((await testDs.getInfo()).name);
      const graphs2 = await ds2.getGraphs().toArray();
      expect(graphs2).to.have.lengthOf(2);
      expect((await ds2.getInfo()).graphCount).to.equal(2);
      const statements2 = (await Promise.all(graphs2.map((g) => g.getInfo()))).map((x) => x.numberOfStatements).sort();
      expect(statements2).to.deep.equal([1, 103]);

      expect(testDs["_lastJob"]?.info()?.status).to.equal("finished");
      await testDs.importFromFiles([getDataDir("small.nt")], { mergeGraphs: true });
      info = testDs["_lastJob"]?.info();
      expect(info?.files).to.have.lengthOf(1);
      expect(await testDs.getGraphs().toArray()).to.have.lengthOf(2, "after merging with new data");
      const ds3 = await user.getDataset((await testDs.getInfo()).name);
      const graphs3 = await ds2.getGraphs().toArray();
      expect(graphs3).to.have.lengthOf(2);
      expect((await ds2.getInfo()).graphCount).to.equal(2);
      const statements3 = (await Promise.all(graphs3.map((g) => g.getInfo()))).map((x) => x.numberOfStatements).sort();
      expect(statements3).to.deep.equal([1, 105]);

      expect(await ds3.getGraphs().toArray()).to.have.lengthOf(2);
      expect((await ds3.getInfo()).graphCount).to.equal(2);
    });
  });
  describe("Import from store", function () {
    let testDs: Dataset;
    beforeEach(async function () {
      await resetUnittestAccount(user);
      testDs = await getNewTestDs(user, "private");
    });
    it("Import a quad", async function () {
      const store = new Store();
      const term = DataFactory.namedNode("a:a");
      store.addQuad(term, term, term, term);
      await testDs.importFromStore(store);
      const dsInfo = await testDs.getInfo();
      expect(dsInfo.statements).to.equal(1);
    });
    it("Import a triple", async function () {
      const store = new Store();
      const term = DataFactory.namedNode("a:a");
      store.addQuad(term, term, term);
      await testDs.importFromStore(store);
      const dsInfo = await testDs.getInfo();
      expect(dsInfo.statements).to.equal(1);
    });
    it("Import a boolean literal", async function () {
      const store = new Store();
      const term = DataFactory.namedNode("a:a");
      store.addQuad(
        term,
        term,
        DataFactory.literal("true", DataFactory.namedNode("http://www.w3.org/2001/XMLSchema#boolean")),
        term,
      );
      await testDs.importFromStore(store);
      const dsInfo = await testDs.getInfo();
      expect(dsInfo.statements).to.equal(1);
    });
    it("Import a language-tagged literal", async function () {
      const store = new Store();
      const term = DataFactory.namedNode("a:a");
      store.addQuad(term, term, DataFactory.literal("true", "en"), term);
      await testDs.importFromStore(store);
      const dsInfo = await testDs.getInfo();
      expect(dsInfo.statements).to.equal(1);
    });
  });
  describe("Describing IRI", function () {
    let testDs: Dataset;
    before(async function () {
      testDs = await getNewTestDs(user, "private");
      await testDs.importFromFiles([getDataDir("test102.nt")]);
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
      const ds = await getNewTestDs(user, "private");
      return expect(
        Promise.all([
          ds.importFromUrls(["https://api.triplydb.com/datasets/vocabulary/music-keys/download"]),
          ds.importFromFiles([getDataDir("test103.nq")]),
        ]),
      ).to.eventually.rejectedWith("There is already an ongoing job for this dataset. Await that one first.");
    });
    it("Should not block two consequtive jobs for the same dataset", async function () {
      const ds = await getNewTestDs(user, "private");
      await ds.importFromUrls(["https://api.triplydb.com/datasets/vocabulary/music-keys/download"]);
      await ds.importFromFiles([getDataDir("test103.nq")]);
    });
  });
  describe("Clear resources", function () {
    let testDs: Dataset;
    beforeEach(async function () {
      testDs = await getNewTestDs(user, "private");
    });
    it("Clear graphs", async function () {
      await testDs.importFromFiles([getDataDir("small.nq")]);
      expect((await testDs.getInfo(true)).graphCount).to.equal(2);
      await testDs.clear("graphs");
      expect((await testDs.getInfo(true)).graphCount).to.equal(0);
    });
    it("Clear assets", async function () {
      await testDs.uploadAsset(getDataDir("small.nq"), { name: "small.nq" });
      expect((await testDs.getInfo(true)).assetCount).to.equal(1);
      await testDs.clear("assets");
      expect((await testDs.getInfo(true)).assetCount).to.equal(0);
    });
    it("Clear services", async function () {
      await testDs.importFromFiles([getDataDir("small.nq")]);
      await testDs.addService("sparql");
      expect((await testDs.getInfo(true)).serviceCount).to.equal(1);
      await testDs.clear("services");
      expect((await testDs.getInfo(true)).serviceCount).to.equal(0);
    });

    it("Clear all resources", async function () {
      await Promise.all([
        testDs.importFromFiles([getDataDir("small.nq")]).then(() => testDs.addService("sparql")),
        testDs.uploadAsset(getDataDir("small.nq"), { name: "small.nq" }),
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
      expect(
        (await testDs.uploadAsset(getDataDir("test102.nt"), {
          name: "test102.nt",
        }))!.getInfo().versions.length,
      ).to.equal(1);
      let assetCount = 0;
      for await (let asset of testDs.getAssets()) asset && assetCount++;
      expect(assetCount).to.equal(1);
    });
    it("mode append-version", async function () {
      expect(
        (await testDs.uploadAsset(getDataDir("test102.nt"), { mode: "append-version", name: "test102.nt" })).getInfo()
          .versions.length,
      ).to.equal(1);
      expect(
        (await testDs.uploadAsset(getDataDir("test102.nt"), { mode: "append-version", name: "test102.nt" })).getInfo()
          .versions.length,
      ).to.equal(2);
      expect(
        (await testDs.uploadAsset(getDataDir("test102.nt"), { mode: "append-version", name: "test102.nt" })).getInfo()
          .versions.length,
      ).to.equal(3);

      let assetCount = 0;
      for await (let asset of testDs.getAssets()) asset && assetCount++;
      expect(assetCount).to.equal(1);
    });
    it("throw-if-exists", async function () {
      expect(
        (await testDs.uploadAsset(getDataDir("test102.nt"), { mode: "throw-if-exists", name: "test102.nt" })).getInfo()
          .versions.length,
      ).to.equal(1);
      await expect(
        testDs.uploadAsset(getDataDir("test102.nt"), { mode: "throw-if-exists", name: "test102.nt" }),
      ).to.be.rejectedWith(TriplyDbJsError, "but an asset with that name already exists.");
    });
    it("undefined mode", async function () {
      expect(
        (await testDs.uploadAsset(getDataDir("test102.nt"), { name: "test102.nt" })).getInfo().versions.length,
      ).to.equal(1);
      await expect(testDs.uploadAsset(getDataDir("test102.nt"), { name: "test102.nt" })).to.be.rejectedWith(
        TriplyDbJsError,
        "but an asset with that name already exists.",
      );
    });
    it("undefined mode and name", async function () {
      expect((await testDs.uploadAsset(getDataDir("test102.nt"))).getInfo().versions.length).to.equal(1);
      await expect(testDs.uploadAsset(getDataDir("test102.nt"))).to.be.rejectedWith(
        TriplyDbJsError,
        "but an asset with that name already exists.",
      );
    });
    it("replace-if-exists", async function () {
      expect(
        (
          await testDs.uploadAsset(getDataDir("test102.nt"), { mode: "replace-if-exists", name: "test102.nt" })
        ).getInfo().versions.length,
      ).to.equal(1);
      expect(
        (
          await testDs.uploadAsset(getDataDir("test102.nt"), { mode: "replace-if-exists", name: "test102.nt" })
        ).getInfo().versions.length,
      ).to.equal(1);
      const asset = await testDs.uploadAsset(getDataDir("small.nt"), {
        mode: "replace-if-exists",
        name: "test102.nt",
      });
      expect(asset.getInfo().versions.length).to.equal(1);
      const originalFile = getDataDir("small.nt");
      const toLocation = getTmpDir("small.nt");
      await asset.toFile(toLocation);
      expect(await fs.pathExists(toLocation)).to.be.true;
      const originalFileContent = await fs.readFile(originalFile, "utf8");
      const downloadedFileContent = await fs.readFile(toLocation, "utf8");
      expect(originalFileContent).to.equal(downloadedFileContent);
    });
    it("add and remove an asset", async function () {
      const assetsBefore = await testDs.getAssets().toArray();
      const addedAsset = await testDs.uploadAsset("./package.json", { name: "test" });
      expect(await testDs.getAssets().toArray()).to.have.lengthOf(assetsBefore.length + 1);
      await addedAsset.delete();
      expect(await testDs.getAssets().toArray()).to.have.lengthOf(assetsBefore.length);
    });

    it("download an asset", async function () {
      const originalFile = getDataDir("test102.nt");

      const toLocation = getTmpDir("test102.nt");
      await testDs.uploadAsset(originalFile, { name: "test102.nt" });
      const asset = await testDs.getAsset("test102.nt");
      await asset.toFile(toLocation);
      expect(await fs.pathExists(toLocation)).to.be.true;
      const originalFileContent = await fs.readFile(originalFile, "utf8");
      const downloadedFileContent = await fs.readFile(toLocation, "utf8");
      expect(originalFileContent).to.equal(downloadedFileContent);
    });

    it("stream through an asset", async function () {
      const originalFile = getDataDir("test102.nt");
      await testDs.uploadAsset(originalFile, { name: "test102.nt" });
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
  });

  describe("With dataset that has graphs", function () {
    let testDs: Dataset;
    before(async function () {
      testDs = await getNewTestDs(user, "private");
      await testDs.importFromFiles([getDataDir("test102.nt"), getDataDir("test103.nq")]);
    });
    describe("Download graphs", function () {
      it("and decompress", async function () {
        await testDs.graphsToFile(getTmpDir("out.trig"));
      });
      it("keep compression", async function () {
        const outfile = getTmpDir("out.trig.gz");
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
      await fs.mkdirp(getTmpDir());
      for await (let g of testDs.getGraphs()) {
        const gzipped = getTmpDir("testf.jsonld.gz");
        const gunzipped = getTmpDir("testf.jsonld");

        await fs.remove(gzipped);
        await fs.remove(gunzipped);

        await g.toFile(gzipped);
        await g.toFile(gunzipped);

        expect(await fs.pathExists(gzipped)).to.be.true;
        expect(await fs.pathExists(gunzipped)).to.be.true;

        await expect(
          new Promise(async (resolve, reject) =>
            zlib.gunzip(await fs.readFile(gzipped), (e, result) =>
              e ? reject(e) : resolve(JSON.parse(result.toString("utf-8"))),
            ),
          ),
        ).to.eventually.deep.equal(JSON.parse(await fs.readFile(gunzipped, "utf-8")));

        break; // only test one graph
      }
    });
    it("download the whole dataset", async function () {
      await fs.mkdirp(getTmpDir());
      const gzipped = getTmpDir("testf.nt.gz");
      const gunzipped = getTmpDir("testf.nq");

      await fs.remove(gzipped);
      await fs.remove(gunzipped);

      await testDs.graphsToFile(gzipped);
      await testDs.graphsToFile(gunzipped);

      expect(await fs.pathExists(gzipped));
      expect(await fs.pathExists(gunzipped));
    });
    it("stream through a graph", async function () {
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
        dsToImportFrom = await getNewTestDs(user, "private");
        await dsToImportFrom.importFromFiles([getDataDir("test102.nt"), getDataDir("test103.nq")]);
        // Sanity check
        expect(testDs["_lastJob"]?.info()?.status).to.equal("finished");
      });

      it("import empty graphs", async function () {
        const importedGraphs = await testDs.importFromDataset(dsToImportFrom, { graphMap: {} });
        expect(importedGraphs).to.have.lengthOf(0);
      });
      it("import graph that doesnt exist", async function () {
        try {
          await testDs.importFromDataset(dsToImportFrom, { graphMap: { blaaaaaaa: "http://tosomethingelse" } });
        } catch {
          //expected this
          return;
        }
        throw new Error("Expected an err");
      });
      it("import single graph", async function () {
        let testDsGraphs: Graph[] = [];
        for await (let graph of dsToImportFrom.getGraphs()) graph && testDsGraphs.push(graph);
        const importedGraphs = await testDs.importFromDataset(dsToImportFrom, {
          graphMap: {
            [testDsGraphs[0]["_info"].graphName]: "http://tosomethingelse",
          },
        });
        expect(importedGraphs).to.have.lengthOf(1);
      });
      it("import graph with overwrite", async function () {
        let testDsGraphs: Graph[] = [];
        for await (let graph of dsToImportFrom.getGraphs()) graph && testDsGraphs.push(graph);
        const numPreGraphs = (await testDs.getGraphs().toArray()).length;
        await testDs.importFromDataset(dsToImportFrom, {
          graphMap: {
            [testDsGraphs[0]["_info"].graphName]: "http://new-name",
            [testDsGraphs[1]["_info"].graphName]: "http://new-name-2",
          },
          overwrite: false,
        });
        const importedGraphs = await testDs.importFromDataset(dsToImportFrom, {
          graphMap: {
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
        let importedGraphs = await targetDs.importFromDataset(sourceDs);
        expect(importedGraphs[0].graphs).to.have.lengthOf(sourceDsGraphCount);
        expect(await targetDs.getGraphs().toArray()).to.have.length(sourceDsGraphCount + targetDsGraphCount);

        // with overwrite
        importedGraphs = await targetDs.importFromDataset(sourceDs, { overwrite: true });
        expect(importedGraphs[0].graphs).to.have.lengthOf(sourceDsGraphCount);
        expect(await targetDs.getGraphs().toArray()).to.have.length(sourceDsGraphCount + targetDsGraphCount);
      });
    });
    describe("Service tests", function () {
      it("Should make, restart, and delete a service", async function () {
        /**
         * Create dataset
         */
        const dsToImportFrom = await getNewTestDs(user, "private");
        await dsToImportFrom.importFromFiles([getDataDir("test103.nq")]);
        const dsToImportFromGraphs: Graph[] = [];
        for await (const graph of dsToImportFrom.getGraphs()) dsToImportFromGraphs.push(graph);
        await testDs.importFromDataset(dsToImportFrom, {
          graphMap: {
            [dsToImportFromGraphs[0]["_info"].graphName]: "http://tosomethingelse",
          },
        });

        /**
         * Add service
         */
        const service = await testDs.addService("testService");
        let serviceList: Service[] = [];
        for await (const s of testDs.getServices()) serviceList.push(s);
        expect((await service.getInfo()).id).to.equal((await serviceList[0].getInfo()).id);
        expect(await service.isUpToDate()).to.be.true;

        /**
         * Change dataset
         */
        await testDs.importFromDataset(dsToImportFrom, {
          graphMap: {
            [dsToImportFromGraphs[1]["_info"].graphName]: "http://tosomethingelse2",
          },
        });

        /**
         * Sync service
         */
        expect(await service.isUpToDate()).to.be.false;
        await service.update();
        expect(await service.isUpToDate()).to.be.true;
        serviceList = [];
        for await (const s of testDs.getServices()) serviceList.push(s);
        expect(serviceList).to.have.length(1);

        /**
         * Delete service
         */
        await service.delete();
        serviceList = [];
        for await (const s of testDs.getServices()) serviceList.push(s);
        expect(serviceList).to.have.length(0);
      });
    });
    describe("Services in Dataset", () => {
      it("Should get a service by name", async function () {
        const serviceName1 = `${CommonUnittestPrefix}-addService-1`;
        const serviceName2 = `${CommonUnittestPrefix}-addService-2`;
        await testDs.ensureService(serviceName1, { type: "virtuoso" });
        await testDs.ensureService(serviceName2, { type: "jena" });
        const gottenService1 = await testDs.getService(serviceName1);
        expect((await gottenService1.getInfo()).name).to.equal(serviceName1);
        const gottenService2 = await testDs.getService(serviceName2);
        const gottenService2Info = await gottenService2.getInfo();
        expect(gottenService2Info.name).to.equal(serviceName2);
        expect(gottenService2Info.type).to.equal("jena");
      });
    });
  });
});
