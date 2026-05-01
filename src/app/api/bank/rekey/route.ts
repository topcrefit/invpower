import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import {
  bankTransactions,
  bankCardcomMatches,
  bankNoInvoiceApprovals,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/session";
import { normalizeRef } from "@/lib/parsers/bank-excel";
import crypto from "node:crypto";

export const runtime = "nodejs";

/**
 * מיגרציה חד-פעמית: חישוב מחדש של dedupKey לכל תנועות הבנק
 * עם reference מנורמל (ללא prefix "699"). מאחד תנועות שהיו דאבל.
 * רק אדמין.
 */

function makeDedupKey(parts: (string | number | null)[]): string {
  return crypto
    .createHash("sha256")
    .update(parts.map((p) => p ?? "").join("|"))
    .digest("hex")
    .slice(0, 32);
}

export async function POST() {
  const session = await requireAdmin();
  if (!session)
    return NextResponse.json({ error: "admin required" }, { status: 403 });

  const all = await db.select().from(bankTransactions);
  type Row = (typeof all)[number];

  // מחשב dedupKey חדש לכל שורה
  const newKeyById = new Map<number, string>();
  for (const r of all) {
    const newKey = makeDedupKey([
      r.txDate.toISOString().slice(0, 10),
      normalizeRef(r.reference),
      r.amount,
      r.extendedDescription,
    ]);
    newKeyById.set(r.id, newKey);
  }

  // מקבץ לפי המפתח החדש
  const byNewKey = new Map<string, Row[]>();
  for (const r of all) {
    const k = newKeyById.get(r.id)!;
    if (!byNewKey.has(k)) byNewKey.set(k, []);
    byNewKey.get(k)!.push(r);
  }

  let updated = 0;
  let merged = 0;
  const mergeDetails: Array<{
    survivorId: number;
    survivorRef: string | null;
    loserId: number;
    loserRef: string | null;
  }> = [];

  for (const [newKey, group] of byNewKey) {
    if (group.length === 1) {
      const r = group[0];
      if (r.dedupKey !== newKey) {
        await db
          .update(bankTransactions)
          .set({ dedupKey: newKey })
          .where(eq(bankTransactions.id, r.id));
        updated++;
      }
      continue;
    }

    // יותר משורה אחת מתאחדת — survivor = זו עם reference נקי (ללא 699)
    const sorted = [...group].sort((a, b) => {
      const aHas699 = (a.reference ?? "").trim().startsWith("699") ? 1 : 0;
      const bHas699 = (b.reference ?? "").trim().startsWith("699") ? 1 : 0;
      if (aHas699 !== bHas699) return aHas699 - bHas699; // נקי קודם
      return a.id - b.id; // tie-break לפי ID
    });
    const survivor = sorted[0];
    const losers = sorted.slice(1);

    for (const loser of losers) {
      // העברת אישור התאמה ידני, אם יש
      const survivorMatch = await db
        .select()
        .from(bankCardcomMatches)
        .where(eq(bankCardcomMatches.bankTransactionId, survivor.id));
      if (survivorMatch.length === 0) {
        await db
          .update(bankCardcomMatches)
          .set({ bankTransactionId: survivor.id })
          .where(eq(bankCardcomMatches.bankTransactionId, loser.id));
      } else {
        await db
          .delete(bankCardcomMatches)
          .where(eq(bankCardcomMatches.bankTransactionId, loser.id));
      }

      // העברת אישור "ללא חשבונית", אם יש
      const survivorNoInv = await db
        .select()
        .from(bankNoInvoiceApprovals)
        .where(eq(bankNoInvoiceApprovals.bankTransactionId, survivor.id));
      if (survivorNoInv.length === 0) {
        await db
          .update(bankNoInvoiceApprovals)
          .set({ bankTransactionId: survivor.id })
          .where(eq(bankNoInvoiceApprovals.bankTransactionId, loser.id));
      } else {
        await db
          .delete(bankNoInvoiceApprovals)
          .where(eq(bankNoInvoiceApprovals.bankTransactionId, loser.id));
      }

      mergeDetails.push({
        survivorId: survivor.id,
        survivorRef: survivor.reference,
        loserId: loser.id,
        loserRef: loser.reference,
      });

      await db
        .delete(bankTransactions)
        .where(eq(bankTransactions.id, loser.id));
      merged++;
    }

    if (survivor.dedupKey !== newKey) {
      await db
        .update(bankTransactions)
        .set({ dedupKey: newKey })
        .where(eq(bankTransactions.id, survivor.id));
      updated++;
    }
  }

  return NextResponse.json({
    ok: true,
    totalRowsScanned: all.length,
    keysUpdated: updated,
    duplicatesMerged: merged,
    mergeDetails,
  });
}
