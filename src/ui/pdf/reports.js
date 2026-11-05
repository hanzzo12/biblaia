// ერთგვერდიანი PDF ანგარიშები (შედეგი — A4 პორტრეტი; შედარება — A4 ლანდშაფტი). ტექსტი რჩება ტექსტად.
import { PdfPage, downloadBytes } from './writer.js';
import { loadPdfFonts } from './fonts.js';
import { formatAmount } from '../../core/index.js';

const INK = [30, 41, 59], MUTED = [100, 116, 139], ACCENT = [79, 70, 229], SOFT = [241, 243, 249], LINE = [226, 232, 240], WHITE = [255, 255, 255];
const DISCLAIMER = 'საინფორმაციო გაანგარიშება — არ წარმოადგენს ოფიციალურ ფინანსურ დოკუმენტს.';
const today = () => new Date().toISOString().slice(0, 10);

export async function resultPdf(M) {
  const fonts = await loadPdfFonts();
  const W = 595.28, H = 841.89, X = 44, CW = W - 2 * X;
  const p = new PdfPage(fonts, W, H);
  let y = 50;
  p.text('როტაციის კალკულატორი — შედეგი', X, y, { size: 17, bold: true, color: ACCENT });
  p.text(today(), W - X, y, { size: 9, color: MUTED, align: 'right' });
  y += 22;
  // შეყვანილი მონაცემები
  for (const [k, val] of M.inputs) {
    p.text(k, X, y, { size: 9, color: MUTED });
    y = Math.max(p.para(val, X + 130, y, CW - 130, { size: 9 }), y + 12.5);
  }
  y += 6;
  // მთავარი
  p.rect(X, y, CW, 64, ACCENT, 10);
  p.text('დარჩენილი თანხა ქირისა და სწავლის შემდეგ (თვეში)', X + 16, y + 20, { size: 10, color: WHITE });
  p.text(M.noRent ? 'მიუთითეთ ქირა, რომ დარჩენილი თანხა გამოჩნდეს' : M.hero == null ? '—' : `${formatAmount(M.hero)} ${M.cur}`, X + 16, y + 48, { size: M.noRent ? 13 : 24, bold: true, color: WHITE });
  y += 72;
  if (!M.noRent && M.hero != null) {
    for (const r of M.chainRows) {
      p.text(r.sign, X + 4, y, { size: 9, color: MUTED, bold: true });
      p.text(r.label, X + 18, y, { size: r.strong ? 9 : 8.5, bold: !!r.strong });
      p.text(r.value == null ? '—' : `${formatAmount(r.value)} ${M.cur}`, W - X, y, { size: r.strong ? 9.5 : 8.5, bold: true, align: 'right', color: r.strong ? ACCENT : INK });
      y += 4; p.line(X, y, W - X, y); y += 9.5;
    }
    p.text(M.living.note ? `${M.living.note}. ${M.chainNote}` : M.chainNote, X, y, { size: 7, color: MUTED });
    y += 14;
  }
  const cards = [
    [M.noRent ? 'სამივლინებო თანხა (ქირის გარეშე)' : 'ყოველთვიური სამივლინებო თანხა', M.S == null ? '—' : `${formatAmount(M.S)} ${M.cur}`, M.noRent ? 'ქირის ანაზღაურება არ შედის' : 'ქირის ანაზღაურების ჩათვლით'],
    ['ქირის ანაზღაურება (F)', M.noRent ? '—' : fmtC(M.m.F, M.cur), M.noRent ? '' : `ქირა ${fmtC(M.chain.rent.G, M.cur)} · T ${fmtC(M.chain.rent.T, M.cur)} · თქვენ ამატებთ ${fmtC(M.chain.rent.extra, M.cur)}`],
    ['სწავლის ანაზღაურება', M.hasEdu ? fmtC(M.ed.total, M.cur) : '—', M.hasEdu ? `თქვენი წილი: ${fmtC(M.ed.personal, M.cur)}` : ''],
  ];
  const cw = (CW - 16) / 3;
  cards.forEach(([l, val, sub], i) => {
    const cx = X + i * (cw + 8);
    p.rect(cx, y, cw, 70, SOFT, 8);
    p.para(l, cx + 10, y + 15, cw - 20, { size: 8.5, color: MUTED, lineHeight: 10.5 });
    p.text(val, cx + 10, y + 44, { size: 13, bold: true });
    if (sub) p.para(sub, cx + 10, y + 55, cw - 20, { size: 6.8, color: MUTED, lineHeight: 8 });
  });
  y += 84;
  // ერთჯერადი და დაზღვევა
  const list = (title, items) => {
    if (!items.length) return;
    p.text(title, X, y, { size: 10.5, bold: true }); y += 15;
    for (const it of items) {
      p.text(it[0], X, y, { size: 9 });
      p.text(it[1], W - X, y, { size: 9, bold: true, align: 'right' });
      if (it[2]) { y += 11; p.text(it[2], X, y, { size: 7.5, color: MUTED }); }
      y += 6; p.line(X, y, W - X, y); y += 11;
    }
    y += 4;
  };
  list('ერთჯერადი', M.ot.map((x) => [x.label, x.value, x.sub]));
  if (M.ins.length) {
    list('დაზღვევა — წლიური ლიმიტი (მაქსიმუმი, არა გასაცემი თანხა)', [
      ...M.ins.map((x) => [x.name, x.cap == null ? 'მიუთითეთ ასაკი' : `${formatAmount(x.cap)} ${M.cur} / წელი`, x.entered ? `ანაზღაურდება: ${x.reimb == null ? '—' : formatAmount(x.reimb) + ' ' + M.cur}` : null]),
      ['ოჯახის ჯამური წლიური ლიმიტი', M.insCapTotal == null ? '—' : `${formatAmount(M.insCapTotal)} ${M.cur} / წელი`, M.insReimbTotal != null ? `ანაზღაურდება სულ: ${formatAmount(M.insReimbTotal)} ${M.cur}` : null],
    ]);
  }
  // ცხოვრების ღირებულება
  if (M.marketRows) {
    p.text(`ცხოვრების ღირებულება — ${M.city} (საორიენტაციო)`, X, y, { size: 10.5, bold: true }); y += 14;
    for (const n of M.marketNotes) { p.text(n.text, X, y, { size: 7, color: MUTED }); y += 9.5; }
    if (M.marketNotes.length) y += 4;
    for (const r of M.marketRows) { p.text(r.label, X, y, { size: 8.5 }); p.text(r.value, W - X, y, { size: 8.5, bold: true, align: 'right' }); y += 4; p.line(X, y, W - X, y); y += 9.5; }
    if (M.md?.indices?.costOfLiving != null) { p.text(`ცხოვრების ღირებულების ინდექსი: ${M.md.indices.costOfLiving} (ნიუ-იორკი = 100) · ${M.md.provider?.attribution_ka ?? ''}`, X, y, { size: 7.5, color: MUTED }); y += 12; }
    y += 4;
  }
  // როგორ დაითვალა
  p.text('როგორ დაითვალა', X, y, { size: 10.5, bold: true }); y += 14;
  for (const r of M.rows) {
    p.text(r.k, X, y, { size: 9, bold: true, color: ACCENT });
    p.text(r.label, X + 18, y, { size: 9, color: r.k === 'S' ? ACCENT : INK });
    p.text(r.text, W - X, y, { size: 9, bold: true, align: 'right', color: r.k === 'S' ? ACCENT : INK });
    y += 4; p.line(X, y, W - X, y); y += 9.5;
  }
  p.text('D = H × A × K × (1 + 7% × C) · T = D × E · S = D − T + F', X, y + 2, { size: 8, color: MUTED });
  p.text(DISCLAIMER, X, H - 30, { size: 8, color: MUTED });
  return p.toBytes('როტაციის კალკულატორი — შედეგი');
}

function fmtC(c, cur) { const x = c && typeof c === 'object' ? c.value : c; return x == null ? '—' : `${formatAmount(x)} ${cur}`; }

/** cards: [{ city, name, cur, remainder, S, F, rentLabel, rent, market: [[label, value]], index }] */
export async function comparePdf(cards) {
  const fonts = await loadPdfFonts();
  const W = 841.89, H = 595.28, X = 36, CW = W - 2 * X;
  const p = new PdfPage(fonts, W, H);
  p.text('როტაციის კალკულატორი — ქალაქების შედარება', X, 44, { size: 16, bold: true, color: ACCENT });
  p.text(today(), W - X, 44, { size: 9, color: MUTED, align: 'right' });
  p.text('თქვენი თანამდებობითა და ოჯახით. ვალუტები არ კონვერტირდება და არ იკრიბება.', X, 62, { size: 8.5, color: MUTED });
  const labW = 175; const n = Math.max(cards.length, 1); const colW = (CW - labW) / n;
  let y = 84;
  // სათაურები
  cards.forEach((c, i) => {
    const cx = X + labW + i * colW;
    p.rect(cx + 3, y - 4, colW - 6, 40, SOFT, 6);
    p.text(c.city, cx + 10, y + 10, { size: 11, bold: true });
    p.para(`${c.name} · ${c.cur}`, cx + 10, y + 24, colW - 20, { size: 7.5, color: MUTED, lineHeight: 9 });
  });
  y += 50;
  const rows = [
    ['დარჩება ქირისა და სწავლის შემდეგ', (c) => c.remainder, true, (c) => c.remNote],
    ['დარჩება საცხოვრებელი ხარჯების შემდეგ (საორიენტაციო)', (c) => c.living, true, (c) => c.livingNote],
    ['ყოველთვიური სამივლინებო თანხა', (c) => c.S, true],
    ['ქირის ანაზღაურება', (c) => c.F],
    ['ქირა', (c) => c.rent, false, (c) => c.rentLabel],
    ...((cards[0]?.market || []).map((_, k) => [cards[0].market[k][0], (c) => c.market?.[k]?.[1] ?? '—'])),
    ['ცხოვრების ღირ. ინდექსი (ნიუ-იორკი = 100)', (c) => c.index ?? '—'],
  ];
  for (const [label, get, strong, note] of rows) {
    let maxH = Math.max(12, p.para(label, X, y, labW - 10, { size: 8.5, color: MUTED, lineHeight: 10 }) - y);
    cards.forEach((c, i) => {
      const cx = X + labW + i * colW;
      const yy = p.para(String(get(c) ?? '—'), cx + 10, y, colW - 16, { size: strong ? 11 : 9, bold: !!strong, color: strong && label.startsWith('დარჩება') ? ACCENT : INK, lineHeight: strong ? 13 : 11 });
      let h2 = yy - y;
      const nt = note ? note(c) : null;
      if (nt) h2 = p.para(nt, cx + 10, yy - 2, colW - 16, { size: 7, color: MUTED, lineHeight: 8.5 }) - y;
      maxH = Math.max(maxH, h2);
    });
    y += maxH + 3; p.line(X, y - 6, W - X, y - 6);
    y += 4;
  }
  const nts = [...new Set(cards.flatMap((c) => c.notes || []))];
  nts.slice(0, 4).forEach((t, k) => p.text(t, X, H - 92 + k * 9.5, { size: 7, color: MUTED }));
  const src = cards.find((c) => c.source)?.source;
  if (src) p.text(src, X, H - 44, { size: 7.5, color: MUTED });
  p.text(DISCLAIMER, X, H - 28, { size: 8, color: MUTED });
  return p.toBytes('როტაციის კალკულატორი — შედარება');
}

export { downloadBytes };
