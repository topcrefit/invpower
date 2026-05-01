import { config } from "dotenv";
import { createClient } from "@libsql/client";
config({ path: "C:/DEV/INVPOWER/.env.local" });
const c = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const r = await c.execute("DELETE FROM issued_invoices WHERE status = 'failed'");
console.log("נמחקו", r.rowsAffected, "רשומות failed");
await c.close();
