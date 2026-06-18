import { createCipheriv, createDecipheriv, createHash } from "node:crypto";

/**
 * ezPay request crypto. The `PostData_` field is the form-urlencoded params,
 * AES-256-CBC encrypted with the merchant's HashKey (32 bytes) + HashIV (16
 * bytes), then lowercase-hex encoded. Padding is PKCS7 to a 32-byte multiple
 * (ezPay's convention — NOT the usual 16), applied manually with no cipher
 * padding. Responses are plaintext JSON, so only the request is encrypted.
 */

const BLOCK = 32;

/** Build the `http_build_query`-style string (x-www-form-urlencoded, `+` for spaces). */
export function buildQuery(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    qs.append(k, String(v));
  }
  return qs.toString();
}

/** PKCS7 pad to a multiple of `BLOCK` (ezPay uses 32). */
function pkcs7Pad(data: Buffer): Buffer {
  const pad = BLOCK - (data.length % BLOCK);
  return Buffer.concat([data, Buffer.alloc(pad, pad)]);
}

/** Fail fast with a clear message if the AES-256 key/IV aren't 32/16 bytes. */
function assertKeyIv(hashKey: string, hashIV: string): void {
  const k = Buffer.byteLength(hashKey, "utf8");
  const v = Buffer.byteLength(hashIV, "utf8");
  if (k !== 32) throw new Error(`ezPay HashKey must be 32 bytes (AES-256-CBC), got ${k}`);
  if (v !== 16) throw new Error(`ezPay HashIV must be 16 bytes, got ${v}`);
}

/** Encrypt a params object into the `PostData_` hex string. */
export function encryptPostData(
  params: Record<string, string | number | undefined>,
  hashKey: string,
  hashIV: string,
): string {
  assertKeyIv(hashKey, hashIV);
  const padded = pkcs7Pad(Buffer.from(buildQuery(params), "utf8"));
  const cipher = createCipheriv("aes-256-cbc", Buffer.from(hashKey, "utf8"), Buffer.from(hashIV, "utf8"));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString("hex");
}

/** Decrypt a `PostData_` hex string (mainly for tests / debugging). */
export function decryptPostData(hex: string, hashKey: string, hashIV: string): string {
  assertKeyIv(hashKey, hashIV);
  const decipher = createDecipheriv("aes-256-cbc", Buffer.from(hashKey, "utf8"), Buffer.from(hashIV, "utf8"));
  decipher.setAutoPadding(false);
  const out = Buffer.concat([decipher.update(Buffer.from(hex, "hex")), decipher.final()]);
  // strip PKCS7
  return out.subarray(0, out.length - out[out.length - 1]!).toString("utf8");
}

/**
 * The response CheckCode: SHA256 over the 5 result fields sorted A–Z, wrapped by
 * `HashIV=…&` (front) and `&HashKey=…` (back), uppercased. Used to verify an
 * issue response wasn't tampered with.
 */
export function makeCheckCode(
  fields: {
    MerchantID: string;
    MerchantOrderNo: string;
    InvoiceTransNo: string;
    TotalAmt: string | number;
    RandomNum: string;
  },
  hashKey: string,
  hashIV: string,
): string {
  const sorted = (Object.keys(fields) as Array<keyof typeof fields>).sort();
  const qs = new URLSearchParams();
  for (const k of sorted) qs.append(k, String(fields[k]));
  const raw = `HashIV=${hashIV}&${qs.toString()}&HashKey=${hashKey}`;
  return createHash("sha256").update(raw).digest("hex").toUpperCase();
}

/**
 * The `CheckValue` for the 手機條碼/愛心碼驗證 API: SHA256 over the *encrypted*
 * PostData_ hex wrapped by `HashKey=…&` (front) and `&HashIV=…` (back),
 * uppercased. Note the wrap order is the reverse of {@link makeCheckCode}.
 */
export function makeCheckValue(postDataHex: string, hashKey: string, hashIV: string): string {
  const raw = `HashKey=${hashKey}&${postDataHex}&HashIV=${hashIV}`;
  return createHash("sha256").update(raw).digest("hex").toUpperCase();
}
