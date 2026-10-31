// Secret / CDN scan of build output and release archives. Never opens .dev.vars itself (it holds the
// real token); only checks that no shipped file is named .dev.vars and no shipped content contains a token.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
// built from parts so this file itself never contains the literal token prefix
const TOKEN_RE = new RegExp(['apify', 'api', ''].join('_') + '[A-Za-z0-9]{6,}');
const SECRET_RES = [TOKEN_RE, /APIFY_TOKEN\s*[:=]\s*["']?[A-Za-z0-9_]{12,}/, /NUMBEO_API_KEY\s*[:=]\s*["']?[A-Za-z0-9]{8,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];
const FORBIDDEN_NAMES = [/(^|\/)\.dev\.vars$/, /(^|\/)\.env(\.|$)/, /\.pem$/];
const CDN_RE = /<(script|link|img|iframe)\b[^>]*\b(src|href)\s*=\s*["']?(https?:)?\/\/[^"'\s>]+/gi;

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}
const shipped = () => walk(path.join(ROOT, 'dist'));
const zips = () => [...walk(path.join(ROOT, 'release')), ...fs.readdirSync(ROOT).filter((f) => f.endsWith('.zip')).map((f) => path.join(ROOT, f))]
  .filter((f) => f.endsWith('.zip'));

test('dist/ exists (run npm run build first)', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'dist', 'rotation-calculator.html')), 'dist/rotation-calculator.html missing');
});

test('dist/: no secrets, no .dev.vars/.env files', () => {
  for (const f of shipped()) {
    const rel = path.relative(ROOT, f);
    for (const re of FORBIDDEN_NAMES) assert.doesNotMatch(rel, re, `forbidden file shipped: ${rel}`);
    const text = fs.readFileSync(f, 'latin1');
    for (const re of SECRET_RES) assert.doesNotMatch(text, re, `secret pattern ${re} in ${rel}`);
  }
});

test('dist/: no external CDN scripts/styles/fonts/images (hyperlinks <a href> are allowed)', () => {
  for (const f of shipped().filter((x) => x.endsWith('.html'))) {
    const html = fs.readFileSync(f, 'utf8');
    const hits = [...html.matchAll(CDN_RE)].map((m) => m[0].slice(0, 120));
    assert.deepEqual(hits, [], `${path.relative(ROOT, f)} loads external resources`);
    assert.doesNotMatch(html, /@import\s+url\(\s*["']?https?:/i, 'CSS @import of remote URL');
    assert.doesNotMatch(html, /url\(\s*["']?https?:\/\/(fonts\.|cdn|unpkg|cdnjs)/i, 'remote font/asset in CSS');
  }
});

test('.dev.vars is git-ignored and .dev.vars.example holds no real value', () => {
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.match(gi, /^\.dev\.vars\b/m);
  // გამოშვების არქივიდან გახსნილ ასლში git რეპოზიტორია არ არის — მაშინ git-ის ნაწილი გამოიტოვება.
  if (fs.existsSync(path.join(ROOT, '.git'))) {
    const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n');
    assert.ok(!tracked.some((t) => /(^|\/)\.dev\.vars$/.test(t)), '.dev.vars is tracked by git');
  }
  const ex = path.join(ROOT, '.dev.vars.example');
  if (fs.existsSync(ex)) for (const re of SECRET_RES) assert.doesNotMatch(fs.readFileSync(ex, 'utf8'), re);
});

test('release zip(s), if present: no .dev.vars / secrets inside', (t) => {
  const list = zips();
  if (!list.length) { t.skip('no release zip built yet'); return; }
  for (const z of list) {
    const names = execFileSync('unzip', ['-Z1', z], { encoding: 'utf8' }).split('\n').filter(Boolean);
    for (const n of names) for (const re of FORBIDDEN_NAMES) assert.doesNotMatch(n, re, `${path.basename(z)} contains ${n}`);
    for (const n of names.filter((x) => !x.endsWith('/'))) {
      const buf = execFileSync('unzip', ['-p', z, n.replace(/\[/g, '[[]')], { maxBuffer: 64 * 1024 * 1024 }).toString('latin1');
      for (const re of SECRET_RES) assert.doesNotMatch(buf, re, `${path.basename(z)}:${n} matches ${re}`);
    }
  }
});
