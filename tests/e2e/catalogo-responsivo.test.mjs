// Catálogo em todas as telas: do iPhone SE (320 px) ao monitor Full HD,
// celular deitado e iPad. Em cada uma: nada passa da largura da tela, a
// sacola e o WhatsApp ficam inteiros na tela e sem se sobrepor, a ficha do
// produto e a sacola cabem e os botões principais são alcançáveis.
import { createDb, open, makePng, SHOTS } from './harness.mjs';

const DEVICES = (process.argv[2] || 'iPhone SE,Galaxy S8,iPhone 13,iPhone 15 Pro Max,iPhone 13 landscape,iPad Mini,iPad Pro 11 landscape,Desktop,Desktop 1920').split(',');
let fails = 0;
const ok = (c, m) => { console.log(`${c ? '  ✓' : '  ✗'} ${m}`); if (!c) fails++; };
const env = await createDb();
const q = async (sql, p) => (await env.db.query(sql, p)).rows;
const BASE = 'https://teste.supabase.co/storage/v1/object/public/produtos/';
env.uploads = new Map();

// um produto de cada categoria + o nome mais comprido, com fotos e preço
const painter = await open(env, { device: 'Desktop' });
const prods = await q(`
  (select distinct on (category_id) id, name, tracks_serial, colors from public.products where active and category_id is not null order by category_id, code)
  union (select id, name, tracks_serial, colors from public.products where active order by length(name) desc limit 1)`);
let n = 0;
for (const p of prods) {
  const colors = (p.colors?.length ? p.colors : ['Padrão']).slice(0, 2);
  const cp = {};
  for (const c of colors) {
    const f = await makePng(painter.page, { w: 900, h: 1200, label: String(n), color: ['#2b5c9e', '#9e2b5c', '#3a7d44', '#444'][n % 4] });
    env.uploads.set(`p/r${n}.png`, { type: 'image/png', body: f.buffer });
    cp[c] = [`${BASE}p/r${n}.png`];
    n++;
  }
  await env.db.query(`update public.products set color_photos = $2, show_in_catalog = true where id = $1`, [p.id, JSON.stringify(cp)]);
  const [c1, c2] = colors;
  const ready = (await q(`insert into public.product_variants (product_id, storage, color, condition, price, stock) values ($1, '256GB', $2, 'Seminovo', $3, $4) returning id`,
    [p.id, c1 === 'Padrão' ? '' : c1, 2899 + n * 137, p.tracks_serial ? 0 : 2]))[0];
  if (p.tracks_serial) {
    await env.db.query(`insert into public.units (variant_id, serial, cost) values ($1, $2, 1000)`, [ready.id, `35${String(n).padStart(13, '0')}`]);
    await env.db.query(`select public._variant_sync($1)`, [ready.id]);
  }
  await env.db.query(`insert into public.product_variants (product_id, storage, color, condition, on_order, order_price, order_lead) values ($1, '512GB', $2, 'Lacrado', true, $3, '7 a 15 dias')`,
    [p.id, (c2 || c1) === 'Padrão' ? '' : (c2 || c1), 12899 + n * 11]);
}
await painter.browser.close();
await env.db.query(`update public.store_settings set catalog_enabled = true, phone = '44999990000', instagram = 'i7even_store' where id = 1`);

/** Elementos que passam da largura da tela (fora de faixas que rolam/cortam de propósito). */
const overflow = (page) => page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const out = [];
  const clipped = (el) => { for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(a).overflowX)) return true; } return false; };
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (s.position !== 'fixed' && clipped(el)) continue;
    if (r.right > vw + 1 || r.left < -1) out.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''} [${Math.round(r.left)}…${Math.round(r.right)} de ${vw}]`);
  }
  return { scroll: document.documentElement.scrollWidth - vw, items: [...new Set(out)].slice(0, 6) };
});
const inView = (page, sel) => page.evaluate((sel) => {
  const el = [...document.querySelectorAll(sel)].find((x) => x.getClientRects().length);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { ok: r.left >= -0.5 && r.top >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5, r: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)], vw: innerWidth, vh: innerHeight };
}, sel);
const overlap = (page, a, b) => page.evaluate(([a, b]) => {
  const ra = document.querySelector(a)?.getBoundingClientRect();
  const rb = document.querySelector(b)?.getBoundingClientRect();
  if (!ra || !rb) return 0;
  const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
  const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
  return w > 0 && h > 0 ? Math.round(w * h) : 0;
}, [a, b]);

for (const device of DEVICES) {
  const tag = device.replace(/\W/g, '');
  console.log(`== ${device}`);
  const big = device === 'Desktop 1920';
  const { browser, page, errors } = await open(env, { device: big ? 'Desktop' : device, path: 'catalogo.html' });
  if (big) await page.setViewportSize({ width: 1920, height: 1080 });
  const touch = !device.startsWith('Desktop');
  const tap = (l) => (touch ? l.first().tap() : l.first().click());
  await page.waitForSelector('.cat-card');
  await page.waitForTimeout(700);
  let o = await overflow(page);
  ok(o.scroll <= 1 && !o.items.length, `topo sem nada passando da tela ${o.items.join(' | ')}`);
  await page.screenshot({ path: `${SHOTS}resp-${tag}-1-topo.png` });
  const wa = await inView(page, '.cat-fab-wa');
  ok(wa?.ok, `WhatsApp flutuante inteiro na tela ${JSON.stringify(wa?.r)}`);
  const cards = await page.evaluate(() => [...document.querySelectorAll('.cat-card')].filter((c) => c.scrollWidth > c.clientWidth + 1).length);
  ok(cards === 0, `cartões sem conteúdo vazando (${cards})`);

  // ficha do produto
  await tap(page.locator('.cat-card'));
  await page.waitForSelector('.cat-sheet[open] [data-add]');
  await page.waitForTimeout(600);
  const panel = await inView(page, '.cat-sheet[open] .cat-sheet-panel');
  ok(panel && panel.r[0] >= -0.5 && panel.r[2] <= panel.vw + 0.5, `ficha cabe na largura ${JSON.stringify(panel?.r)}`);
  const close = await inView(page, '.cat-sheet[open] .cat-close');
  ok(close?.ok, `botão fechar visível ${JSON.stringify(close?.r)}`);
  await page.locator('.cat-sheet[open] [data-add]').scrollIntoViewIfNeeded();
  const add = await inView(page, '.cat-sheet[open] [data-add]');
  ok(add?.ok, `"Adicionar à sacola" alcançável ${JSON.stringify(add?.r)}`);
  o = await overflow(page);
  ok(!o.items.length, `ficha sem nada passando da tela ${o.items.join(' | ')}`);
  await page.screenshot({ path: `${SHOTS}resp-${tag}-2-ficha.png` });
  await tap(page.locator('.cat-sheet[open] [data-add]'));
  await page.waitForTimeout(900);

  // sacola flutuante
  const bag = await inView(page, '.cat-fab-bag');
  ok(bag?.ok, `sacola flutuante inteira na tela ${JSON.stringify(bag?.r)}`);
  const ov = await overlap(page, '.cat-fab-bag', '.cat-fab-wa');
  ok(ov === 0, `sacola e WhatsApp não se sobrepõem (${ov}px²)`);
  o = await overflow(page);
  ok(o.scroll <= 1 && !o.items.length, `com a sacola, nada passa da tela ${o.items.join(' | ')}`);
  await page.screenshot({ path: `${SHOTS}resp-${tag}-3-sacola.png` });

  // folha da sacola
  await tap(page.locator('.cat-fab-bag'));
  await page.waitForSelector('.cat-sheet[open] [data-send]');
  await page.waitForTimeout(500);
  const bagPanel = await inView(page, '.cat-sheet[open] .cat-sheet-panel');
  ok(bagPanel && bagPanel.r[0] >= -0.5 && bagPanel.r[2] <= bagPanel.vw + 0.5, `sacola cabe na largura ${JSON.stringify(bagPanel?.r)}`);
  await page.locator('.cat-sheet[open] [data-send] button[type="submit"]').scrollIntoViewIfNeeded();
  const send = await inView(page, '.cat-sheet[open] [data-send] button[type="submit"]');
  ok(send?.ok, `"Enviar pedido" alcançável ${JSON.stringify(send?.r)}`);
  o = await overflow(page);
  ok(!o.items.length, `sacola sem nada passando da tela ${o.items.join(' | ')}`);
  await page.screenshot({ path: `${SHOTS}resp-${tag}-4-sacola-aberta.png` });

  ok(errors.length === 0, `sem erro de JS ${errors.join(' | ')}`);
  await browser.close();
}
console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK');
process.exit(fails ? 1 : 0);
