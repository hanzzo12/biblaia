// მინიმალური PDF ჩამწერი: ერთი გვერდი, TrueType ფონტები (Type0 / Identity-H) ToUnicode-ით — ტექსტი მოინიშნება და კოპირდება.
const isGeorgian = (cp) => (cp >= 0x10a0 && cp <= 0x10ff) || (cp >= 0x1c90 && cp <= 0x1cbf) || (cp >= 0x2d00 && cp <= 0x2d2f);
const SUBST = { 0x2116: 'N', 0x2009: ' ', 0x00a0: ' ', 0x202f: ' ' };
const enc = new TextEncoder();

export class PdfPage {
  /** @param {{ geo:any, geoBold:any, lat:any, latBold:any }} fonts @param {number} w @param {number} h */
  constructor(fonts, w, h) {
    this.w = w; this.h = h; this.ops = [];
    this.fonts = [fonts.geo, fonts.lat, fonts.geoBold, fonts.latBold].map((f, i) => ({ f, key: `F${i + 1}`, used: new Map() }));
  }
  /** სიმბოლოების დაყოფა ფონტების მიხედვით */
  runs(text, bold) {
    const [g, l] = bold ? [this.fonts[2], this.fonts[3]] : [this.fonts[0], this.fonts[1]];
    const out = [];
    for (const ch of String(text)) {
      let cp = ch.codePointAt(0);
      if (SUBST[cp]) cp = SUBST[cp].codePointAt(0);
      let F = isGeorgian(cp) ? g : l;
      let gid = F.f.cmap.get(cp);
      if (!gid) { const alt = F === g ? l : g; gid = alt.f.cmap.get(cp); if (gid) F = alt; }
      if (!gid) { F = l; cp = 0x3f; gid = l.f.cmap.get(cp) || 0; }
      const last = out[out.length - 1];
      const item = { gid, cp };
      if (last && last.F === F) last.items.push(item); else out.push({ F, items: [item] });
    }
    return out;
  }
  width(text, size, bold = false) {
    let w = 0;
    for (const r of this.runs(text, bold)) for (const it of r.items) w += (r.F.f.adv[it.gid] * size) / r.F.f.upem;
    return w;
  }
  /** სიტყვებით გადატანა */
  wrap(text, size, maxW, bold = false) {
    const lines = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        const t = line ? `${line} ${word}` : word;
        if (this.width(t, size, bold) <= maxW || !line) line = t; else { lines.push(line); line = word; }
      }
      lines.push(line);
    }
    return lines;
  }
  color(c) { return c.map((x) => (x / 255).toFixed(3)).join(' '); }
  text(str, x, y, { size = 10, bold = false, color = [30, 41, 59], align = 'left' } = {}) {
    if (str == null || str === '') return;
    const w = this.width(str, size, bold);
    const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    let ops = `BT ${this.color(color)} rg ${x0.toFixed(2)} ${(this.h - y).toFixed(2)} Td `;
    for (const r of this.runs(str, bold)) {
      let hex = '';
      for (const it of r.items) { hex += it.gid.toString(16).padStart(4, '0'); if (!r.F.used.has(it.gid)) r.F.used.set(it.gid, it.cp); }
      ops += `/${r.F.key} ${size} Tf <${hex}> Tj `;
    }
    this.ops.push(ops + 'ET');
    return w;
  }
  /** მრავალხაზიანი ტექსტი; აბრუნებს ბოლო y-ს */
  para(str, x, y, maxW, opts = {}) {
    const size = opts.size ?? 10; const lh = opts.lineHeight ?? size * 1.35;
    for (const line of this.wrap(str, size, maxW, opts.bold)) { this.text(line, x, y, opts); y += lh; }
    return y;
  }
  rect(x, y, w, h, fill, radius = 0) {
    const Y = this.h - y - h;
    if (!radius) { this.ops.push(`${this.color(fill)} rg ${x.toFixed(2)} ${Y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`); return; }
    const r = Math.min(radius, w / 2, h / 2), k = r * 0.5523;
    const p = (a, b) => `${a.toFixed(2)} ${b.toFixed(2)}`;
    this.ops.push(`${this.color(fill)} rg ${p(x + r, Y)} m ${p(x + w - r, Y)} l ${p(x + w - r + k, Y)} ${p(x + w, Y + r - k)} ${p(x + w, Y + r)} c ${p(x + w, Y + h - r)} l ${p(x + w, Y + h - r + k)} ${p(x + w - r + k, Y + h)} ${p(x + w - r, Y + h)} c ${p(x + r, Y + h)} l ${p(x + r - k, Y + h)} ${p(x, Y + h - r + k)} ${p(x, Y + h - r)} c ${p(x, Y + r)} l ${p(x, Y + r - k)} ${p(x + r - k, Y)} ${p(x + r, Y)} c f`);
  }
  line(x1, y1, x2, y2, color = [226, 232, 240], width = 0.7) {
    this.ops.push(`${this.color(color)} RG ${width} w ${x1.toFixed(2)} ${(this.h - y1).toFixed(2)} m ${x2.toFixed(2)} ${(this.h - y2).toFixed(2)} l S`);
  }

  /** @returns {Uint8Array} */
  toBytes(title) {
    const objs = [];
    const add = (body) => { objs.push(body); return objs.length; };
    const ref = (n) => `${n} 0 R`;
    const catalog = add(null); const pages = add(null); const page = add(null);
    const fontRefs = [];
    for (const F of this.fonts) {
      if (!F.used.size) continue;
      const f = F.f; const s = 1000 / f.upem;
      const file = add({ stream: f.ttf, dict: `/Length1 ${f.ttf.length}` });
      const desc = add(`<< /Type /FontDescriptor /FontName /${f.name} /Flags 32 /FontBBox [${f.bbox.map((v) => Math.round(v * s)).join(' ')}] /ItalicAngle 0 /Ascent ${Math.round(f.ascent * s)} /Descent ${Math.round(f.descent * s)} /CapHeight ${Math.round(f.ascent * s)} /StemV 80 /FontFile2 ${ref(file)} >>`);
      const gids = [...F.used.keys()].sort((a, b) => a - b);
      const W = gids.map((g) => `${g} [${Math.round(f.adv[g] * s)}]`).join(' ');
      const cid = add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${f.name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${ref(desc)} /W [${W}] /CIDToGIDMap /Identity >>`);
      const bf = gids.map((g) => `<${g.toString(16).padStart(4, '0')}> <${utf16hex(F.used.get(g))}>`);
      let cmap = '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange\n';
      for (let i = 0; i < bf.length; i += 100) { const chunk = bf.slice(i, i + 100); cmap += `${chunk.length} beginbfchar\n${chunk.join('\n')}\nendbfchar\n`; }
      cmap += 'endcmap CMapName currentdict /CMap defineresource pop end end';
      const tu = add({ stream: enc.encode(cmap), dict: '' });
      const t0 = add(`<< /Type /Font /Subtype /Type0 /BaseFont /${f.name} /Encoding /Identity-H /DescendantFonts [${ref(cid)}] /ToUnicode ${ref(tu)} >>`);
      fontRefs.push(`/${F.key} ${ref(t0)}`);
    }
    const content = add({ stream: enc.encode(this.ops.join('\n')), dict: '' });
    const info = add(`<< /Title <${utf16hexStr(title)}> /Producer (rotation-calculator) >>`);
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${ref(pages)} /Lang (ka) >>`;
    objs[pages - 1] = `<< /Type /Pages /Kids [${ref(page)}] /Count 1 >>`;
    objs[page - 1] = `<< /Type /Page /Parent ${ref(pages)} /MediaBox [0 0 ${this.w} ${this.h}] /Resources << /Font << ${fontRefs.join(' ')} >> >> /Contents ${ref(content)} >>`;
    const chunks = [enc.encode('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n')];
    let pos = chunks[0].length;
    const offsets = [];
    objs.forEach((o, i) => {
      offsets.push(pos);
      const parts = [];
      if (typeof o === 'string') parts.push(enc.encode(`${i + 1} 0 obj\n${o}\nendobj\n`));
      else { parts.push(enc.encode(`${i + 1} 0 obj\n<< /Length ${o.stream.length} ${o.dict} >>\nstream\n`), o.stream, enc.encode('\nendstream\nendobj\n')); }
      for (const p of parts) { chunks.push(p); pos += p.length; }
    });
    let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) xref += `${String(o).padStart(10, '0')} 00000 n \n`;
    xref += `trailer\n<< /Size ${objs.length + 1} /Root ${ref(catalog)} /Info ${ref(info)} >>\nstartxref\n${pos}\n%%EOF\n`;
    chunks.push(enc.encode(xref));
    const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
    let k = 0; for (const c of chunks) { out.set(c, k); k += c.length; }
    return out;
  }
}

function utf16hex(cp) {
  if (cp > 0xffff) { const v = cp - 0x10000; return ((0xd800 + (v >> 10)).toString(16) + (0xdc00 + (v & 0x3ff)).toString(16)).padStart(8, '0'); }
  return cp.toString(16).padStart(4, '0');
}
function utf16hexStr(s) { let out = 'feff'; for (const ch of String(s)) out += utf16hex(ch.codePointAt(0)); return out; }

export function downloadBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
