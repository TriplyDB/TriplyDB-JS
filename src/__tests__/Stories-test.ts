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

describe("Stories", function () {
  let app: App;
  let user: User;
  let testDs: Dataset;
  let paragraph: string;
  before(async function () {
    this.timeout(10000);
    app = App.get({ token: process.env.UNITTEST_TOKEN_ACCOUNT });
    user = await app.getUser();
    await resetUnittestAccount(user);
    testDs = await getNewTestDs(user, "private");
    await fs.mkdirp(tmpDir);
    paragraph = "Here's a little story I'd like to tell...";
  });
  it("Should create and delete a story", async function () {
    const story = await user.addStory("test-story", {
      accessLevel: "public",
    });
    expect(await story.getInfo().then((q) => q.accessLevel)).to.equal("public");
    await story.delete();
    expect(await user.getInfo().then((q) => q.storyCount)).to.equal(0);
  });
  describe("Ensuring a story", function () {
    it("Should create when not already existing", async function () {
      const ensuredStory = await user.ensureStory(`${CommonUnittestPrefix}-ensured`, {
        accessLevel: "public",
        displayName: `${CommonUnittestPrefix}-ensured`,
        content: [{ type: "paragraph", paragraph }],
      });
      const storyInfo = await ensuredStory.getInfo();
      expect(storyInfo.accessLevel).to.equal("public");
      expect(storyInfo.content.map((el) => el.paragraph)).to.include(paragraph);
    });
    it("Should get existing when already existing", async function () {
      const firstStory = await user.addStory(`${CommonUnittestPrefix}-ensured2`, {
        content: [{ type: "paragraph", paragraph }],
      });
      const ensuredStory = await user.ensureStory(`${CommonUnittestPrefix}-ensured2`, {
        content: [{ type: "paragraph", paragraph: "this value should not be content" }],
      });
      const firstStoryInfo = await firstStory.getInfo();
      const ensuredStoryInfo = await ensuredStory.getInfo();
      expect(firstStoryInfo.id).to.equal(ensuredStoryInfo.id);
      // since the ensuredStory was not new, the newStoryInfo should not have been applied
      expect(ensuredStoryInfo.accessLevel).to.equal("private");
      expect(ensuredStoryInfo.content.map((el) => el.paragraph)).to.include(paragraph);
    });
    it("Should throw when access level doesn't match", async function () {
      await user.addStory(`${CommonUnittestPrefix}-ensured3`, {
        accessLevel: "public",
      });
      await expect(
        user.ensureStory(`${CommonUnittestPrefix}-ensured3`, {
          accessLevel: "private",
        })
      ).to.eventually.be.rejectedWith(/already exists with access level/);
    });
  });
});
