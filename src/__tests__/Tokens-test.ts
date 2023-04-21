import { Account } from "../Account.js";
import chai from "chai";
import Dataset from "../Dataset.js";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const expect = chai.expect;
import App from "../App.js";
import User from "../User.js";
import { resetUnittestAccount, CommonUnittestPrefix } from "./utils.js";
import { TriplyDbJsError } from "../utils/Error.js";

const readToken = process.env.UNITTEST_TOKEN_READ;
const writeToken = process.env.UNITTEST_TOKEN_WRITE;
const accountToken = process.env.UNITTEST_TOKEN_ACCOUNT;
const url = process.env.UNITTEST_API_URL;

// skip test if there is not one of each kind of tokens in the env vars
describe("Tokens", function () {
  let readAccount: User;
  let writeAccount: User;
  let accountAccount: User;
  let accountName: string;

  before(async function () {
    readAccount = await App.get({ url: url, token: readToken }).getUser();
    writeAccount = await App.get({ url: url, token: writeToken }).getUser();
    accountAccount = await App.get({ url: url, token: accountToken }).getUser();
    accountName = (await readAccount.getInfo()).accountName;
    await resetUnittestAccount(accountAccount);
  });

  describe("Rename account", function () {
    const renameFunction = (account: User, originalAccountname: string) =>
      account.update({ accountName: "joe" }).then(() => account.update({ accountName: originalAccountname }));
    it("read-token", async function () {
      await expect(renameFunction(readAccount, accountName)).to.be.rejectedWith(
        TriplyDbJsError,
        /Failed to update account information of.*\(401: Unauthorized/
      );
    });
    it("write-token", async function () {
      await expect(renameFunction(writeAccount, accountName)).to.be.rejectedWith(
        TriplyDbJsError,
        /Failed to update account information of.*\(401: Unauthorized/
      );
    });
    it("account-token", async function () {
      await renameFunction(accountAccount, accountName);
    });
  });

  describe("Create and delete dataset", function () {
    const createDeleteDsFunction = (account: Account) =>
      account
        .addDataset(`${CommonUnittestPrefix}-test-ds`, { accessLevel: "private" })
        .then((ds) => ds.update({ name: "its-a-ds" }))
        .then((ds) => ds.delete());
    it("read-token", async function () {
      return expect(createDeleteDsFunction(readAccount)).to.eventually.rejectedWith(
        `Failed to add dataset ${CommonUnittestPrefix}-test-ds to account ${accountName}. (401: Unauthorized.)`
      );
    });
    it("write-token", async function () {
      await createDeleteDsFunction(writeAccount);
    });
    it("account-token", async function () {
      await createDeleteDsFunction(accountAccount);
    });
  });

  it("Read own private dataset with read-only token", async function () {
    const newDs = await writeAccount.addDataset(`${CommonUnittestPrefix}-test-ds`, { accessLevel: "private" });
    let datasets: Dataset[] = [];
    for await (let ds of readAccount.getDatasets()) ds && datasets.push(ds);
    const newDsId = (await newDs.getInfo()).id;

    let found = false;
    for (const d of datasets) {
      if ((await d.getInfo()).id === newDsId) {
        found = true;
        break;
      }
    }

    await newDs.delete();

    if (!found) {
      throw new Error("new private ds not in list of datasets when using readToken");
    }
  });
});
