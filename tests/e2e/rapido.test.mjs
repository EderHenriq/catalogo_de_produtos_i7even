// Dia a dia da loja, de ponta a ponta:
//  1. cola a lista REAL da loja (pronta entrega) → cria o modelo que falta
//     (iPhone 17e) → publica: preço, estoque sem IMEI e catálogo na hora;
//  2. cadastro rápido: PS5 Slim com leitor × digital, 1TB, 2 de cada;
//  3. o cliente vê tudo no catálogo (pronta entrega).
import fs from 'node:fs';
import { createDb, open, SHOTS, audit } from './harness.mjs';

const DEVICE = process.argv[2] || 'iPhone 13';
const tag = DEVICE.replace(/\W/g, '');
let fails = 0;
const ok = (c, m) => { console.log(`${c ? '  ✓' : '  ✗'} ${m}`); if (!c) fails++; };
const env = await createDb();
const q = async (sql, p) => (await env.db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];
const touch = DEVICE !== 'Desktop';
const LIST = fs.readFileSync(new URL('../unit/fixtures/lista-i7even.txt', import.meta.url), 'utf8');
await env.db.query(`update public.store_settings set catalog_enabled = false where id = 1`);

const { browser, page, errors } = await open(env, { device: DEVICE });
const tap = (loc) => (touch ? loc.first().tap() : loc.first().click());
const top = () => page.locator('dialog.modal[open]').last();
const shot = (n) => page.screenshot({ path: `${SHOTS}rapido-${tag}-${n}.png` });
const auditNow = async (label) => { const i = await audit(page, label, { mobile: touch }); if (i.length) console.log('    ⚠', i.join('\n    ⚠ ')); };
const waitDb = async (sql, test, ms = 8000) => {
  const t0 = Date.now();
  for (;;) { const r = await q(sql); if (test(r)) return r; if (Date.now() - t0 > ms) return r; await page.waitForTimeout(150); }
};
await page.waitForSelector('.app');

console.log('1. lista real da loja → pronta entrega');
await page.evaluate(() => { location.hash = '#/produtos'; });
await page.waitForTimeout(300);
// celular: "Colar lista do WhatsApp" fica no botão Mais (com o nome escrito)
if (DEVICE === 'Desktop') await tap(page.locator('[data-olist]'));
else {
  await tap(page.locator('[data-more-actions]'));
  await page.waitForSelector('.menu');
  await page.waitForTimeout(350);   // o menu termina de abrir
  await tap(page.locator('.menu button', { hasText: 'Colar lista do WhatsApp' }));
}
await page.waitForSelector('#ol-text');
ok(await top().locator('[data-mode="pronta"][aria-checked="true"]').count() === 1, 'abre em "Pronta entrega"');
await top().locator('#ol-text').fill(LIST);
await shot('01-colar');
await auditNow('colar-lista');
await tap(top().locator('[data-read]'));
await page.waitForSelector('.olist-row');
ok(await top().locator('.olist-row').count() === 36, `36 ofertas lidas (${await top().locator('.olist-row').count()})`);
ok(await top().locator('.olist-miss-row').count() === 1 && (await top().locator('.olist-miss-row').innerText()).includes('iPhone 17e'), 'iPhone 17e aparece para "Criar modelo"');
ok((await top().locator('.olist-row', { hasText: 'iPhone 18 Pro Max' }).first().innerText()).includes('cor nova') || (await top().locator('.olist-rows').innerText()).includes('cor nova'), 'Burgundy entra como cor nova');
await tap(top().locator('[data-create]'));
await page.waitForSelector('#cm-name');
ok((await top().locator('#cm-name').inputValue()) === 'iPhone 17e', 'nome sugerido "iPhone 17e"');
ok((await top().locator('#cm-co').inputValue()).includes('Rosa'), 'cor sugerida da lista (Rosa)');
await tap(top().locator('.modal-foot [data-ok]'));
await page.waitForTimeout(800);
ok(await top().locator('.olist-row').count() === 37, `lista relida: 37 ofertas (${await top().locator('.olist-row').count()})`);
ok(await top().locator('.olist-miss-row').count() === 0, 'nenhum modelo faltando');
await shot('02-conferir');
await auditNow('conferir-lista');
await tap(top().locator('[data-publish]'));
await page.waitForSelector('dialog.modal[open] [data-confirm]');
ok((await top().innerText()).includes('catálogo está fechado'), 'avisa que o catálogo está fechado');
await tap(top().locator('[data-confirm]'));
let r = await waitDb(`select catalog_enabled from public.store_settings where id = 1`, (x) => x[0].catalog_enabled);
ok(r[0].catalog_enabled, 'catálogo aberto pelo aviso');
r = await one(`select count(*)::int n from public.units where status = 'estoque' and serial is null`);
ok(r.n === 37, `37 aparelhos sem IMEI no estoque (${r.n})`);
r = await one(`select v.price::float p, v.stock, v.condition from public.product_variants v join public.products p on p.id = v.product_id
               where p.slug = 'iphone-14' and v.storage = '128GB' and v.color = '(PRODUCT)RED'`);
ok(r?.p === 2297 && r.stock === 1 && r.condition === 'Seminovo', 'iPhone 14 128GB (PRODUCT)RED seminovo: R$ 2.297, 1 em estoque');
r = await one(`select count(*)::int n from public.product_variants v join public.products p on p.id = v.product_id where p.slug = 'iphone-18-pro-max' and v.color = 'Burgundy'`);
ok(r.n === 1, 'cor nova Burgundy criada no iPhone 18 Pro Max');

console.log('2. cadastro rápido: PS5 Slim com leitor × digital');
await page.waitForTimeout(400);
await tap(page.locator('[data-new-product]'));
await page.waitForSelector('#qp-name');
const consoleCat = await one(`select id from public.categories where slug = 'console'`);
await tap(top().locator(`[data-cat="${consoleCat.id}"]`));
await top().locator('#qp-name').fill('PlayStation 5 Slim');
await top().locator('#qp-name').dispatchEvent('change');
await page.waitForTimeout(300);
ok(await top().locator('[data-sz]').count() === 2, 'mostra a Versão: com leitor / digital');
await tap(top().locator('[data-sz="Com leitor de disco"]'));
await tap(top().locator('[data-sz="Digital (sem leitor)"]'));
await tap(top().locator('[data-st="1TB"]'));
await tap(top().locator('[data-co="Branco"]'));
const prices = top().locator('[data-price]');
ok(await prices.count() === 2, 'um preço por versão');
await prices.nth(0).pressSequentially('389900');
await prices.nth(1).pressSequentially('349900');
await top().locator('#qp-qty').fill('2');
await top().locator('#qp-qty').dispatchEvent('input');
await shot('03-rapido');
await auditNow('cadastro-rapido');
await tap(top().locator('.modal-foot [data-ok]'));
r = await waitDb(`select v.size, v.storage, v.price::float p, v.stock from public.product_variants v join public.products p on p.id = v.product_id
                  where p.slug = 'ps5-slim' order by v.price`, (x) => x.length === 2);
ok(r.length === 2 && r[0].size === 'Digital (sem leitor)' && r[0].p === 3499 && r[0].stock === 2 && r[1].size === 'Com leitor de disco' && r[1].p === 3899,
  `PS5: digital R$ 3.499 e com leitor R$ 3.899, 2 de cada (${JSON.stringify(r)})`);

console.log('3. o cliente vê na hora');
const c = await open(env, { device: DEVICE, path: 'catalogo.html' });
await c.page.waitForSelector('.cat-card');
const n = await c.page.locator('.cat-card').count();
ok(n === 17, `catálogo com os 16 modelos da lista + o PS5 (${n})`);
ok(await c.page.locator('.cat-card', { hasText: 'PlayStation 5 Slim' }).count() === 1, 'PS5 Slim no catálogo');
await (touch ? c.page.locator('.cat-card', { hasText: 'PlayStation 5 Slim' }).tap() : c.page.locator('.cat-card', { hasText: 'PlayStation 5 Slim' }).click());
await c.page.waitForSelector('.cat-sheet[open] .cat-price');
ok((await c.page.locator('.cat-sheet[open]').innerText()).includes('Versão'), 'ficha mostra "Versão" (com leitor / digital)');
await c.page.screenshot({ path: `${SHOTS}rapido-${tag}-04-ps5.png` });
ok(c.errors.length === 0, `catálogo sem erro de JS ${c.errors.join(' | ')}`);
await c.browser.close();

ok(errors.length === 0, `sem erro de JS ${errors.join(' | ')}`);
await browser.close();
console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK');
process.exit(fails ? 1 : 0);
