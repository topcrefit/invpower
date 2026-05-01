import { config } from "dotenv";
import { createClient } from "@libsql/client";

config({ path: "C:/DEV/INVPOWER/.env.local" });
const c = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// קבל credentials
const r = await c.execute("SELECT key, value FROM settings");
const m = {};
for (const row of r.rows) m[row.key] = row.value;

// פענוח (JSON-מוצפן? או ראש?)
console.log("base_url:", m["fireberry.base_url"]);
const token = m["fireberry.token"];
console.log("token start:", token?.slice(0, 50), "len:", token?.length);

await c.close();
