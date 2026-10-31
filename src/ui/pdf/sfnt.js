// მინიმალური WOFF → TrueType გარდაქმნა და cmap/hmtx/head/hhea წაკითხვა (PDF-ში ჩასაშენებლად).

async function inflate(bytes) {
  const ds = new DecompressionStream('deflate');
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(buf);
}

export async function woffToFont(woff, name) {
  const dv = new DataView(woff.buffer, woff.byteOffset, woff.byteLength);
  if (dv.getUint32(0) !== 0x774f4646) throw new Error('not a WOFF font');
  const flavor = dv.getUint32(4);
  const numTables = dv.getUint16(12);
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const o = 44 + i * 20;
    const tag = String.fromCharCode(woff[o], woff[o + 1], woff[o + 2], woff[o + 3]);
    const offset = dv.getUint32(o + 4), compLength = dv.getUint32(o + 8), origLength = dv.getUint32(o + 12), checksum = dv.getUint32(o + 16);
    const raw = woff.subarray(offset, offset + compLength);
    const data = compLength < origLength ? await inflate(raw) : raw.slice();
    tables.push({ tag, checksum, data });
  }
  tables.sort((a, b) => (a.tag < b.tag ? -1 : 1));
  // sfnt
  let size = 12 + 16 * numTables;
  for (const t of tables) size += (t.data.length + 3) & ~3;
  const ttf = new Uint8Array(size);
  const tv = new DataView(ttf.buffer);
  tv.setUint32(0, flavor); tv.setUint16(4, numTables);
  let es = 0; while ((1 << (es + 1)) <= numTables) es++;
  tv.setUint16(6, (1 << es) * 16); tv.setUint16(8, es); tv.setUint16(10, numTables * 16 - (1 << es) * 16);
  let off = 12 + 16 * numTables;
  tables.forEach((t, i) => {
    const r = 12 + i * 16;
    for (let k = 0; k < 4; k++) ttf[r + k] = t.tag.charCodeAt(k);
    tv.setUint32(r + 4, t.checksum); tv.setUint32(r + 8, off); tv.setUint32(r + 12, t.data.length);
    ttf.set(t.data, off);
    t.offset = off;
    off += (t.data.length + 3) & ~3;
  });
  const T = Object.fromEntries(tables.map((t) => [t.tag, new DataView(t.data.buffer, t.data.byteOffset, t.data.byteLength)]));
  const head = T.head, hhea = T.hhea, hmtx = T.hmtx, maxp = T.maxp;
  const upem = head.getUint16(18);
  const bbox = [head.getInt16(36), head.getInt16(38), head.getInt16(40), head.getInt16(42)];
  const ascent = hhea.getInt16(4), descent = hhea.getInt16(6);
  const nH = hhea.getUint16(34), numGlyphs = maxp.getUint16(4);
  const adv = new Uint16Array(numGlyphs);
  for (let g = 0; g < numGlyphs; g++) adv[g] = hmtx.getUint16(4 * Math.min(g, nH - 1));
  return { name, ttf, upem, bbox, ascent, descent, adv, cmap: readCmap(T.cmap) };
}

function readCmap(c) {
  const map = new Map();
  const n = c.getUint16(2);
  let best = null;
  for (let i = 0; i < n; i++) {
    const pid = c.getUint16(4 + i * 8), eid = c.getUint16(6 + i * 8), off = c.getUint32(8 + i * 8);
    const fmt = c.getUint16(off);
    if (fmt === 12 && (pid === 3 || pid === 0)) { best = { off, fmt }; break; }
    if (fmt === 4 && ((pid === 3 && eid === 1) || pid === 0)) best = best ?? { off, fmt };
  }
  if (!best) return map;
  const o = best.off;
  if (best.fmt === 4) {
    const segX2 = c.getUint16(o + 6);
    const ends = o + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
    for (let s = 0; s < segX2 / 2; s++) {
      const end = c.getUint16(ends + 2 * s), start = c.getUint16(starts + 2 * s), delta = c.getInt16(deltas + 2 * s), ro = c.getUint16(ranges + 2 * s);
      for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
        let g;
        if (ro === 0) g = (cp + delta) & 0xffff;
        else { const gi = ranges + 2 * s + ro + 2 * (cp - start); g = c.getUint16(gi); if (g) g = (g + delta) & 0xffff; }
        if (g) map.set(cp, g);
      }
    }
  } else {
    const groups = c.getUint32(o + 12);
    for (let i = 0; i < groups; i++) {
      const p = o + 16 + i * 12, s = c.getUint32(p), e = c.getUint32(p + 4), g0 = c.getUint32(p + 8);
      for (let cp = s; cp <= e; cp++) map.set(cp, g0 + cp - s);
    }
  }
  return map;
}
