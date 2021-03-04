import App from "./App";

export const token = process.env["TRIPLYDB_TOKEN"];
if (!token) process.exit(1);

async function run() {
  const app = App.get({ token: token });
  const account = await app.getAccount("laurensrietveld");
  await account.getDataset("test").importFromFiles("./test.nt");
}
run().catch(console.error);
