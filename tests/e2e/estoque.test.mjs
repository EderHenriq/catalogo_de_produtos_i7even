// Menus ⋮ dentro das janelas (variação → aparelho): abrem NA FRENTE e as
// ações funcionam - dar baixa (tirar do estoque), desfazer, corrigir dados.
// Também: aparelho sem IMEI não mostra "Copiar IMEI".
import { createDb, open, SHOTS } from './harness.mjs';

const DEVICE = process.argv[2] || 'Desktop';
const tag = DEVICE.replace(/\W/g, '');
let fails = 0;
const ok = (c, m) => { console.log(`${c ? '  ✓' : '  ✗'} ${m}`); if (!c) fails++; };
const env = await createDb();
const q = async (sql, p) => (await env.db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];
const touch = DEVICE !== 'Desktop';

const p13 = await one(`select id from public.products where slug = 'iphone-13'`);
const v = await one(`insert into public.product_variants (product_id, storage, color, condition, price) values ($1, '128GB', 'Estelar', 'Seminovo', 2500) returning id`, [p13.id]);
await env.db.query(`insert into public.units (variant_id, serial, cost, origin) values ($1, '555565898865688', 2000, 'Importado (EUA)')`, [v.id]);
await env.db.query(`insert into public.units (variant_id, cost) values ($1, 1900)`, [v.id]);
await env.db.query(`select public._variant_sync($1)`, [v.id]);

const { browser, page, errors } = await open(env, { device: DEVICE });
const tap = (loc) => (touch ? loc.first().tap() : loc.first().click());
const top = () => page.locator('dialog.modal[open]').last();
const waitDb = async (sql, test, ms = 6000) => {
  const t0 = Date.now();
  for (;;) { const r = await q(sql); if (test(r)) return r; if (Date.now() - t0 > ms) return r; await page.waitForTimeout(150); }
};
/** O menu está mesmo visível na frente (o ponto do meio dele é ele)? */
const menuOnTop = () => page.evaluate(() => {
  const m = document.querySelector('.menu');
  if (!m) return false;
  const r = m.getBoundingClientRect();
  const el = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(20, r.height / 2));
  return !!el && m.contains(el);
});

await page.waitForSelector('.app');
await page.evaluate(() => { location.hash = '#/produtos'; });
await page.locator('[data-search]').fill('iphone 13');
await page.waitForTimeout(300);
await tap(page.locator('.m-row', { has: page.locator('.m-title', { hasText: /^iPhone 13$/ }) }));
await page.waitForSelector('.product-hero');
await tap(top().locator('[data-variant]').first());
await page.waitForSelector('[data-unit-menu]');
ok(await top().locator('[data-unit-menu]').count() === 2, '2 aparelhos na variação (1 com IMEI, 1 sem)');

console.log('1. ⋮ do aparelho com IMEI');
await tap(top().locator('[data-unit-menu]').first());
await page.waitForSelector('.menu');
ok(await menuOnTop(), 'menu abre NA FRENTE da janela');
ok((await page.locator('.menu').innerText()).includes('Copiar IMEI'), 'tem "Copiar IMEI"');
await page.screenshot({ path: `${SHOTS}estoque-${tag}-menu.png` });
await tap(page.locator('.menu button', { hasText: 'Dar baixa' }));
await page.waitForSelector('dialog.modal[open] .modal-foot [data-ok]');
await tap(top().locator('.modal-foot [data-ok]'));
let r = await waitDb(`select status from public.units where serial = '555565898865688'`, (x) => x[0].status === 'baixa');
ok(r[0].status === 'baixa', 'dar baixa: aparelho saiu do estoque');
r = await one(`select stock from public.product_variants where id = $1`, [v.id]);
ok(r.stock === 1, `estoque 2 → 1 (${r.stock})`);

console.log('2. desfazer a baixa');
await page.waitForTimeout(400);
await tap(top().locator('button', { hasText: 'vendidos e baixados' }));
await page.waitForTimeout(200);
await tap(top().locator('.unit-row', { hasText: '555565898865688' }).locator('[data-unit-menu]'));
await page.waitForSelector('.menu');
ok(await menuOnTop(), 'menu do aparelho baixado também abre na frente');
await tap(page.locator('.menu button', { hasText: 'Desfazer a baixa' }));
r = await waitDb(`select status from public.units where serial = '555565898865688'`, (x) => x[0].status === 'estoque');
ok(r[0].status === 'estoque', 'desfazer: voltou ao estoque');

console.log('3. aparelho sem IMEI: anotar o IMEI depois');
await page.waitForTimeout(400);
await tap(top().locator('.unit-row', { hasText: 'sem IMEI' }).locator('[data-unit-menu]'));
await page.waitForSelector('.menu');
const txt = await page.locator('.menu').innerText();
ok(!txt.includes('Copiar IMEI') && txt.includes('Anotar IMEI'), 'sem IMEI: "Anotar IMEI", sem "Copiar IMEI"');
await tap(page.locator('.menu button', { hasText: 'Anotar IMEI' }));
await page.waitForSelector('#uf-serial');
await top().locator('#uf-serial').fill('350000000000777');
await tap(top().locator('.modal-foot [data-ok]'));
r = await waitDb(`select count(*)::int n from public.units where serial = '350000000000777'`, (x) => x[0].n === 1);
ok(r[0].n === 1, 'IMEI anotado depois');

ok(errors.length === 0, `sem erro de JS ${errors.join(' | ')}`);
await browser.close();
console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK');
process.exit(fails ? 1 : 0);
