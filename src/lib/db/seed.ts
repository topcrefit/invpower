import "dotenv/config";
import bcrypt from "bcryptjs";
import { db } from "./client";
import { users } from "./schema";
import { eq } from "drizzle-orm";

async function main() {
  const email = process.env.INITIAL_ADMIN_EMAIL;
  const password = process.env.INITIAL_ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD must be set in .env"
    );
  }

  const existing = await db.select().from(users).where(eq(users.email, email));
  if (existing.length > 0) {
    console.log(`Admin ${email} already exists. Skipping.`);
    return;
  }

  const hash = await bcrypt.hash(password, 12);
  await db.insert(users).values({
    email,
    passwordHash: hash,
    fullName: "Administrator",
    role: "admin",
    isActive: true,
  });
  console.log(`✅ Admin user created: ${email}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
