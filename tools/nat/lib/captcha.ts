// Pure CTC greedy decode for ddddocr's CRNN output — no model/deps, unit-testable.

/**
 * Greedy CTC decode of a (T, 1, C) logit tensor laid out row-major in `data`.
 * Per timestep: argmax over C classes; then drop consecutive repeats and the
 * blank class (index 0), mapping surviving indices through `charset`.
 */
export function ctcGreedyDecode(
  data: Float32Array | number[],
  T: number,
  C: number,
  charset: readonly string[],
): string {
  let prev = -1;
  let res = "";
  for (let t = 0; t < T; t++) {
    let best = 0;
    let bestVal = -Infinity;
    const base = t * C;
    for (let c = 0; c < C; c++) {
      const v = data[base + c]!;
      if (v > bestVal) { bestVal = v; best = c; }
    }
    if (best !== prev && best !== 0) res += charset[best] ?? "";
    prev = best;
  }
  return res;
}

/** Keep only digits — NAT captcha answers are 5 digits. */
export const digitsOnly = (s: string): string => s.replace(/\D/g, "");
