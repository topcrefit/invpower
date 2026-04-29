# InvPower — הפקת חשבוניות מס-קבלה אוטומטית

כלי ייעודי שמאפשר להעלות קובץ תנועות בנק (Excel), לזהות אילו הפקדות עוד אין להן חשבונית ב-Cardcom, ולהפיק חשבוניות מס-קבלה אוטומטית. לאחר הפקה — ה-PDF מועלה אוטומטית לכרטיס הלקוח ב-Fireberry.

## דרישות מערכת

- **Node.js 20+** (מומלץ Node 22)
- **Turso Database** (libSQL)
- חשבון Cardcom פעיל עם הפעלת API
- חשבון Fireberry עם token API

## התקנה

### 1. Clone והתקנת חבילות
```bash
cd C:\DEV\invpower
npm install
```

### 2. יצירת DB ב-Turso
```bash
turso db create invpower
turso db tokens create invpower
turso db show invpower --url
```

### 3. הגדרת `.env`
העתק את `.env.example` ל-`.env` ועדכן:
```env
TURSO_DATABASE_URL="libsql://invpower-<your-org>.turso.io"
TURSO_AUTH_TOKEN="<token>"

SESSION_SECRET="<openssl rand -base64 32>"
SETTINGS_ENC_KEY="<openssl rand -hex 32>"

INITIAL_ADMIN_EMAIL="topcredit99@gmail.com"
INITIAL_ADMIN_PASSWORD="Zzxx2233"
```

### 4. העלאת סכימה ל-Turso
```bash
npm run db:generate    # מייצר קבצי migration ב-drizzle/
npm run db:migrate     # מריץ אותם על Turso
```

או, לפיתוח מהיר:
```bash
npm run db:push
```

### 5. יצירת משתמש האדמין הראשון
```bash
npm run db:seed
```

### 6. הפעלת שרת פיתוח
```bash
npm run dev
```
פתח: http://localhost:3000

## הגדרת Credentials של Cardcom + Fireberry

1. התחבר עם משתמש האדמין
2. עבור ל-**הגדרות** (`/admin/settings`)
3. הזן:
   - **Cardcom**: Terminal Number, API Name, API Password
   - **Fireberry**: Token

> כל הסודות נשמרים מוצפנים (AES-256-GCM) ב-Turso.

## זרימת עבודה יומית

1. **הורד מהבנק** קובץ Excel של תנועות (XLSX/XLSM)
2. ב-**דאשבורד** → "העלה Excel" — מערכת תזהה אוטומטית את טווח התאריכים
3. לחץ **"סנכרן Fireberry"** — שליפת כל הרכישות (`accountproduct`) מהמערכת לטווח התאריכים, כולל העשרה אוטומטית של ת.ז./טלפון מאובייקט Account
4. לחץ **"סנכרן Cardcom"** — שליפת כל החשבוניות הקיימות (Documents/GetReport, DocType=1)
5. הטבלה תציג לכל שורת בנק:
   - **שם בנק** + סכום + אסמכתא
   - **התאמה ב-Fireberry** — רכישה(ות) עם **שם דומה (≥60%) + סכום זהה מדויק**
   - **סטטוס** — הופק / חלקי / קיים ב-Cardcom / ממתין / ללא match
6. סמן את ההצעות הנכונות (אם יש מספר הצעות — הרחב לבחירה ברדיו), לחץ **"הפק חשבוניות"**

### מה קורה בהפקה
1. POST ל-Cardcom: `/api/v11/Invoice/CreateTaxInvoice` עם:
   - `InvoiceType: 3`
   - `InvoiceHead`: CustName, CompID (ת.ז.), CustMobilePH, AccountForeignKey (accountid מ-Fireberry)
   - `InvoiceLines[0]`: Description = שם המוצר מ-Fireberry, Price = סכום מהבנק
   - `CustomPay[0]`: Description = "העברה בנקאית" (מדויק!), Sum, Asmachta, DateCheque
2. Cardcom מחזיר: `InvoiceNumber`, `InvoiceLink` (URL ל-PDF), `AccountID`
3. הורדת PDF מה-`InvoiceLink`
4. POST ל-Fireberry `/api/file` — צירוף ה-PDF לרשומת account
5. שמירה ב-`issued_invoices`

> **חשוב:** אין יצירת `customobject1004` ב-Fireberry, אין עדכון `pcfsystemfield147`. רק חשבונית ב-Cardcom + העלאת PDF.

### מה קורה בתקלה?
- **Cardcom נכשל** → לא נוצר כלום, מתועדת התראה
- **Cardcom הצליח אבל Fireberry נכשל** → סטטוס "חלקי", מתועדת התראה — הטיפול ידני
- **רכישה ללא accountId** → "skipped" + התראה
- **Cardcom לא החזיר InvoiceLink** → "skipped" + התראה

כל ההתראות מופיעות ב-`/admin/alerts`.

## ניהול משתמשים

ב-`/admin/users` — האדמין יכול:
- ליצור משתמש חדש (אימייל + סיסמה)
- להגדיר תפקיד (`admin` / `user`)
- להפעיל/להשבית משתמש
- לאפס סיסמה

## מבנה תיקיות

```
src/
├── app/
│   ├── (app)/                  # מסכים מאחורי auth
│   │   ├── dashboard/          # מסך ראשי
│   │   └── admin/              # users, alerts, settings
│   ├── api/
│   │   ├── auth/               # login, logout, me
│   │   ├── bank/upload/        # פרסור והעלאת Excel
│   │   ├── fireberry/sync-purchases/   # שליפת רכישות
│   │   ├── invoices/           # check, sync (Cardcom), create
│   │   └── admin/              # users, alerts, settings
│   ├── login/
│   ├── layout.tsx              # RTL Hebrew
│   └── globals.css
├── components/
├── lib/
│   ├── db/                     # Drizzle schema + client
│   ├── auth/                   # iron-session
│   ├── parsers/                # bank Excel parser
│   ├── cardcom/                # CreateTaxInvoice + GetReport + PDF
│   ├── fireberry/              # fetch purchases + upload PDF
│   ├── match/                  # name fuzzy + exact amount
│   ├── invoices/               # duplicate detection
│   ├── alerts/
│   ├── settings/               # encrypted settings store
│   └── crypto.ts               # AES-256-GCM
└── middleware.ts               # auth gating
```

## ארכיטקטורה

- **Frontend:** Next.js 15 App Router + React 19 + Tailwind
- **Backend:** Next.js API Routes (Node runtime)
- **DB:** Turso (libSQL) via Drizzle ORM
- **Auth:** iron-session (cookie-based, "remember me" → 30d)
- **Encryption:** AES-256-GCM לסודות API

## Build לפרודקשן

```bash
npm run build
npm start
```

## טיפים

- אם הפקה נכשלת באמצע — רענן את הדאשבורד; הסטטוס יישקף את המצב לפי DB
- בכל שינוי credentials — לחץ "סנכרן Cardcom" כדי לוודא שהאישור עובד
- העלאת Excel זהה פעמיים — תזוהה אוטומטית כפילות (sha256 של הקובץ)
