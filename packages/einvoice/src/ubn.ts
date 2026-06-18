/**
 * Taiwan 統一編號 (UBN — Unified Business Number) validation. A standalone,
 * provider-agnostic primitive.
 *
 * Terminology: "Unified Business Number (UBN)" is the official English used by
 * Taiwan's open-data platform and national standards for the 8-digit business
 * 統一編號. It is NOT a 稅籍編號 (tax registration number) — those are different
 * systems. (Amego's API and some MOF forms call it `ban`; that term is kept only
 * at the Amego wire boundary.)
 *
 * Algorithm (財政部「營利事業統一編號檢查碼邏輯修正說明」): multiply each of the 8
 * digits by the weights [1,2,1,2,1,2,4,1], sum the digit-sums of each product,
 * and the total must be divisible by 5 (the post-2023 revision; the legacy rule
 * was divisible by 10). Special case: when the 7th digit is "7", a +1 on the
 * total is also accepted (the official「倒數第二位取 0 或 1」rule).
 */

const UBN_WEIGHTS = [1, 2, 1, 2, 1, 2, 4, 1] as const;

export interface UbnOptions {
  /**
   * Use the legacy "divisible by 10" rule instead of the current "divisible by
   * 5". Default `false`. Numbers released since 2023 only satisfy ÷5.
   */
  legacy?: boolean;
}

/**
 * Validate a Taiwan 統一編號 (8-digit UBN) including its checksum. Accepts a
 * string or number; anything else (or wrong length / non-digit) is `false`.
 */
export function isValidUbn(input: string | number, options: UbnOptions = {}): boolean {
  if (typeof input !== "string" && typeof input !== "number") return false;
  const n = String(input);
  if (!/^\d{8}$/.test(n)) return false;

  let checksum = 0;
  for (let i = 0; i < 8; i++) {
    const product = Number(n[i]) * UBN_WEIGHTS[i]!;
    checksum += (product % 10) + Math.floor(product / 10);
  }

  const divisor = options.legacy ? 10 : 5;
  return checksum % divisor === 0 || (n.charAt(6) === "7" && (checksum + 1) % divisor === 0);
}
