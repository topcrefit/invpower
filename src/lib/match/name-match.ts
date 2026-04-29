/**
 * נירמול שם לקוח לצורך השוואה: הסרת רווחים מיותרים, סימני פיסוק,
 * אותיות סופיות עבריות → רגילות, lowercase.
 */
export function normalizeName(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/[\u05B0-\u05C7]/g, "") // ניקוד
    .replace(/[״"׳'`,.\-_/\\]/g, " ")
    .replace(/ך/g, "כ")
    .replace(/ם/g, "מ")
    .replace(/ן/g, "נ")
    .replace(/ף/g, "פ")
    .replace(/ץ/g, "צ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Levenshtein — מרחק עריכה.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

/**
 * דומות 0..1 בין שני שמות. קודם בודקת containment (מלא/חלקי),
 * אחר כך מחשבת token overlap, ולבסוף Levenshtein-based ratio.
 */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  // Containment full
  if (na.includes(nb) || nb.includes(na)) return 0.95;

  // Token overlap
  const ta = new Set(na.split(" ").filter((t) => t.length > 1));
  const tb = new Set(nb.split(" ").filter((t) => t.length > 1));
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  const tokenScore = union === 0 ? 0 : inter / union;
  if (tokenScore >= 0.5) {
    // Boost if at least one full token matches AND lengths are close
    return Math.min(0.9, 0.6 + tokenScore * 0.4);
  }

  // Levenshtein-based ratio
  const lev = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  const lr = 1 - lev / maxLen;
  return lr;
}

const AMOUNT_TOLERANCE = 0.005;

export function amountsEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= AMOUNT_TOLERANCE;
}

export type MatchScore = {
  amountMatch: boolean;
  nameSimilarity: number;
  reason: string;
};

/**
 * דירוג של רכישה מ-Fireberry מול תנועה בנקאית.
 * חזק רק כש: סכום מדויק + שם דומה ≥ 0.6 (מתחת לזה — לא מציגים בכלל).
 */
export function scoreMatch(
  bankAmount: number,
  bankName: string | null,
  fbAmount: number | null,
  fbName: string | null
): MatchScore | null {
  if (fbAmount == null) return null;
  if (!amountsEqual(bankAmount, fbAmount)) return null;
  const sim = nameSimilarity(bankName ?? "", fbName ?? "");
  if (sim < 0.6) return null;
  return {
    amountMatch: true,
    nameSimilarity: sim,
    reason:
      sim >= 0.95
        ? "סכום זהה + שם זהה/מכיל"
        : sim >= 0.8
          ? "סכום זהה + שם דומה מאוד"
          : "סכום זהה + שם דומה חלקי",
  };
}
