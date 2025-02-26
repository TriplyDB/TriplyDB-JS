import App from "../App.js";
import * as chai from "chai";
import { CommonUnittestPrefix, getOtherUser, resetUnittestAccount } from "./utils.js";
import User from "../User.js";
import Org from "../Org.js";
import { times, random } from "lodash-es";
const expect = chai.expect;



process.on("unhandledRejection", function (reason: any, p: any) {
  console.warn("Possibly Unhandled Rejection at: Promise ", p, " reason: ", reason);
});
describe("Orgs", function () {
  let app: App;
  let user: User;
  let otherUser: User;
  before(async function () {
    app = App.get({
      url: process.env.UNITTEST_API_URL,
      token: process.env.UNITTEST_TOKEN_ACCOUNT,
    });
    user = await app.getUser();
    await resetUnittestAccount(user);
    await user.getInfo();

    otherUser = await getOtherUser(app);
  });
  it("create org", async function () {
    const name = `${CommonUnittestPrefix}-someorg1`;
    const someorg = await user.createOrganization(name);
    expect((await someorg.getInfo()).accountName).to.equal(name);
  });
  describe("Updating org metadata", async function () {
    let org: Org;
    const name = `${CommonUnittestPrefix}-someorg2`;
    before(async function () {
      org = await user.createOrganization(name);
    });
    it("renaming should work", async function () {
      const newName = CommonUnittestPrefix + times(20, () => random(35).toString(36)).join("");
      await org.update({ accountName: newName });
      expect((await org.getInfo()).accountName).to.equal(newName);
      await org.update({ accountName: name });
      expect((await org.getInfo()).accountName).to.equal(name);
    });
    it("Managing members", async function () {
      /**
       * Fetching members
       */
      let members = await org.getMembers();
      expect(members.length).to.equal(1); //this is the user who created the org
      expect(members[0].role).to.equal("owner");

      /**
       * Adding a new member
       */
      await org.addMember(otherUser);
      members = await org.getMembers();
      expect(members.length).to.equal(2);
      expect(members.filter((m) => m.role === "member").length).to.equal(1);

      /**
       * Changing role of member
       */
      members = await org.changeRole(otherUser, "owner");
      expect(members.length).to.equal(2);
      expect(members.filter((m) => m.role === "owner").length).to.equal(2);
    });

    describe("pinning datasets", function () {
      it("Should have none by default", async function () {
        const pinned = await org.getPinnedItems();
        expect(pinned.length).to.equal(0);
      });
      it("Should be able to add / remove", async function () {
        /**
         * adding 1
         */
        const ds1 = await org.addDataset(`${CommonUnittestPrefix}-pinned1`);
        await org.pinItems([ds1]);
        let pinned = await org.getPinnedItems();
        expect(pinned.length).to.equal(1);

        /**
         * adding 2 and removing 1
         */
        const ds2 = await org.addDataset(`${CommonUnittestPrefix}-pinned2`);
        const ds3 = await org.addDataset(`${CommonUnittestPrefix}-pinned3`);
        await org.pinItems([ds2, ds3]);

        pinned = await org.getPinnedItems();
        expect(pinned.length).to.equal(2);
      });
    });
  });

  // Error messages
  describe("Initialization", function () {
    it("Should throw error when organization does not exist", async function () {
      return expect(App.get().getOrganization("Triply_")).to.eventually.rejectedWith(
        "Failed to fetch organization Triply_. (It does not exist)"
      );
    });

    it("Should throw error when getting a user with an organization name", async function () {
      return expect(App.get().getUser("Triply")).to.eventually.rejectedWith(
        "Failed to fetch user Triply. Note that there is an organization with that name."
      );
    });
  });
});
