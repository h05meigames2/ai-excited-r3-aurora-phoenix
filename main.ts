// Aurora Phoenix Over the Glass Desert — make.fun ai-excited-01 entry.
//
// Deterministic, dependency-free, offline byte copy:
// reads the bundled artwork (entry.png next to this file), verifies it
// (PNG magic, per-chunk CRC, size <= 1 MiB, dimensions <= 1024x1024,
// SHA-256 match), copies the exact bytes to the output directory, then
// re-verifies the written file's SHA-256. No timestamps, no randomness,
// no network — two runs produce byte-identical output.
//
// Usage:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Output directory defaults to /output when MAKEFUN_OUTPUT_DIR is unset.

import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_SHA256 =
  "d3deb5c18c63f749b329167bef85db1b1aa19e0684074ac0ada4a20a0f2b21c3";
const MAX_BYTES = 1024 * 1024;
const MAX_DIMENSION = 1024;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// CRC-32 (IEEE 802.3) table, built once at startup — deterministic.
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function fail(message: string): never {
  throw new Error(`verification failed: ${message}`);
}

// Verify PNG structure: magic bytes, IHDR dimensions, CRC of every chunk.
function verifyPng(buf: Buffer): { width: number; height: number } {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_MAGIC)) {
    fail("bad PNG magic bytes");
  }
  if (buf.length > MAX_BYTES) {
    fail(`file is ${buf.length} bytes, over the 1 MiB limit`);
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let sawIend = false;

  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;
    if (crcEnd > buf.length) {
      fail(`chunk ${type} is truncated`);
    }
    const storedCrc = buf.readUInt32BE(dataEnd);
    const actualCrc = crc32(buf.subarray(offset + 4, dataEnd));
    if (storedCrc !== actualCrc) {
      fail(`chunk ${type} CRC mismatch`);
    }
    if (type === "IHDR") {
      if (length !== 13) fail("IHDR has wrong length");
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      if (width === 0 || height === 0) fail("IHDR has zero dimension");
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        fail(`dimensions ${width}x${height} exceed 1024x1024`);
      }
    }
    if (type === "IEND") {
      sawIend = true;
      break;
    }
    offset = crcEnd;
  }

  if (!sawIend) fail("missing IEND chunk");
  if (width === 0 || height === 0) fail("missing IHDR chunk");
  return { width, height };
}

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const sourcePath = join(here, "entry.png");
  const outputDir = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? "/output");
  const outputPath = join(outputDir, "entry.png");

  const bytes = readFileSync(sourcePath);
  const { width, height } = verifyPng(bytes);
  const hash = sha256(bytes);
  if (hash !== EXPECTED_SHA256) {
    fail(`source SHA-256 mismatch: got ${hash}`);
  }

  mkdirSync(outputDir, { recursive: true });
  copyFileSync(sourcePath, outputPath);

  // Re-verify the written file: same bytes, same hash.
  const written = readFileSync(outputPath);
  if (statSync(outputPath).size !== bytes.length) {
    fail("written file size differs from source");
  }
  const writtenHash = sha256(written);
  if (writtenHash !== EXPECTED_SHA256) {
    fail(`written SHA-256 mismatch: got ${writtenHash}`);
  }

  console.log(`entry.png (${width}x${height}, ${bytes.length} bytes)`);
  console.log(`sha256: ${writtenHash}`);
  console.log(`written to ${outputPath}`);
}

main();
