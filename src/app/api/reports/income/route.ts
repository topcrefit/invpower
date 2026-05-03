import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { cardcomGetReportAll } from "@/lib/cardcom/client";
import { buildIncomeReportXlsx } from "@/lib/reports/income-excel";

export const runtime = "nodejs";

/**
 * דוח הכנסות: GET /api/reports/income?from=YYYY-MM-DD&to=YYYY-MM-DD
 * מושך נתונים *ישירות מ-Cardcom* (ללא DB), ומחזיר xlsx להורדה.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");
  if (!fromStr || !toStr) {
    return NextResponse.json(
      { error: "from / to required (YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  const from = new Date(fromStr + "T00:00:00");
  const to = new Date(toStr + "T23:59:59");
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || from > to) {
    return NextResponse.json({ error: "invalid date range" }, { status: 400 });
  }

  try {
    const documents = await cardcomGetReportAll(from, to, 1);
    const buf = buildIncomeReportXlsx(documents);
    const filename = `income_${fromStr}_${toStr}.xlsx`;
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
