// Asia/Taipei datetime helpers for the ezReceipt wire format.

/** Parse an ezReceipt datetime ("YYYY-MM-DD HH:mm:ss", Asia/Taipei) → Date. */
export function parseDate(value: unknown): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(value ?? "").trim());
  if (!m) return new Date();
  const [, y, mo, d, hh, mi, ss] = m;
  return new Date(`${y}-${mo}-${d}T${hh}:${mi}:${ss}+08:00`);
}

/**
 * Format a Date as `YYYY-MM-DD HH:mm:ss` in Asia/Taipei (for `invoiceTime`).
 * The `"sv-SE"` locale is intentional — Swedish formats dates ISO-style
 * (`YYYY-MM-DD HH:mm:ss`), the exact shape ezReceipt expects.
 */
export function taipeiDateTime(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace("T", " ");
}
