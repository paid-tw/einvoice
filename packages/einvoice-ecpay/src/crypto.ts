import { createCipheriv, createDecipheriv } from "node:crypto";

/**
 * ECPay B2C 電子發票 2.0 crypto. The `Data` field is built as
 * `JSON → PHP urlencode → AES-128-CBC (PKCS7) → Base64`, and decoded in
 * reverse. The PHP url(en|de)code semantics matter: a space is `+` (not `%20`),
 * which the standard JS helpers don't do — hence the wrappers below.
 */

/** PHP `urlencode`: like encodeURIComponent but space → `+` and `!'()*~` encoded. */
export function phpUrlEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, "+");
}

/** PHP `urldecode`: `+` → space, then percent-decode. */
export function phpUrlDecode(value: string): string {
  return decodeURIComponent(value.replace(/\+/g, " "));
}

/** Fail fast with a clear message if the AES-128 key/IV aren't 16 bytes. */
function assertKeyIv(hashKey: string, hashIV: string): void {
  const k = Buffer.byteLength(hashKey, "utf8");
  const v = Buffer.byteLength(hashIV, "utf8");
  if (k !== 16) throw new Error(`ECPay hashKey must be 16 bytes (AES-128-CBC), got ${k}`);
  if (v !== 16) throw new Error(`ECPay hashIV must be 16 bytes, got ${v}`);
}

/** AES-128-CBC encrypt (PKCS7) → Base64. Key + IV are 16-byte ASCII strings. */
export function aesEncrypt(plaintext: string, hashKey: string, hashIV: string): string {
  assertKeyIv(hashKey, hashIV);
  const cipher = createCipheriv("aes-128-cbc", hashKey, hashIV);
  return Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]).toString("base64");
}

/** AES-128-CBC decrypt (PKCS7) from Base64. */
export function aesDecrypt(base64: string, hashKey: string, hashIV: string): string {
  assertKeyIv(hashKey, hashIV);
  const decipher = createDecipheriv("aes-128-cbc", hashKey, hashIV);
  return Buffer.concat([
    decipher.update(Buffer.from(base64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Encode a request `Data` payload: object → urlencoded JSON → AES → Base64. */
export function encryptData(data: unknown, hashKey: string, hashIV: string): string {
  return aesEncrypt(phpUrlEncode(JSON.stringify(data)), hashKey, hashIV);
}

/** Decode a response `Data` payload: Base64 → AES → urldecode → JSON. */
export function decryptData<T = Record<string, unknown>>(
  base64: string,
  hashKey: string,
  hashIV: string,
): T {
  return JSON.parse(phpUrlDecode(aesDecrypt(base64, hashKey, hashIV))) as T;
}
