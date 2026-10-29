// აწყობა: ერთი თვითკმარი HTML ფაილი (ოფლაინ) + იგივე ფაილი Cloudflare-ის სტატიკური assets-ისთვის.
// ყველაფერი ჩაშენებულია: JS (esbuild IIFE), CSS, ქართული ფონტი, ნორმატიული მონაცემები.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir, rm, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = (...p) => path.join(root, ...p);

const FONT_DIR = r('node_modules/@fontsource/noto-sans-georgian/files');
const FONTS = [
  { file: 'noto-sans-georgian-georgian-400-normal.woff2', weight: 400, range: 'U+0589,U+10A0-10FF,U+1C90-1CBA,U+1CBD-1CBF,U+2D00-2D2F' },
  { file: 'noto-sans-georgian-georgian-700-normal.woff2', weight: 700, range: 'U+0589,U+10A0-10FF,U+1C90-1CBA,U+1CBD-1CBF,U+2D00-2D2F' },
  { file: 'noto-sans-georgian-latin-400-normal.woff2', weight: 400, range: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD' },
  { file: 'noto-sans-georgian-latin-700-normal.woff2', weight: 700, range: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD' },
];

async function fontFaces() {
  const out = [];
  for (const f of FONTS) {
    const buf = await readFile(path.join(FONT_DIR, f.file));
    out.push(`@font-face{font-family:"Rotation Georgian";font-style:normal;font-display:swap;font-weight:${f.weight};` +
      `src:url(data:font/woff2;base64,${buf.toString('base64')}) format("woff2");unicode-range:${f.range};}`);
  }
  return out.join('\n');
}

// "</script" და "<!--" ჩაშენებულ სკრიპტში HTML-ის პარსერს არ უნდა დაარღვიოს.
const safeInlineScript = (js) => js.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
const safeInlineStyle = (css) => css.replace(/<\/(style)/gi, '<\\/$1');

export async function buildAll({ quiet = false } = {}) {
  const pkg = JSON.parse(await readFile(r('package.json'), 'utf8'));
  const data = JSON.parse(await readFile(r('src/data/normative-data.json'), 'utf8'));
  const dataHash = createHash('sha256').update(await readFile(r('src/data/normative-data.json'))).digest('hex');

  const js = await build({
    entryPoints: [r('src/ui/main.js')],
    bundle: true, format: 'iife', platform: 'browser', target: ['es2020'],
    minify: false, legalComments: 'none', write: false, charset: 'utf8',
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __RULES_VERSION__: JSON.stringify(data.rulesVersion ?? null),
      __DATA_SHA256__: JSON.stringify(dataHash),
      __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
    },
  });
  const script = js.outputFiles[0].text;

  const css = [await fontFaces(), await readFile(r('src/ui/styles.css'), 'utf8'), await readFile(r('src/ui/print.css'), 'utf8')].join('\n');
  let html = await readFile(r('src/ui/index.html'), 'utf8');
  if (!html.includes('<!-- @inline-styles -->') || !html.includes('<!-- @inline-script -->')) {
    throw new Error('src/ui/index.html უნდა შეიცავდეს <!-- @inline-styles --> და <!-- @inline-script --> ადგილებს');
  }
  html = html
    .replace('<!-- @inline-styles -->', () => `<style>\n${safeInlineStyle(css)}\n</style>`)
    .replace('<!-- @inline-script -->', () => `<script>\n${safeInlineScript(script)}\n</script>`);

  // დაცვა: გარე რესურსები (CDN, Google Fonts) ჩაშენებულ ფაილში არ უნდა იყოს.
  const external = html.match(/<(script|link|img|iframe)[^>]+(src|href)=["']https?:\/\//i);
  if (external) throw new Error('აღმოჩენილია გარე რესურსი: ' + external[0]);

  await rm(r('dist'), { recursive: true, force: true });
  await mkdir(r('dist/web'), { recursive: true });
  await writeFile(r('dist/rotation-calculator.html'), html, 'utf8');
  await copyFile(r('dist/rotation-calculator.html'), r('dist/web/index.html'));
  const size = Buffer.byteLength(html);
  if (!quiet) console.log(`✓ dist/rotation-calculator.html (${(size / 1024).toFixed(1)} KB), dist/web/index.html; rulesVersion=${data.rulesVersion}`);
  return { size };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildAll().catch((e) => { console.error('✗ build:', e.message); process.exit(1); });
}
