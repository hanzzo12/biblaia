// Secret hygiene: Apify token prefix must not appear in source, docs, tests, build output or release archives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const ROOT = new URL('../../', import.meta.url).pathname;
const NEEDLE = ['apify', '_api_'].join('');
const SKIP = new Set(['node_modules', '.git', '.wrangler', '.wrangler-dry', 'test-results']);

function* files(dir) {
  if (!existsSync(dir)) return;
  for (const n of readdirSync(dir)) {
    if (SKIP.has(n) || n === '.dev.vars' || n.startsWith('.env')) continue;
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) yield* files(p); else if (st.size < 50_000_000) yield p;
  }
}
/** Minimal ZIP scan: inflate each local entry (stored or deflate) and search it. */
function zipContains(buf, needle) {
  let o = 0;
  while ((o = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), o)) !== -1) {
    const method = buf.readUInt16LE(o + 8); const size = buf.readUInt32LE(o + 18);
    const nlen = buf.readUInt16LE(o + 26); const xlen = buf.readUInt16LE(o + 28);
    const start = o + 30 + nlen + xlen; const data = buf.subarray(start, start + size);
    try { const txt = method === 8 ? inflateRawSync(data) : data; if (txt.includes(needle)) return true; } catch { /* ignore */ }
    o = start;
  }
  return false;
}

test('no Apify token prefix in repository files, dist/ or release/ (incl. zips)', () => {
  const hits = [];
  for (const d of ['src', 'worker', 'scripts', 'docs', 'tests', 'dist', 'release', 'sources/extracted']) {
    for (const f of files(join(ROOT, d))) {
      const buf = readFileSync(f);
      if (f.endsWith('.zip') ? zipContains(buf, NEEDLE) : buf.includes(NEEDLE)) hits.push(f.slice(ROOT.length));
    }
  }
  for (const f of ['wrangler.jsonc', '.dev.vars.example', 'package.json']) if (existsSync(join(ROOT, f)) && readFileSync(join(ROOT, f)).includes(NEEDLE)) hits.push(f);
  assert.deepEqual(hits, []);
});

test('.dev.vars is git-ignored', () => {
  const gi = readFileSync(join(ROOT, '.gitignore'), 'utf8');
  assert.match(gi, /^\.dev\.vars$/m);
});
