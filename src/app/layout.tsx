import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "InvPower — הפקת חשבוניות מס-קבלה",
  description: "הפקה אוטומטית של חשבוניות מס-קבלה מ-Excel בנקאי לקארדקום",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
