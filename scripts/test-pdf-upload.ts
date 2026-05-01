// ניסוי חד-פעמי: הורדת PDF של חשבונית 51067 מ-Cardcom והעלאה לרשומת customobject1004 ב-Fireberry
// לא נוגע בשום קוד אחר. רק מתעד מה קורה.
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });

import { createClient } from "@libsql/client";
import { getCardcomCreds, getFireberryCreds } from "../src/lib/settings/store";

async function main() {
  const dbClient = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });
  const cc = await getCardcomCreds();
  const fb = await getFireberryCreds();
  if (!cc || !fb) throw new Error("missing creds");

  // 1. מצא את ה-recordId של customobject1004 עבור חשבונית 51067
  const r = await dbClient.execute(
    "SELECT cardcom_invoice_number, fireberry_file_id, customer_name FROM issued_invoices WHERE cardcom_invoice_number = '51067'"
  );
  if (r.rows.length === 0) {
    console.error("חשבונית 51067 לא נמצאה ב-issued_invoices");
    process.exit(1);
  }
  const recordId = String(r.rows[0].fireberry_file_id);
  console.log(`✓ נמצא recordId: ${recordId} (לקוח: ${r.rows[0].customer_name})`);

  // 2. הורדת PDF מ-Cardcom לפי המסמך
  console.log("\n=== שלב 1: הורדת PDF מ-Cardcom");
  const cardcomUrl =
    `${cc.baseUrl}/interface/GetDocumentPDF.aspx` +
    `?UserName=${encodeURIComponent(cc.apiName)}` +
    `&UserPassword=${encodeURIComponent(cc.apiPassword)}` +
    `&DocumentNumber=51067` +
    `&DocumentType=1` +
    `&IsOriginal=True`;
  console.log(`URL: ${cardcomUrl.replace(cc.apiPassword, "***")}`);
  const ccRes = await fetch(cardcomUrl);
  console.log(`Status: ${ccRes.status}`);
  console.log(`Content-Type: ${ccRes.headers.get("content-type")}`);
  const pdfBuffer = Buffer.from(await ccRes.arrayBuffer());
  console.log(`PDF Size: ${pdfBuffer.length} bytes`);
  if (pdfBuffer.length < 1000) {
    console.error("❌ PDF נראה ריק/קטן מדי — Cardcom לא החזיר PDF תקין");
    console.log("Body:", pdfBuffer.toString("utf8").slice(0, 500));
    process.exit(1);
  }
  if (!pdfBuffer.toString("utf8", 0, 4).startsWith("%PDF")) {
    console.error("❌ הקובץ לא מתחיל ב-%PDF — לא PDF תקין");
    console.log("First bytes:", pdfBuffer.toString("utf8", 0, 200));
    process.exit(1);
  }
  console.log("✓ PDF הורד בהצלחה");

  // 3. העלאה ל-Fireberry customobject1004
  console.log("\n=== שלב 2: העלאת PDF ל-Fireberry customobject1004");
  const fbUrl = `https://api.fireberry.com/api/v2/record/1004/${recordId}/files`;
  console.log(`URL: ${fbUrl}`);

  const formData = new FormData();
  formData.append(
    "file",
    new Blob([pdfBuffer], { type: "application/pdf" }),
    `invoice_51067.pdf`
  );

  const fbRes = await fetch(fbUrl, {
    method: "POST",
    headers: { tokenid: fb.token },
    body: formData,
  });
  console.log(`Status: ${fbRes.status}`);
  const fbBody = await fbRes.text();
  console.log(`Body: ${fbBody.slice(0, 1000)}`);

  if (fbRes.ok) {
    console.log("\n🎉 הצלחה! ה-PDF הועלה לרשומת החשבונית ב-Fireberry");
    console.log(`לחפש בתיק של חיים עזרי → רשומת חשבונית מס קבלה 51067 → קבצים מצורפים`);
  } else {
    console.log("\n❌ העלאה נכשלה. תבדוק את התשובה למעלה");
  }

  await dbClient.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
