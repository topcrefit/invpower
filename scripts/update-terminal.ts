import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });
import { setSetting, SETTING_KEYS, getCardcomCreds } from "../src/lib/settings/store";

async function main() {
  await setSetting(SETTING_KEYS.CARDCOM_TERMINAL_NUMBER, "136942", 1, true);
  const c = await getCardcomCreds();
  console.log("עודכן: terminal =", c?.terminalNumber);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
