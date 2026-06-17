/**
 * Taiwan 手機條碼 (mobile barcode carrier, 載具 3J0002) format validation — a
 * standalone, provider-agnostic primitive.
 *
 * Format: a leading "/" followed by exactly 7 characters from
 * `0-9 A-Z . + -` (8 characters total). This only checks the FORMAT; whether a
 * barcode actually exists in the 財政部 system requires a provider lookup
 * (e.g. Amego's `barcode` endpoint).
 */

const MOBILE_BARCODE_RE = /^\/[0-9A-Z.+-]{7}$/;

/** True if `code` is a well-formed 手機條碼 (does not check existence). */
export function isValidMobileBarcode(code: string): boolean {
  return typeof code === "string" && MOBILE_BARCODE_RE.test(code);
}
