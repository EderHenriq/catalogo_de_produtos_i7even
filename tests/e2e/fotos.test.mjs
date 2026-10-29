// Importar pasta de fotos com a pasta REAL da loja (Imagens/, fora do Git),
// num banco de teste: prévia → envio → fotos ligadas a categoria, capa e
// cores → catálogo mostra a foto da cor → importar de novo não duplica.
// Sem a pasta (ex.: outro computador), o teste usa uma pasta de exemplo.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, open, SHOTS } from './harness.mjs';

let fails = 0;
const ok = (c, m) => { console.log(`${c ? '  ✓' : '  ✗'} ${m}`); if (!c) fails++; };
const env = await createDb();
const q = async (sql, p) => (await env.db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];

let DIR = fileURLToPath(new URL('../../Imagens/', import.meta.url));
const real = fs.existsSync(DIR);
if (real) {
  // cópia congelada: a pasta real pode estar recebendo downloads agora
  const snap = path.join(os.tmpdir(), `i7-imagens-${Date.now()}`, 'Imagens');
  // (cópia à mão: fs.cpSync derruba o Node no Windows com acento no caminho)
  const copy = (from, to) => {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      if (e.isDirectory()) copy(path.join(from, e.name), path.join(to, e.name));
      else fs.copyFileSync(path.join(from, e.name), path.join(to, e.name));
    }
  };
  copy(DIR, snap);
  DIR = snap;
}
const { browser, page, errors } = await open(env, { device: 'Desktop' });
if (!real) {
  // pasta de exemplo com PNGs gerados no navegador
  DIR = path.join(os.tmpdir(), `i7-imagens-${Date.now()}`, 'Imagens');
  const png = Buffer.from(await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 900; c.height = 900; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 900, 900); g.fillStyle = '#333'; g.fillRect(300, 150, 300, 600); return c.toDataURL('image/png').split(',')[1]; }), 'base64');
  for (const f of ['06_Consoles/categoria.png', '01_iPhone/iPhone 11/Preto/a.png', '01_iPhone/iPhone 11/Preto/b.png', '01_iPhone/iPhone 11/Verde/a.png', '06_Consoles/PlayStation 4 Slim/Branco/a.png']) {
    fs.mkdirSync(path.dirname(path.join(DIR, f)), { recursive: true });
    fs.writeFileSync(path.join(DIR, f), png);
  }
}
console.log(real ? '(pasta real Imagens/)' : '(pasta de exemplo)');
await page.waitForSelector('.app');
await env.db.query(`update public.store_settings set catalog_enabled = true where id = 1`);

console.log('1. prévia');
await page.evaluate(() => { location.hash = '#/produtos'; });
await page.waitForTimeout(300);
await page.locator('[data-photo-import]').click();
await page.waitForSelector('input[data-dir]', { state: 'attached' });
await page.locator('input[data-dir]').first().setInputFiles(DIR);
await page.waitForSelector('.pi-model', { timeout: 30000 });
const modelsTxt = await page.locator('.pi-models').allInnerTexts();
ok(modelsTxt.join(' ').includes('iPhone 11'), 'iPhone 11 reconhecido');
ok(await page.locator('.pi-model.is-new', { hasText: 'PlayStation 4 Slim' }).count() === 1, 'PS4 Slim fora do cadastro: oferece criar');
const badN = await page.locator('.pi-details', { hasText: 'com defeito' }).locator('li').count();
if (badN) console.log(`    (${badN} arquivo(s) com defeito na pasta: ficam de fora e aparecem na prévia)`);
const goText = await page.locator('[data-go]').innerText();
ok(/Enviar \d+ fotos?/.test(goText), `botão: "${goText.trim()}"`);
await page.screenshot({ path: `${SHOTS}fotos-1-previa.png`, fullPage: false });

console.log('2. envio');
await page.locator('[data-go]').click();
await page.waitForSelector('.pi-done', { timeout: 180000 });
const doneTxt = await page.locator('.pi-done').innerText();
ok(/fotos? enviadas?/.test(doneTxt) && !/com problema/.test(doneTxt), doneTxt.replace(/\n+/g, ' | '));
let r = await one(`select color_photos from public.products where slug = 'iphone-11'`);
const cp = r.color_photos || {};
ok(Array.isArray(cp.Preto) && cp.Preto.length >= 1, `iPhone 11 Preto com ${cp.Preto?.length || 0} fotos`);
ok(Object.keys(cp).length >= 2, `iPhone 11 com fotos em ${Object.keys(cp).length} cores`);
r = await one(`select image from public.categories where slug = 'console'`);
ok(!!r.image, 'foto da categoria Consoles');
r = await one(`select id, colors, needs_review from public.products where name = 'PlayStation 4 Slim'`);
ok(r && r.colors.includes('Branco') && r.needs_review, 'PS4 Slim criado (marcado "a confirmar"), com as cores das pastas');
const uploads = [...env.uploads.keys()].filter((k) => !k.includes('.t.')).length;
ok(uploads > 0 && [...env.uploads.keys()].some((k) => k.includes('.t.')), `${uploads} fotos no Storage, com miniaturas`);

console.log('3. importar de novo não duplica');
await page.locator('.modal-foot [data-close]').click();
await page.waitForTimeout(300);
await page.locator('[data-photo-import]').click();
await page.locator('input[data-dir]').first().setInputFiles(DIR);
await page.waitForSelector('.pi-model', { timeout: 30000 });
ok(await page.locator('[data-go]').isDisabled(), 'segunda vez: nada novo para enviar (o que tem foto fica)');
await page.locator('.modal-foot [data-close]').click();

console.log('4. catálogo');
const p11 = await one(`select id from public.products where slug = 'iphone-11'`);
await env.db.query(`insert into public.product_variants (product_id, storage, color, condition, price, stock) values ($1, '128GB', 'Preto', 'Seminovo', 1500, 0)`, [p11.id]);
await env.db.query(`update public.product_variants set stock = 1 where product_id = $1`, [p11.id]);
const c = await open(env, { device: 'iPhone 13', path: 'catalogo.html' });
await c.page.waitForSelector('.cat-card');
const src = await c.page.locator('.cat-card', { hasText: 'iPhone 11' }).locator('img').first().getAttribute('src');
ok(src && src.includes('/produtos/p/'), 'cartão do iPhone 11 usa a foto importada');
await c.page.locator('.cat-card', { hasText: 'iPhone 11' }).tap();
await c.page.waitForSelector('.cat-sheet[open] .cat-slide img');
const slides = await c.page.locator('.cat-sheet[open] .cat-slide').count();
ok(slides === cp.Preto.length, `ficha: carrossel com as ${slides} fotos da cor Preto`);
await c.page.screenshot({ path: `${SHOTS}fotos-2-ficha.png` });
ok(c.errors.length === 0, `catálogo sem erro de JS ${c.errors.join(' | ')}`);
await c.browser.close();

ok(errors.length === 0, `sem erro de JS ${errors.join(' | ')}`);
await browser.close();
console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK');
process.exit(fails ? 1 : 0);
