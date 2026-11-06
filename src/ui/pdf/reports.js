// ერთგვერდიანი PDF ანგარიშები (შედეგი — A4 პორტრეტი; შედარება — A4 ლანდშაფტი). ტექსტი რჩება ტექსტად.
import { PdfPage, downloadBytes } from './writer.js';
import { loadPdfFonts } from './fonts.js';
import { formatAmount } from '../../core/index.js';

const INK = [30, 41, 59], MUTED = [100, 116, 139], ACCENT = [79, 70, 229], SOFT = [241, 243, 249], LINE = [226, 232, 240], WHITE = [255, 255, 255];
const DISCLAIMER = 'საინფორმაციო გაანგარიშება — არ წარმოადგენს ოფიციალურ ფინანსურ დოკუმენტს.';
const today = () => new Date().toISOString().slice(0, 10);

/** ერთი გვერდი: თუ არ ეტევა, შრიფტის მასშტაბი მცირდება, სანამ ჩაეტევა. */
export async function resultPdf(M) {
  const fonts = await loadPdfFonts();
  for (const k of [1, 0.94, 0.88, 0.82, 0.76, 0.7]) {
    const { p, overflow } = drawResult(fonts, M, k);
    if (!overflow || k === 0.7) return p.toBytes('როტაციის კალკულატორი — შედეგი');
  }
}

function drawResult(fonts, M, k) {
  const W = 595.28, H = 841.89, X = 42, CW = W - 2 * X, BOTTOM = H - 44;
  const p = new PdfPage(fonts, W, H);
  const fs = (n) => n * k;
  let y = 46;
  /** ლეიბლი მარცხნივ (გადატანით), მნიშვნელობა მარჯვნივ — არასოდეს გადაფარავს */
  const row = (label, value, o = {}) => {
    const size = fs(o.size ?? 8.6); const lh = size * 1.32;
    const val = String(value ?? '—');
    const vW = p.width(val, size, true);
    const lx = X + (o.indent ?? 0);
    const lw = Math.max(60, W - X - vW - 14 - lx);
    const lines = p.wrap(String(label), size, lw, !!o.bold);
    if (o.sign) p.text(o.sign, X + 2, y, { size, bold: true, color: MUTED });
    lines.forEach((ln, i) => p.text(ln, lx, y + i * lh, { size, bold: !!o.bold, color: o.color ?? INK }));
    p.text(val, W - X, y, { size: o.vsize ? fs(o.vsize) : size, bold: true, align: 'right', color: o.vcolor ?? INK });
    y += (lines.length - 1) * lh;
    if (o.sub) { y += lh * 0.95; y = p.para(o.sub, lx, y, CW - (lx - X), { size: fs(6.8), color: MUTED, lineHeight: fs(8.4) }) - fs(8.4); }
    y += size * 0.45; p.line(X, y, W - X, y); y += size * 1.3;
  };
  const heading = (t) => { y += fs(3); p.text(t, X, y, { size: fs(10.5), bold: true }); y += fs(14); };
  const note = (t) => { y = p.para(t, X, y, CW, { size: fs(6.8), color: MUTED, lineHeight: fs(8.4) }) + fs(3); };

  p.text('როტაციის კალკულატორი — შედეგი', X, y, { size: fs(16), bold: true, color: ACCENT });
  p.text(today(), W - X, y, { size: fs(8.5), color: MUTED, align: 'right' });
  y += fs(20);
  for (const [kk, val] of M.inputs) {
    p.text(kk, X, y, { size: fs(8.6), color: MUTED });
    y = Math.max(p.para(val, X + 128, y, CW - 128, { size: fs(8.6), lineHeight: fs(11) }), y + fs(11.5));
  }
  y += fs(4);
  // მთავარი
  const hh = fs(58);
  p.rect(X, y, CW, hh, ACCENT, 10);
  p.text('დარჩენილი თანხა ქირისა და სწავლის შემდეგ (თვეში)', X + 14, y + fs(18), { size: fs(9.5), color: WHITE });
  p.text(M.noRent ? 'მიუთითეთ ქირა, რომ დარჩენილი თანხა გამოჩნდეს' : M.hero == null ? '—' : `${formatAmount(M.hero)} ${M.cur}`, X + 14, y + fs(44), { size: fs(M.noRent ? 12 : 22), bold: true, color: WHITE });
  y += hh + fs(16);
  if (!M.noRent && M.hero != null) {
    for (const r of M.chainRows) row(r.label, r.value == null ? '—' : `${formatAmount(r.value)} ${M.cur}`, { sign: r.sign, indent: 14, bold: !!r.strong, vcolor: r.strong ? (String(r.value).startsWith('-') ? [220, 38, 38] : ACCENT) : INK });
    note(M.living.note ? `${M.living.note}. ${M.chainNote}` : M.chainNote);
  }
  // ბარათები: S, ქირის ანაზღაურება, სწავლა
  const cards = [
    [M.noRent ? 'სამივლინებო თანხა (ქირის გარეშე)' : 'ყოველთვიური სამივლინებო თანხა', M.S == null ? '—' : `${formatAmount(M.S)} ${M.cur}`, M.noRent ? 'ქირის ანაზღაურება არ შედის' : 'ქირის ანაზღაურების ჩათვლით'],
    ['ქირის ანაზღაურება (F)', M.noRent ? '—' : fmtC(M.m.F, M.cur), M.noRent ? '' : `ქირა ${fmtC(M.chain.rent.G, M.cur)} · T ${fmtC(M.chain.rent.T, M.cur)} · თქვენ ამატებთ ${fmtC(M.chain.rent.extra, M.cur)}`],
    ['სწავლის ანაზღაურება', M.hasEdu ? fmtC(M.ed.total, M.cur) : '—', M.hasEdu ? `თქვენი წილი: ${fmtC(M.ed.personal, M.cur)}` : ''],
  ];
  const cw = (CW - 16) / 3; const pad = 9;
  const lay = cards.map(([l, , sub]) => ({ l: p.wrap(l, fs(8), cw - 2 * pad), s: sub ? p.wrap(sub, fs(6.6), cw - 2 * pad) : [] }));
  const ch = Math.max(...lay.map((x) => x.l.length * fs(10) + fs(18) + x.s.length * fs(8.2))) + fs(14);
  y += fs(2);
  cards.forEach(([, val], i) => {
    const cx = X + i * (cw + 8); let yy = y + fs(13);
    p.rect(cx, y, cw, ch, SOFT, 8);
    lay[i].l.forEach((ln) => { p.text(ln, cx + pad, yy, { size: fs(8), color: MUTED }); yy += fs(10); });
    yy += fs(6); p.text(val, cx + pad, yy, { size: fs(12.5), bold: true }); yy += fs(11);
    lay[i].s.forEach((ln) => { p.text(ln, cx + pad, yy, { size: fs(6.6), color: MUTED }); yy += fs(8.2); });
  });
  y += ch + fs(16);
  if (M.ot.length) { heading('ერთჯერადი'); for (const x of M.ot) row(x.label, x.value, { sub: x.sub }); }
  if (M.ins.length) {
    heading('დაზღვევა — წლიური ლიმიტი (მაქსიმუმი, არა გასაცემი თანხა)');
    for (const x of M.ins) row(x.name, x.cap == null ? 'მიუთითეთ ასაკი' : `${formatAmount(x.cap)} ${M.cur} / წელი`, { sub: x.entered ? `ანაზღაურდება: ${x.reimb == null ? '—' : formatAmount(x.reimb) + ' ' + M.cur}` : null });
    row('ოჯახის ჯამური წლიური ლიმიტი', M.insCapTotal == null ? '—' : `${formatAmount(M.insCapTotal)} ${M.cur} / წელი`, { bold: true, sub: M.insReimbTotal != null ? `ანაზღაურდება სულ: ${formatAmount(M.insReimbTotal)} ${M.cur}` : null });
  }
  if (M.marketRows) {
    heading(`ცხოვრების ღირებულება — ${M.city} (საორიენტაციო)`);
    if (M.marketNotes.length) { note(M.marketNotes.map((n) => n.text).join(' · ')); y += fs(4); }
    for (const r of M.marketRows) row(r.label, r.value, { size: 8.2 });
    if (M.md?.indices?.costOfLiving != null) note(`ცხოვრების ღირებულების ინდექსი: ${M.md.indices.costOfLiving} (ნიუ-იორკი = 100) · ${M.md.provider?.attribution_ka ?? ''}`);
  }
  heading('როგორ დაითვალა');
  for (const r of M.rows) row(`${r.k}   ${r.label}`, r.text, { size: 8.2, color: r.k === 'S' ? ACCENT : INK, vcolor: r.k === 'S' ? ACCENT : INK });
  note('D = H × A × K × (1 + 7% × C) · T = D × E · S = D − T + F');
  p.text(DISCLAIMER, X, H - 26, { size: 7.5, color: MUTED });
  return { p, overflow: y > BOTTOM };
}

function fmtC(c, cur) { const x = c && typeof c === 'object' ? c.value : c; return x == null ? '—' : `${formatAmount(x)} ${cur}`; }

/** cards: [{ city, name, cur, remainder, remNote, living, livingNote, S, F, extra, rentLabel, rent, market: [[label, value]], index, notes, source }] — 6 ქალაქი გვერდზე */
export const COMPARE_PER_PAGE = 6;
export async function comparePdf(cards) {
  const fonts = await loadPdfFonts();
  const W = 841.89, H = 595.28, X = 30, CW = W - 2 * X;
  let p = null;
  const chunks = [];
  for (let i = 0; i < Math.max(cards.length, 1); i += COMPARE_PER_PAGE) chunks.push(cards.slice(i, i + COMPARE_PER_PAGE));
  const rows = [
    ['დარჩება ქირისა და სწავლის შემდეგ', (c) => c.remainder, true, (c) => c.remNote],
    ['დარჩება საცხოვრებელი ხარჯების შემდეგ (საორიენტაციო)', (c) => c.living, true, (c) => c.livingNote],
    ['ყოველთვიური სამივლინებო თანხა', (c) => c.S],
    ['ქირა', (c) => c.rent, false, (c) => c.rentLabel],
    ['რამდენს ანაზღაურებს (F)', (c) => c.F],
    ['თქვენ ამატებთ ქირაში', (c) => c.extra],
    ...((cards.find((c) => (c.market || []).length > 1)?.market || cards[0]?.market || []).map((m, k) => [m[0], (c) => c.market?.[k]?.[1] ?? '—'])),
    ['ცხოვრება + ქირა ინდექსი (ნიუ-იორკი = 100)', (c) => c.index ?? '—'],
  ];
  chunks.forEach((chunk, pi) => {
    p = p ? p.addPage() : new PdfPage(fonts, W, H);
    p.text('როტაციის კალკულატორი — ქალაქების შედარება', X, 38, { size: 15, bold: true, color: ACCENT });
    p.text(`${today()} · გვერდი ${pi + 1}/${chunks.length}`, W - X, 38, { size: 8.5, color: MUTED, align: 'right' });
    p.text('თქვენი თანამდებობითა და ოჯახით. ვალუტები არ კონვერტირდება და არ იკრიბება.', X, 54, { size: 8, color: MUTED });
    const labW = 140; const colW = (CW - labW) / COMPARE_PER_PAGE;
    let y = 72;
    chunk.forEach((c, i) => {
      const cx = X + labW + i * colW;
      p.rect(cx + 2, y - 4, colW - 4, 36, SOFT, 6);
      p.text(c.city, cx + 8, y + 9, { size: 10, bold: true });
      p.para(`${c.name} · ${c.cur}`, cx + 8, y + 21, colW - 14, { size: 6.8, color: MUTED, lineHeight: 8 });
    });
    y += 44;
    for (const [label, get, strong, note] of rows) {
      let maxH = Math.max(11, p.para(label, X, y, labW - 10, { size: 7.8, color: MUTED, lineHeight: 9.2 }) - y);
      chunk.forEach((c, i) => {
        const cx = X + labW + i * colW;
        const val = String(get(c) ?? '—');
        const yy = p.para(val, cx + 8, y, colW - 12, { size: strong ? 10 : 8.2, bold: !!strong, color: strong ? (val.startsWith('-') || val.startsWith('−') ? [220, 38, 38] : ACCENT) : INK, lineHeight: strong ? 12 : 9.8 });
        let h2 = yy - y;
        const nt = note ? note(c) : null;
        if (nt) h2 = p.para(nt, cx + 8, yy - 1.5, colW - 12, { size: 6.3, color: MUTED, lineHeight: 7.5 }) - y;
        maxH = Math.max(maxH, h2);
      });
      y += maxH + 2; p.line(X, y - 5, W - X, y - 5); y += 3;
    }
    const nts = [...new Set(chunk.flatMap((c) => c.notes || []))];
    nts.slice(0, 4).forEach((t, k) => p.text(t, X, H - 74 + k * 9, { size: 6.8, color: MUTED }));
    const src = chunk.find((c) => c.source)?.source;
    if (src) p.text(src, X, H - 34, { size: 7, color: MUTED });
    p.text(DISCLAIMER, X, H - 22, { size: 7.5, color: MUTED });
  });
  return p.root.toBytes('როტაციის კალკულატორი — შედარება');
}

/** ტექსტის შემოკლება სვეტის სიგანეზე (…) */
function fit(p, t, w, size, bold) {
  if (p.width(t, size, bold) <= w) return t;
  let s = t;
  while (s.length > 1 && p.width(s + '…', size, bold) > w) s = s.slice(0, -1);
  return s.trimEnd() + '…';
}

/** ქალაქების სიძვირის ცხრილი — A4 ლანდშაფტი, მრავალგვერდიანი, სათაურის სტრიქონი მეორდება */
export async function citiesPdf(rows, { sortLabel = '' } = {}) {
  const fonts = await loadPdfFonts();
  const W = 841.89, H = 595.28, X = 30;
  const cols = [['ქალაქი', 104], ['ქვეყანა', 118], ['ცხოვრება + ქირა', 72], ['ცხოვრება', 56], ['ქირა (ინდ.)', 58], ['ქირა ცენტრში, 1 საძ.', 92], ['ვალუტა', 44], ['K', 52], ['წყარო / თარიღი', 186]];
  const per = 30; const n = Math.max(1, Math.ceil(rows.length / per));
  let p = null;
  for (let pi = 0; pi < n; pi++) {
    p = p ? p.addPage() : new PdfPage(fonts, W, H);
    p.text('ქალაქების სიძვირე', X, 36, { size: 15, bold: true, color: ACCENT });
    p.text(`${today()} · გვერდი ${pi + 1}/${n}`, W - X, 36, { size: 8.5, color: MUTED, align: 'right' });
    p.text(`ინდექსები: Numbeo, ნიუ-იორკი = 100. ${sortLabel}`, X, 51, { size: 7.5, color: MUTED });
    let y = 70; let x = X;
    p.rect(X, y - 11, W - 2 * X, 16, SOFT, 3);
    for (const [t, w] of cols) { p.text(t, x + 3, y, { size: 7.5, bold: true }); x += w; }
    y += 15;
    for (const r of rows.slice(pi * per, pi * per + per)) {
      x = X;
      r.cells.forEach((v2, k) => { p.text(fit(p, String(v2 ?? '—'), cols[k][1] - 6, 7.8, k === 0), x + 3, y, { size: 7.8, bold: k === 0 }); x += cols[k][1]; });
      y += 4; p.line(X, y, W - X, y); y += 11;
    }
    p.text('წყარო: Numbeo.com (მოპოვებულია Apify-ის მეშვეობით / შენახული ასლები). ' + DISCLAIMER, X, H - 20, { size: 7, color: MUTED });
  }
  return p.root.toBytes('ქალაქების სიძვირე');
}

export { downloadBytes };
