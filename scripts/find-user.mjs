import { config } from "dotenv";
import { createClient } from "@libsql/client";

config({ path: "C:/DEV/INVPOWER/.env.local" });

const client = createClient({
  url: process.env.TURSO_DATABASE_URL ?? "",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const res = await client.execute("SELECT id, email, role FROM users LIMIT 5");
console.log(res.rows);
await client.close();
