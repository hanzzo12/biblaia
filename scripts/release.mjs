// გამოშვება: release/rotation-calculator-cloudflare.zip (git-ში დაკომიტებული წყაროები + აწყობილი dist/web)
// და release/rotation-calculator.html (ოფლაინ გამოთვლები, ბაზრის მონაცემების გარეშე).
// არქივი იქმნება `git archive HEAD`-იდან, ამიტომ დაუკომიტებელი ფაილები (მათ შორის .dev.vars) მასში ვერ მოხვდება.
import { execFileSync } from 'node:child_process';
import { mkdir, copyFile, readFile, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildAll } from './build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = (...p) => path.join(root, ...p);
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', ...opts });

const dirty = sh('git', ['status', '--porcelain', '--', '.', ':!release']).trim();
if (dirty) {
  console.error('✗ სამუშაო ასლში დაუკომიტებელი ცვლილებებია — არქივი მხოლოდ შემოწმებული, დაკომიტებული წყაროდან იქმნება:\n' + dirty);
  process.exit(1);
}

await buildAll();
await mkdir(r('release'), { recursive: true });
const zipPath = r('release/rotation-calculator-cloudflare.zip');
await rm(zipPath, { force: true });

const head = sh('git', ['rev-parse', '--short', 'HEAD']).trim();
sh('git', ['archive', '--format=zip', `--prefix=rotation-calculator/`,
  '--add-file=dist/web/index.html', '-o', zipPath, 'HEAD', '--', '.', ':!release', ':!.claude']);
// --add-file ფაილს არქივის ფესვში დებს პრეფიქსით; გადავიტანოთ dist/web/-ში.
sh('bash', ['-c', `cd "$(mktemp -d)" && unzip -q "${zipPath}" && mkdir -p rotation-calculator/dist/web && mv rotation-calculator/index.html rotation-calculator/dist/web/index.html && rm "${zipPath}" && zip -qr "${zipPath}" rotation-calculator`]);

await copyFile(r('dist/rotation-calculator.html'), r('release/rotation-calculator.html'));

// უსაფრთხოების შემოწმება: საიდუმლოებები და ლოკალური ფაილები არქივში არ უნდა იყოს.
const entries = sh('unzip', ['-Z1', zipPath]).split('\n').filter(Boolean);
const bad = entries.filter((e) => /(^|\/)(\.dev\.vars|\.env)$/.test(e) || /(^|\/)(node_modules|\.wrangler|\.wrangler-dry)\//.test(e));
if (bad.length) throw new Error('არქივში აკრძალული ფაილებია: ' + bad.join(', '));
if (!entries.includes('rotation-calculator/dist/web/index.html')) throw new Error('არქივს აკლია dist/web/index.html');
const content = sh('unzip', ['-p', zipPath], { maxBuffer: 256 * 1024 * 1024 });
if (new RegExp(['apify', '_api_'].join('') + '[A-Za-z0-9]{20,}').test(content)) throw new Error('არქივში ნაპოვნია Apify ტოკენის მსგავსი სტრიქონი');
const html = await readFile(r('release/rotation-calculator.html'), 'utf8');
if (new RegExp(['apify', '_api_'].join('') + '[A-Za-z0-9]{20,}').test(html)) throw new Error('HTML-ში ნაპოვნია ტოკენის მსგავსი სტრიქონი');

const kb = async (p) => ((await stat(p)).size / 1024).toFixed(0);
console.log(`✓ release/rotation-calculator-cloudflare.zip (${await kb(zipPath)} KB, commit ${head})`);
console.log(`✓ release/rotation-calculator.html (${await kb(r('release/rotation-calculator.html'))} KB)`);
