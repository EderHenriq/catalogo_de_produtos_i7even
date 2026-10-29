// Lista do fornecedor → catálogo de encomenda, de ponta a ponta:
// cola a mensagem do WhatsApp → confere → corrige a cor que faltou → ajusta
// um preço de venda à mão → publica → o cliente vê "Sob encomenda" com o
// prazo, escolhe entre pronta entrega e encomenda e pede → a loja vê o
// pedido marcado como encomenda e transforma em pedido.
import { createDb, open, SHOTS, audit } from './harness.mjs';

const DEVICE = process.argv[2] || 'iPhone 13';
const tag = DEVICE.replace(/\W/g, '');
let fails = 0;
const ok = (c, m) => { console.log(`${c ? '  ✓' : '  ✗'} ${m}`); if (!c) fails++; };
const env = await createDb();
const q = async (sql, p) => (await env.db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];
const touch = DEVICE !== 'Desktop';
const waitDb = async (sql, test, ms = 6000, pg = null) => {
  const t0 = Date.now();
  for (;;) { const r = await q(sql); if (test(r)) return r; if (Date.now() - t0 > ms) return r; await (pg ? pg.waitForTimeout(150) : new Promise((res) => setTimeout(res, 150))); }
};

// Um iPhone 15 com estoque (pronta entrega) para testar as duas ofertas na mesma versão.
const P15 = await one(`select id from public.products where slug = 'iphone-15'`);
await env.db.query(`update public.store_settings set catalog_enabled = true where id = 1`);
await env.db.query(`insert into public.product_variants (product_id, storage, color, condition, price, stock) values ($1, '128GB', 'Preto', 'Lacrado', 4590, 0)`, [P15.id]);
const V15 = await one(`select id from public.product_variants where product_id = $1 and storage = '128GB' and color = 'Preto'`, [P15.id]);
await env.db.query(`update public.product_variants set stock = 2 where id = $1`, [V15.id]);
await env.db.query(`update public.products set show_in_catalog = true, active = true where id = $1`, [P15.id]);

const { browser, page, errors } = await open(env, { device: DEVICE });
const tap = (loc) => (touch ? loc.first().tap() : loc.first().click());
const top = () => page.locator('dialog.modal[open]').last();
const shot = (n) => page.screenshot({ path: `${SHOTS}enc-${tag}-${n}.png` });
await page.waitForSelector('.app');

console.log('1. colar a lista do fornecedor');
await page.evaluate(() => { location.hash = '#/catalogo'; });
await page.waitForTimeout(300);
await tap(page.locator('[data-tab="encomenda"]'));
await tap(page.locator('[data-paste-list]'));
await page.waitForSelector('#ol-text');
const LIST = `Bom dia! Segue a lista 👇
📱 IPHONE 15
128 preto 3.900
256 azul 4.400
*SEMINOVOS*
iPhone 14 Pro 128 roxo 3.300
iPhone 16 Pro 256 4.900
Frete grátis acima de 5 aparelhos
Galaxy S24 256 3.000`;
await top().locator('#ol-text').fill(LIST);
await top().locator('#ol-sup').fill('Fornecedor SP');
await top().locator('#ol-lead').fill('7 a 10 dias');
await top().locator('#ol-markup').fill('10');
await top().locator('#ol-round').selectOption('10');
await shot('01-colar');
const a1 = await audit(page, 'colar-lista', { mobile: touch }); if (a1.length) console.log('    ⚠', a1.join('\n    ⚠ '));
await tap(top().locator('[data-read]'));
await page.waitForSelector('.olist-row');
const rows = top().locator('.olist-row');
ok(await rows.count() === 4, `4 ofertas reconhecidas (${await rows.count()})`);
ok(await top().locator('.olist-unknown li').count() >= 1, 'outra marca listada como "não entendida"');
const P16P = await one(`select colors from public.products where slug = 'iphone-16-pro'`);
const allColors = top().locator('.olist-row', { hasText: '16 Pro' });
ok(await top().locator('.olist-row.has-issue').count() === 0, 'nenhuma linha travada');
ok((await allColors.innerText()).includes('cliente escolhe') && await allColors.locator('[data-include]').isChecked(),
  'linha sem cor vira "todas as cores" (o cliente escolhe a cor no catálogo)');
// custo 3.900 + 10% = 4.290 → arredonda para 4.290 (já múltiplo de 10)
const firstSale = await rows.nth(0).locator('[data-sale]').inputValue();
ok(firstSale === '4.290,00', `preço de venda sugerido = custo + margem (${firstSale})`);
await shot('02-conferir');
const a2 = await audit(page, 'conferir-lista', { mobile: touch }); if (a2.length) console.log('    ⚠', a2.join('\n    ⚠ '));

console.log('2. ajustar o preço de venda');
const r2 = top().locator('.olist-row').nth(1);
await r2.locator('[data-sale]').fill('');
await r2.locator('[data-sale]').pressSequentially('499900');
// recalcular não mexe no que foi digitado à mão
await tap(top().locator('.olist-bulk > summary'));
await tap(top().locator('[data-reprice]'));
await page.waitForTimeout(200);
ok(await top().locator('.olist-row').nth(1).locator('[data-sale]').inputValue() === '4.999,00', 'preço digitado à mão sobrevive ao "recalcular"');
await tap(top().locator('[data-publish]'));
await page.waitForTimeout(400);
// confirmação de "substituir" não aparece (replace desligado)
const TOTAL = 3 + P16P.colors.length;
let r = await waitDb(`select count(*)::int n from public.product_variants where on_order and order_supplier = 'Fornecedor SP'`, (x) => x[0].n === TOTAL, 6000, page);
ok(r[0].n === TOTAL, `${TOTAL} ofertas gravadas: 3 + o 16 Pro em ${P16P.colors.length} cores (${r[0].n})`);
r = await q(`select v.storage, v.color, v.condition, v.order_price::float p, v.order_cost::float c, v.order_lead, v.price::float price, v.stock
             from public.product_variants v join public.products p on p.id = v.product_id where p.slug = 'iphone-15' and v.on_order order by v.storage`);
ok(r[0]?.p === 4290 && r[0]?.c === 3900 && r[0]?.order_lead === '7 a 10 dias', 'iPhone 15 128 preto: venda 4.290, custo 3.900, prazo');
ok(r[0]?.price === 4590 && r[0]?.stock === 2, 'a pronta entrega da mesma versão continua como estava');
ok(r[1]?.p === 4999, 'preço editado à mão gravado (4.999)');
const semi = await one(`select v.condition from public.product_variants v join public.products p on p.id = v.product_id where p.slug = 'iphone-14-pro' and v.on_order`);
ok(semi?.condition === 'Seminovo', 'seção *SEMINOVOS* vira condição Seminovo');
await page.waitForTimeout(300);
ok(await page.locator('.offer-row').count() === TOTAL, `aba "Sob encomenda" lista as ${TOTAL} ofertas`);
await shot('03-ofertas');
const a3 = await audit(page, 'ofertas', { mobile: touch }); if (a3.length) console.log('    ⚠', a3.join('\n    ⚠ '));

console.log('3. colar de novo substituindo (lista nova sem o 14 Pro)');
await tap(page.locator('[data-paste-list]'));
await page.waitForSelector('#ol-text');
await top().locator('#ol-text').fill('IPHONE 15\n128 preto 3.800\n256 azul 4.300');
await top().locator('#ol-sup').fill('Fornecedor SP');
await tap(top().locator('[data-read]'));
await page.waitForSelector('.olist-row');
await tap(top().locator('label.check', { has: page.locator('[data-replace]') }));
ok(await top().locator('[data-replace]').isChecked(), 'opção "substituir" marcada');
await shot('03b-substituir');
await tap(top().locator('[data-publish]'));
await page.waitForSelector('dialog.modal[open] [data-confirm]');
await tap(top().locator('[data-confirm]'));
r = await waitDb(`select count(*)::int n from public.product_variants where on_order and order_supplier = 'Fornecedor SP'`, (x) => x[0].n === 2, 6000, page);
ok(r[0].n === 2, `substituir: só as 2 da lista nova continuam (${r[0].n})`);
r = await one(`select order_price::float p from public.product_variants where id = $1`, [V15.id]);
ok(r.p === 4180, `preço atualizado com a lista nova (3.800 + 10% → ${r.p})`);

console.log('4. cliente no catálogo');
const c = await open(env, { device: DEVICE, path: 'catalogo.html' });
await c.page.waitForSelector('.cat-card');
ok(await c.page.locator('[data-avail="encomenda"]').count() === 1, 'filtro Pronta entrega / Encomenda aparece');
await (touch ? c.page.locator('[data-avail="encomenda"]').tap() : c.page.locator('[data-avail="encomenda"]').click());
await c.page.waitForTimeout(300);
const cards = await c.page.locator('.cat-card').count();
ok(cards === 1, `só encomenda: 1 modelo (${cards})`);
ok((await c.page.locator('.cat-card').first().innerText()).includes('7 a 10 dias'), 'cartão com selo "Sob encomenda · prazo"');
// tocar de novo no filtro ligado volta a mostrar tudo
await (touch ? c.page.locator('[data-avail="encomenda"]').tap() : c.page.locator('[data-avail="encomenda"]').click());
ok((await c.page.locator('[data-count]').innerText()).startsWith('Exibindo'), `contador "Exibindo N produtos" (${await c.page.locator('[data-count]').innerText()})`);
const ca = await audit(c.page, 'catalogo-novo', { mobile: touch }); if (ca.length) console.log('    ⚠', ca.join(' | '));
await c.page.waitForTimeout(200);
await c.page.screenshot({ path: `${SHOTS}enc-${tag}-04-catalogo.png` });
await (touch ? c.page.locator('.cat-card', { hasText: 'iPhone 15' }).first().tap() : c.page.locator('.cat-card', { hasText: 'iPhone 15' }).first().click());
await c.page.waitForSelector('.cat-sheet[open] .cat-price');
const sheet = c.page.locator('.cat-sheet[open]');
// versão 128 preto: as duas ofertas
await (touch ? sheet.locator('[data-opt="storage"][data-val="128GB"]').tap() : sheet.locator('[data-opt="storage"][data-val="128GB"]').click());
await c.page.waitForTimeout(200);
ok(await sheet.locator('[data-mode]').count() === 2, 'versão com estoque e encomenda: as duas escolhas aparecem');
ok((await sheet.locator('.cat-price').innerText()).includes('4.590'), 'começa na pronta entrega (R$ 4.590)');
await (touch ? sheet.locator('[data-mode="encomenda"]').tap() : sheet.locator('[data-mode="encomenda"]').click());
await c.page.waitForTimeout(200);
ok((await c.page.locator('.cat-sheet[open] .cat-price').innerText()).includes('4.180'), 'escolheu encomenda: R$ 4.180');
await c.page.screenshot({ path: `${SHOTS}enc-${tag}-05-ficha.png` });
const a4 = await audit(c.page, 'ficha-encomenda', { mobile: touch }); if (a4.length) console.log('    ⚠', a4.join('\n    ⚠ '));
await (touch ? c.page.locator('.cat-sheet[open] [data-add]').tap() : c.page.locator('.cat-sheet[open] [data-add]').click());
await c.page.waitForTimeout(500);
// e uma de pronta entrega da mesma versão
await (touch ? c.page.locator('.cat-card', { hasText: 'iPhone 15' }).first().tap() : c.page.locator('.cat-card', { hasText: 'iPhone 15' }).first().click());
await c.page.waitForSelector('.cat-sheet[open] .cat-price');
await (touch ? c.page.locator('.cat-sheet[open] [data-opt="storage"][data-val="128GB"]').tap() : c.page.locator('.cat-sheet[open] [data-opt="storage"][data-val="128GB"]').click());
await c.page.waitForTimeout(150);
await (touch ? c.page.locator('.cat-sheet[open] [data-mode="pronta"]').tap() : c.page.locator('.cat-sheet[open] [data-mode="pronta"]').click());
await (touch ? c.page.locator('.cat-sheet[open] [data-add]').tap() : c.page.locator('.cat-sheet[open] [data-add]').click());
await c.page.waitForTimeout(500);
await (touch ? c.page.locator('.cat-fab-bag').first().tap() : c.page.locator('.cat-fab-bag').first().click());
await c.page.waitForSelector('.cat-bag[open] .cat-bag-item');
ok(await c.page.locator('.cat-bag[open] .cat-bag-item').count() === 2, 'sacola com a mesma versão em 2 linhas (pronta e encomenda)');
ok((await c.page.locator('.cat-bag[open] .cat-bag-total').innerText()).includes('8.770'), 'total 4.590 + 4.180 = 8.770');
await c.page.locator('.cat-bag[open] input[name="name"]').fill('Cliente Encomenda');
await c.page.locator('.cat-bag[open] input[name="phone"]').fill('44988887777');
await c.page.screenshot({ path: `${SHOTS}enc-${tag}-06-sacola.png` });
await (touch ? c.page.locator('.cat-bag[open] [type="submit"]').tap() : c.page.locator('.cat-bag[open] [type="submit"]').click());
await c.page.waitForSelector('.cat-done', { timeout: 8000 });
r = await one(`select items, total::float total from public.catalog_requests order by created_at desc limit 1`);
const modes = (r?.items || []).map((i) => i.mode).sort();
ok(JSON.stringify(modes) === '["encomenda","pronta"]', `pedido gravado com os dois modos (${modes})`);
ok(r?.total === 8770, `total do BANCO 8.770 (${r?.total})`);
ok(c.errors.length === 0, `catálogo sem erro de JS ${c.errors.join(' | ')}`);
await c.browser.close();

console.log('5. loja vê e transforma em pedido');
await page.evaluate(() => { location.hash = '#/dashboard'; });
await page.waitForTimeout(200);
await page.evaluate(async () => { const m = await import('/assets/js/core/data.js'); await m.reload('catalogRequests'); });
await page.evaluate(() => { location.hash = '#/catalogo'; });
await page.waitForTimeout(600);
await tap(page.locator('[data-tab="pedidos"]'));
await page.waitForTimeout(300);
ok((await page.locator('.request-card').first().innerText()).toLowerCase().includes('encomenda · 7 a 10 dias'), 'pedido do catálogo mostra o item de encomenda com prazo');
await tap(page.locator('[data-req-order]'));
await page.waitForSelector('[data-save]');
const itemsTxt = await top().locator('.item-row').allInnerTexts();
ok(itemsTxt.length === 2, `pedido com 2 itens (${itemsTxt.length})`);
await shot('07-pedido');

ok(errors.length === 0, `sem erro de JS no app ${errors.join(' | ')}`);
await browser.close();
console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK');
process.exit(fails ? 1 : 0);
