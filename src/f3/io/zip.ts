// ZIP archives with fflate (https://github.com/101arrowz/fflate, MIT): text files deflated, files that are
// compressed already (GLB, PNG, JPEG, WebP, KTX2) stored as they are, every file with the same modification
// time so the same input gives the same bytes. CRC-32 kept here for the tests that check archives.
import { unzipSync, zipSync, type Zippable } from 'fflate';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** Path inside the archive, with forward slashes. */
  name: string;
  data: Uint8Array | string;
}

const PACKED = /\.(glb|png|jpe?g|webp|ktx2|zip)$/i;

/** The archive bytes. `when` is the modification time written for every file (fixed → same bytes). */
export function zipStore(entries: ZipEntry[], when = new Date(2026, 0, 1)): Uint8Array {
  const enc = new TextEncoder();
  const files: Zippable = {};
  for (const e of entries) {
    const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    files[e.name.replace(/\\/g, '/')] =[data, { level: PACKED.test(e.name) ? 0 : 6, mtime: when }];
  }
  return zipSync(files, { mtime: when });
}

/** Reads an archive back (names and bytes, in the archive's order). */
export function unzipStore(buf: Uint8Array): { name: string; data: Uint8Array }[] {
  return Object.entries(unzipSync(buf)).map(([name, data]) => ({ name, data }));
}
