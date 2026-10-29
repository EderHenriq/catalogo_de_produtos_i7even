// Tela Vitrine no iPhone: entra pelo menu (que rola), liga/desliga o produto
// no catálogo, "com foto e sem preço" oferece Pôr à venda, e a ficha escolhe
// a foto do cartão, ordena as fotos tocando na ordem, muda a ordem das cores,
// esconde uma versão e marca destaque - tudo gravado no banco.
import { createDb, open, makePng, SHOTS } from './harness.mjs';

let fails = 0;
const ok = (c, m) => { console.log(`${c ? '  ✓' : '  ✗'} ${m}`); if (!c) fails++; };
const env = await createDb();
const q = async (sql, p) => (await env.db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];
const BASE = 'https://teste.supabase.co/storage/v1/object/public/produtos/';
env.uploads = new Map();

// fotos de teste (geradas no navegador)
const painter = await open(env, { device: 'Desktop' });
const put = async (key, label, color) => {
  const f = await makePng(painter.page, { w: 600, h: 800, label, color });
  env.uploads.set(`p/${key}.png`, { type: 'image/png', body: f.buffer });
  return `${BASE}p/${key}.png`;
};
const [A, B, C, D, E] = [await put('a', 'A', '#222'), await put('b', 'B', '#555'), await put('c', 'C', '#888'), await put('d', 'D', '#2b5c9e'), await put('e', 'E', '#3a7d44')];
await painter.browser.close();

const p13 = await one(`select id, colors from public.products where slug = 'iphone-13'`);
await env.db.query(`update public.products set color_photos = $2 where id = $1`, [p13.id, JSON.stringify({ 'Meia-noite': [A, B, C], Azul: [D] })]);
const vReady = await one(`insert into public.product_variants (product_id, storage, color, condition, price) values ($1, '128GB', 'Meia-noite', 'Seminovo', 2500) returning id`, [p13.id]);
await env.db.query(`insert into public.units (variant_id, serial, cost) values ($1, '350000000000123', 2000)`, [vReady.id]);
await env.db.query(`select public._variant_sync($1)`, [vReady.id]);
const vEnc = await one(`insert into public.product_variants (product_id, storage, color, condition, on_order, order_price, order_lead) values ($1, '128GB', 'Azul', 'Lacrado', true, 2300, '7 a 15 dias') returning id`, [p13.id]);
const p12 = await one(`select id from public.products where slug = 'iphone-12'`);
await env.db.query(`update public.products set color_photos = $2 where id = $1`, [p12.id, JSON.stringify({ Preto: [E] })]);
await env.db.query(`update public.store_settings set catalog_enabled = true where id = 1`);

const { browser, page, errors } = await open(env, { device: 'iPhone 13' });
const top = () => page.locator('dialog.modal[open]').last();
const waitDb = async (sql, test, ms = 6000) => {
  const t0 = Date.now();
  for (;;) { const r = await q(sql); if (test(r)) return r; if (Date.now() - t0 > ms) return r; await page.waitForTimeout(150); }
};
await page.waitForSelector('.app');

console.log('1. menu do celular rola até a Vitrine');
await page.locator('.tabbar [data-drawer-toggle]').tap();
await page.waitForTimeout(400);
const scroll = await page.evaluate(() => { const s = document.querySelector('.sidebar'); s.scrollTop = 9999; return { over: s.scrollHeight > s.clientHeight, top: s.scrollTop }; });
ok(scroll.over && scroll.top > 0, `menu maior que a tela rola por dentro (desceu ${scroll.top}px)`);
await page.locator('.sidebar [data-route="vitrine"]').tap();
await page.waitForSelector('.vit-card');
ok(await page.locator('.vit-card', { hasText: 'iPhone 13' }).count() === 1, 'iPhone 13 na vitrine (No catálogo)');
await page.screenshot({ path: `${SHOTS}vitrine-tela-grade.png` });

console.log('2. chave No catálogo e filtros');
await page.locator('.vit-card', { hasText: 'iPhone 13' }).locator('.vit-switch').tap();
let r = await waitDb(`select show_in_catalog from public.products where id = '${p13.id}'`, (x) => x[0].show_in_catalog === false);
ok(r[0].show_in_catalog === false, 'desligou: saiu do catálogo');
await page.locator('[data-filter="escondidos"]').tap();
await page.waitForTimeout(300);
ok(await page.locator('.vit-card.is-off', { hasText: 'iPhone 13' }).count() === 1, 'aparece em "Escondidos"');
await page.locator('.vit-card', { hasText: 'iPhone 13' }).locator('.vit-switch').tap();
r = await waitDb(`select show_in_catalog from public.products where id = '${p13.id}'`, (x) => x[0].show_in_catalog === true);
ok(r[0].show_in_catalog === true, 'ligou de novo');
await page.locator('[data-filter="prontos"]').tap();
await page.waitForTimeout(300);
ok(await page.locator('.vit-card', { hasText: 'iPhone 12' }).locator('[data-sell]').count() === 1, '"Com foto, sem preço": iPhone 12 com "Pôr à venda"');
await page.locator('[data-filter="mostra"]').tap();
await page.waitForTimeout(300);

console.log('3. ficha: foto do cartão');
await page.locator('.vit-card', { hasText: 'iPhone 13' }).locator('.vit-photo').tap();
await page.waitForSelector('.vit-covers');
await top().locator('[data-cover="Azul"]').tap();
r = await waitDb(`select image_url from public.products where id = '${p13.id}'`, (x) => x[0].image_url === D);
ok(r[0].image_url === D, 'cartão com a foto da cor Azul');
await top().locator('[data-cover=""]').tap();
r = await waitDb(`select image_url from public.products where id = '${p13.id}'`, (x) => !x[0].image_url);
ok(!r[0].image_url, 'volta para automática');

console.log('4. ordenar as fotos tocando na ordem');
await top().locator('[data-order="Meia-noite"]').tap();
const row = top().locator('[data-row="Meia-noite"]');
await row.locator(`[data-pick="${C}"]`).tap();
await row.locator(`[data-pick="${A}"]`).tap();
ok(await row.locator(`[data-pick="${C}"] .vit-num`).innerText() === '1' && await row.locator(`[data-pick="${A}"] .vit-num`).innerText() === '2', 'números na ordem tocada: C = 1, A = 2');
await page.screenshot({ path: `${SHOTS}vitrine-tela-ordenar.png` });
await top().locator('[data-order-save]').tap();
r = await waitDb(`select color_photos from public.products where id = '${p13.id}'`, (x) => x[0].color_photos['Meia-noite'][0] === C);
ok(JSON.stringify(r[0].color_photos['Meia-noite']) === JSON.stringify([C, A, B]), 'ordem salva: C, A, B (a não tocada vai depois)');

console.log('5. ordem das cores, versão escondida e destaque');
const before = (await one(`select colors from public.products where id = $1`, [p13.id])).colors;
const colorsShown = await top().locator('[data-row]').evaluateAll((els) => els.map((e) => e.dataset.row));
const iAzul = colorsShown.indexOf('Azul');
await top().locator(`[data-row="Azul"] [data-dir="-1"]`).tap();
r = await waitDb(`select colors from public.products where id = '${p13.id}'`, (x) => x[0].colors.indexOf('Azul') === iAzul - 1);
ok(r[0].colors.indexOf('Azul') === iAzul - 1, `Azul subiu uma posição (${before.join(', ')} → ${r[0].colors.join(', ')})`);
await top().locator('.vit-version', { hasText: 'Azul' }).locator('.switch').tap();
r = await waitDb(`select show_in_catalog from public.product_variants where id = '${vEnc.id}'`, (x) => x[0].show_in_catalog === false);
ok(r[0].show_in_catalog === false, 'versão de encomenda Azul escondida');
await page.waitForTimeout(500);   // a ficha termina de redesenhar depois da gravação anterior
await top().locator('label.check-row', { has: page.locator('[data-p-feat]') }).tap();
r = await waitDb(`select featured from public.products where id = '${p13.id}'`, (x) => x[0].featured === true);
ok(r[0].featured === true, 'em destaque');
await page.screenshot({ path: `${SHOTS}vitrine-tela-ficha.png` });

ok(errors.length === 0, `sem erro de JS ${errors.join(' | ')}`);
await browser.close();
console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK');
process.exit(fails ? 1 : 0);
