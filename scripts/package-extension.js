// Packages the unpacked extension into dist/tracking-auditor-<version>.zip — a
// real ZIP (deflate) that Chrome's "Load unpacked" (after extract) and the Chrome
// Web Store both accept. Dependency-free: the archive is built with the built-in
// zlib, so `npm run build` needs no install.
//
// Only the runtime files ship. Tests, docs, captures (*.har / tag-assistant*),
// node_modules and the scripts themselves are intentionally excluded — the
// allowlist below is the single source of truth for what goes in the bundle.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const version = manifest.version;

// Runtime files, relative to the repo root. lib/*.js is expanded automatically so
// a new provider module is never forgotten.
const files = [
  'manifest.json',
  'devtools.html',
  'devtools.js',
  'panel.html',
  'panel.js',
  'popup.html',
  'background.js',
  'icon-16.png', 'icon-32.png', 'icon-48.png', 'icon-128.png',
  ...readdirSync(join(root, 'lib')).filter((f) => f.endsWith('.js')).map((f) => `lib/${f}`),
];

// --- minimal ZIP writer (store/deflate, no deps) ---------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Fixed DOS timestamp (1980-01-01 00:00) keeps builds byte-for-byte reproducible.
const DOS_TIME = 0;
const DOS_DATE = 0x21;

function buildZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const stored = deflateRawSync(e.data, { level: 9 });
    const crc = crc32(e.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);   // local file header signature
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0, 6);            // flags
    local.writeUInt16LE(8, 8);            // method: deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);           // extra len
    locals.push(local, nameBuf, stored);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);      // central directory signature
    cd.writeUInt16LE(20, 4);              // version made by
    cd.writeUInt16LE(20, 6);              // version needed
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(DOS_TIME, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(stored.length, 20);
    cd.writeUInt32LE(e.data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);              // extra
    cd.writeUInt16LE(0, 32);              // comment
    cd.writeUInt16LE(0, 34);              // disk start
    cd.writeUInt16LE(0, 36);              // internal attrs
    cd.writeUInt32LE(0, 38);              // external attrs
    cd.writeUInt32LE(offset, 42);         // local header offset
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + stored.length;
  }

  const centralBuf = Buffer.concat(central);
  const localBuf = Buffer.concat(locals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);       // end of central directory
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(localBuf.length, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([localBuf, centralBuf, end]);
}

// --- run -------------------------------------------------------------------

const entries = files.map((rel) => {
  const abs = join(root, rel);
  if (!existsSync(abs)) {
    console.error(`✗ missing file: ${rel}`);
    process.exit(1);
  }
  return { name: rel.replace(/\\/g, '/'), data: readFileSync(abs) };
});

const distDir = join(root, 'dist');
mkdirSync(distDir, { recursive: true });
const outPath = join(distDir, `tracking-auditor-${version}.zip`);
const zip = buildZip(entries);
writeFileSync(outPath, zip);

const kb = (zip.length / 1024).toFixed(1);
console.log(`Packed ${entries.length} files → dist/tracking-auditor-${version}.zip (${kb} KB)`);
for (const e of entries) console.log(`  • ${e.name}`);
