// onnxruntime-web (wasm) is arch-independent — works on Intel & Apple Silicon &
// Linux alike. (onnxruntime-node 1.27 ships no darwin-x64 binary.)
// jimp is pure-JS (no native libvips like sharp) so there are ZERO native deps;
// its BILINEAR resize also beats sharp/lanczos here (thin "1" strokes survive).
import * as ort from "onnxruntime-web";
import { Jimp, ResizeStrategy } from "jimp";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ctcGreedyDecode, digitsOnly } from "./lib/captcha.ts";

// ddddocr's default OCR model (common_old.onnx) run in the JS/bun runtime — no
// Python. Replicates ddddocr's preprocessing (resize H=64, PIL 'L' grayscale,
// /255) and CTC greedy decode (argmax per timestep, drop repeats + blank idx 0).
// Verified byte-identical to Python ddddocr (31/31) at 87% accuracy.
// The model comes from the ddddocr pip package via scripts/fetch_ocr_model.sh;
// the charset (charset.json) is vendored next to it. Paths resolve relative to
// THIS module (not CWD) so it works from any working directory.
const MODEL = join(import.meta.dir, "ocr-model/ddddocr.onnx");
const CHARSET: string[] = JSON.parse(readFileSync(join(import.meta.dir, "ocr-model/charset.json"), "utf8"));

let _session: ort.InferenceSession | null = null;
async function session() {
  if (!_session) _session = await ort.InferenceSession.create(MODEL);
  return _session;
}

export async function classify(src: string | Buffer): Promise<string> {
  const img = await Jimp.read(src as any);
  const w = img.width, h = img.height;
  const targetW = Math.floor(w * (64 / h));
  img.resize({ w: targetW, h: 64, mode: ResizeStrategy.BILINEAR });
  const data = img.bitmap.data; // RGBA
  // PIL 'L' luma (ITU-R 601-2): L = 0.299R + 0.587G + 0.114B, then /255
  const input = new Float32Array(64 * targetW);
  for (let i = 0; i < 64 * targetW; i++) {
    const r = data[i * 4]!, g = data[i * 4 + 1]!, b = data[i * 4 + 2]!;
    const L = (r * 299 + g * 587 + b * 114) / 1000;
    input[i] = Math.floor(L) / 255;
  }
  const tensor = new ort.Tensor("float32", input, [1, 1, 64, targetW]);
  const sess = await session();
  const out = await sess.run({ [sess.inputNames[0]]: tensor });
  const o = out[sess.outputNames[0]]!;
  const [T, , C] = o.dims as number[]; // (seqlen, 1, num_classes)
  return ctcGreedyDecode(o.data as Float32Array, T!, C!, CHARSET);
}

// CLI: bun run ocr.ts <img> [<img> ...]  (digits-only filter applied)
if (import.meta.main) {
  const files = process.argv.slice(2);
  for (const f of files) {
    console.log(`${f}\t${digitsOnly(await classify(f))}`);
  }
}
