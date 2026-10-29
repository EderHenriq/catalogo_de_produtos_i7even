// Tela Estoque (pronta entrega) no iPhone: barra de baixo com Estoque e
// Catálogo; a ficha do item edita preço, IMEI/bateria, tira e põe aparelho,
// a quantidade (sem IMEI) e as fotos da cor - tudo numa tela só.
import { createDb, open, makePng, SHOTS } from './harness.mjs';

let fails = 0;
const ok = (c, m) => { console.log(`${c ? '  ✓' : '  ✗'} ${m}`); if (!c) fails++; };
const env = await createDb();
const q = async (sql, p) => (await env.db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];

const p13 = await one(`select id from public.products where slug = 'iphone-13'`);
const v = await one(`insert into public.product_variants (product_id, storage, color, condition, price, image_url) values ($1, '128GB', 'Estelar', 'Seminovo', 2500, 'https://teste.supabase.co/storage/v1/object/public/produtos/p/antiga.webp') returning id`, [p13.id]);
await env.db.query(`insert into public.units (variant_id, serial, cost, battery_health) values ($1, '350000000000111', 2000, 88)`, [v.id]);
await env.db.query(`insert into public.units (variant_id, cost) values ($1, 1900)`, [v.id]);
await env.db.query(`select public._variant_sync($1)`, [v.id]);
const acc = await one(`select id, name from public.products where not tracks_serial and active order by code limit 1`);
const va = await one(`insert into public.product_variants (product_id, condition, price, stock) values ($1, 'Lacrado', 99, 3) returning id`, [acc.id]);

const { browser, page, errors } = await open(env, { device: 'iPhone 13' });
const top = () => page.locator('dialog.modal[open]').last();
const waitDb = async (sql, test, ms = 6000) => {
  const t0 = Date.now();
  for (;;) { const r = await q(sql); if (test(r)) return r; if (Date.now() - t0 > ms) return r; await page.waitForTimeout(150); }
};
await page.waitForSelector('.app');

console.log('1. barra de baixo');
const tabs = (await page.locator('.tabbar').innerText()).replace(/\s+/g, ' ');
ok(/Estoque/.test(tabs) && /Catálogo/.test(tabs) && !/Clientes/.test(tabs), `abas: ${tabs.trim()}`);
await page.locator('.tabbar [data-route="estoque"]').tap();
await page.waitForSelector('[data-item]');
ok(await page.locator('[data-item]').count() === 2, '2 itens a pronta entrega');
ok((await page.locator('[data-item]', { hasText: 'iPhone 13' }).innerText()).includes('1 sem IMEI'), 'linha avisa "1 sem IMEI"');
await page.screenshot({ path: `${SHOTS}estoque-tela-lista.png` });

console.log('2. ficha do iPhone: preço, IMEI, bateria, tirar e pôr aparelho');
await page.locator('[data-item]', { hasText: 'iPhone 13' }).tap();
await page.waitForSelector('[data-item-sheet] .stock-unit');
ok(await top().locator('.stock-unit').count() === 2, '2 aparelhos editáveis');
await top().locator('#si-price').fill('2.600,00');
const rows = top().locator('.stock-unit');
// o sem IMEI ganha IMEI e bateria; o que tinha IMEI sai; entra um novo
const noImei = rows.filter({ has: page.locator('[data-f="serial"][value=""]') });
await noImei.locator('[data-f="serial"]').fill('350000000000888');
await noImei.locator('[data-f="battery"]').fill('91');
await rows.filter({ has: page.locator('[data-f="serial"][value="350000000000111"]') }).locator('[data-rm]').tap();
await top().locator('[data-add-unit]').tap();
await top().locator('.stock-unit').last().locator('[data-f="serial"]').fill('350000000000999');
await page.screenshot({ path: `${SHOTS}estoque-tela-ficha.png` });
await top().locator('.modal-foot [data-ok]').tap();
let r = await waitDb(`select serial, status, battery_health from public.units where variant_id = '${v.id}' order by serial`, (x) => x.length === 3 && x.some((u) => u.serial === '350000000000999'));
const by = Object.fromEntries(r.map((u) => [u.serial, u]));
ok(by['350000000000111']?.status === 'baixa', 'aparelho tirado: baixa (fica no histórico)');
ok(by['350000000000888']?.status === 'estoque' && by['350000000000888'].battery_health === 91, 'IMEI e bateria anotados no aparelho que estava sem');
ok(by['350000000000999']?.status === 'estoque', 'aparelho novo cadastrado');
r = await one(`select price::float, stock from public.product_variants where id = $1`, [v.id]);
ok(r.price === 2600 && r.stock === 2, `preço 2600 e 2 aparelhos (${r.price}, ${r.stock})`);

console.log('3. item sem IMEI: + e −');
await page.waitForTimeout(400);
await page.locator('[data-item]', { hasText: acc.name }).tap();
await page.waitForSelector('[data-qty-input]');
await top().locator('[data-qty="1"]').tap();
await top().locator('[data-qty="1"]').tap();
await top().locator('[data-qty="-1"]').tap();
ok((await top().locator('[data-qty-box]').innerText()).includes('+1'), 'mostra "+1 ao salvar"');
await top().locator('.modal-foot [data-ok]').tap();
r = await waitDb(`select stock from public.product_variants where id = '${va.id}'`, (x) => x[0].stock === 4);
ok(r[0].stock === 4, `quantidade 3 → 4 (${r[0].stock})`);

console.log('4. fotos da cor pela ficha');
await page.waitForTimeout(400);
await page.locator('[data-item]', { hasText: 'iPhone 13' }).tap();
await page.waitForSelector('[data-photos]');
ok((await top().locator('[data-photos]').innerText()).includes('Fotos (1)'), 'a foto antiga da variação aparece');
await top().locator('[data-photos]').tap();
await page.waitForSelector('.gallery-field');
await top().locator('input[data-file][multiple]').setInputFiles([await makePng(page, { label: 'A' }), await makePng(page, { label: 'B', color: '#9e2b2b' })]);
await page.waitForFunction(() => document.querySelectorAll('dialog.modal[open]:last-of-type .gallery-tile:not(.is-busy)').length >= 3, null, { timeout: 15000 });
// remove a antiga (primeira) - as novas ficam
await top().locator('.gallery-tile').first().locator('[data-rm]').tap();
await top().locator('.modal-foot [data-ok]').tap();
r = await waitDb(`select color_photos from public.products where id = '${p13.id}'`, (x) => (x[0].color_photos?.Estelar || []).length === 2);
ok((r[0].color_photos?.Estelar || []).length === 2, 'cor Estelar com as 2 fotos novas');
r = await one(`select image_url from public.product_variants where id = $1`, [v.id]);
ok(!r.image_url, 'a foto presa na variação saiu (a da cor vale no catálogo)');
await page.waitForTimeout(300);
ok((await top().locator('[data-photos]').innerText()).includes('Fotos (2)'), 'ficha atualizada: Fotos (2)');
await top().locator('.modal-foot [data-close]').tap();

console.log('5. ficha do modelo: foto da cor abre o editor com todas');
await page.evaluate(() => { location.hash = '#/produtos'; });
await page.locator('[data-search]').fill('iphone 13');
await page.waitForTimeout(300);
await page.locator('.m-row', { has: page.locator('.m-title', { hasText: /^iPhone 13$/ }) }).first().tap();
await page.waitForSelector('[data-color-photo="Estelar"]');
ok((await page.locator('[data-color-photo="Estelar"] .color-photo-n').innerText()) === '2', 'miniatura da cor mostra "2" fotos');
await page.locator('[data-color-photo="Estelar"]').tap();
await page.waitForSelector('.gallery-field');
ok(await top().locator('.gallery-tile').count() === 2, 'editor abre com as 2 fotos da cor');

ok(errors.length === 0, `sem erro de JS ${errors.join(' | ')}`);
await browser.close();
console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK');
process.exit(fails ? 1 : 0);
