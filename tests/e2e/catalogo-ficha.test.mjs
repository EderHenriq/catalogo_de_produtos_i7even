// Ficha do produto no catálogo: trocar opção não faz a folha pular (antes a
// animação de subida rodava de novo e ela saía da tela), setas de foto só no
// computador (e teclado), troca de cor com transição curta, galeria parada ao
// trocar capacidade e foco de abertura fora do X.
import { createDb, open, makePng, SHOTS } from './harness.mjs';
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


// um modelo com 3 fotos na 1ª cor e 2 cores à venda
// sempre o mesmo modelo (um iPhone com duas cores), para o teste não depender da ordem do banco
const P = (await q(`select p.id, p.color_photos from public.products p join public.product_variants v on v.product_id = p.id
  where p.show_in_catalog and p.slug like 'iphone%' group by p.id, p.code having count(distinct v.color) >= 2 order by p.code limit 1`))[0];
const colors = Object.keys(P.color_photos);
const pp = await open(env, { device: 'Desktop' });
const extra = [];
for (let i = 0; i < 2; i++) { const f = await makePng(pp.page, { w: 900, h: 1200, label: `x${i}`, color: '#b5651d' }); env.uploads.set(`p/x${i}.png`, { type: 'image/png', body: f.buffer }); extra.push(`${BASE}p/x${i}.png`); }
await pp.browser.close();
P.color_photos[colors[0]] = [...P.color_photos[colors[0]], ...extra];
await env.db.query(`update public.products set color_photos = $2 where id = $1`, [P.id, JSON.stringify(P.color_photos)]);
// a 1ª cor também em 512GB seminovo: trocar a capacidade não muda a cor (nem as fotos)
await env.db.query(`insert into public.product_variants (product_id, storage, color, condition, price, stock) values ($1, '512GB', $2, 'Seminovo', 4599, 1)`, [P.id, colors[0]]);

let fails = 0;
const ok2 = (c, m) => { console.log(`${c ? '  ✓' : '  ✗'} ${m}`); if (!c) fails++; };
for (const device of ['Desktop', 'iPhone 13']) {
  console.log('==', device);
  const { browser, page, errors } = await open(env, { device, path: `catalogo.html#p=${P.id}` });
  await page.waitForSelector('.cat-sheet[open] [data-add]');
  await page.waitForTimeout(900);
  const st = () => page.evaluate(() => {
    const car = document.querySelector('.cat-sheet[open] [data-carousel]');
    const arrows = [...document.querySelectorAll('.cat-sheet[open] .cat-arrow')].filter((a) => getComputedStyle(a).display !== 'none').length;
    return { slides: document.querySelectorAll('.cat-sheet[open] .cat-slide').length, idx: car ? Math.round(car.scrollLeft / car.clientWidth) : -1, arrows,
      dot: [...document.querySelectorAll('.cat-sheet[open] [data-slide]')].findIndex((b) => b.getAttribute('aria-pressed') === 'true'),
      active: document.activeElement?.className, color: document.querySelector('.cat-sheet[open] .cat-opt-btn[data-opt="color"][aria-pressed="true"]')?.dataset.val };
  });
  let s = await st();
  console.log('   ', JSON.stringify(s));
  ok2(!/cat-close/.test(s.active || ''), `foco ao abrir não fica no X (${s.active})`);
  // garante a cor com 3 fotos
  if (s.slides < 3) { await page.locator(`.cat-sheet[open] [data-opt="color"][data-val="${colors[0]}"]`).click(); await page.waitForTimeout(700); s = await st(); console.log('   ', JSON.stringify(s)); }
  if (device === 'Desktop') {
    ok2(s.arrows === 2, `duas setas na foto (${s.arrows})`);
    await page.locator('.cat-sheet[open] .cat-arrow.next').click(); await page.waitForTimeout(700);
    s = await st(); ok2(s.idx === 1 && s.dot === 1, `seta → vai para a 2ª foto (${s.idx}, bolinha ${s.dot})`);
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(700);
    s = await st(); ok2(s.idx === 2, `tecla → 3ª foto (${s.idx})`);
    await page.locator('.cat-sheet[open] .cat-arrow.next').click(); await page.waitForTimeout(700);
    s = await st(); ok2(s.idx === 0, `depois da última volta para a 1ª (${s.idx})`);
    await page.locator('.cat-sheet[open] .cat-arrow.prev').click(); await page.waitForTimeout(700);
    s = await st(); ok2(s.idx === 2, `seta ← da 1ª vai para a última (${s.idx})`);
    await page.screenshot({ path: `${SHOTS}setas-desktop.png` });
  } else {
    ok2(s.arrows === 0, `celular sem setas (${s.arrows})`);
  }
  // tocar numa opção não faz a folha descer e voltar (nenhuma animação de subida rodando)
  const panelState = () => page.evaluate(() => {
    const el = document.querySelector('.cat-sheet[open] .cat-sheet-panel');
    return { top: Math.round(el.getBoundingClientRect().top), anim: el.getAnimations().filter((a) => a.playState === 'running').length };
  });
  const y0 = await panelState();
  await page.locator('.cat-sheet[open] [data-opt="condition"]').first().click();
  await page.waitForTimeout(60);
  const y1 = await panelState();
  ok2(y1.anim === 0 && (device === 'Desktop' || y1.top === y0.top), `trocar opção não faz a ficha pular (topo ${y0.top} → ${y1.top}, animações ${y1.anim})`);
  await page.waitForTimeout(400);
  // volta para a 1ª cor, seminovo, 256GB
  await page.locator(`.cat-sheet[open] [data-opt="color"][data-val="${colors[0]}"]`).click();
  await page.waitForTimeout(400);
  const semi = page.locator('.cat-sheet[open] [data-opt="condition"][data-val="Seminovo"]');
  if (await semi.count()) { await semi.click(); await page.waitForTimeout(400); }
  const s256 = page.locator('.cat-sheet[open] [data-opt="storage"][data-val="256GB"]');
  if (await s256.count()) { await s256.click(); await page.waitForTimeout(400); }
  // trocar capacidade: a galeria (mesmo elemento) fica
  const before = await page.evaluate(() => { window.__gal = document.querySelector('.cat-sheet[open] .cat-sheet-gallery'); return true; });
  const storages = await page.locator('.cat-sheet[open] [data-opt="storage"]').count();
  ok2(storages > 1, `modelo com duas capacidades (${storages})`);
  if (storages > 1) {
    await page.locator('.cat-sheet[open] [data-opt="storage"][data-val="512GB"]').click();
    await page.waitForTimeout(100);
    const same = await page.evaluate(() => window.__gal === document.querySelector('.cat-sheet[open] .cat-sheet-gallery'));
    const tick = await page.evaluate(() => !!document.querySelector('.cat-sheet[open] .cat-price.cat-tick'));
    ok2(same, 'trocar capacidade mantém a galeria (sem recarregar a foto)');
    console.log(`    preço com fade curto: ${tick}`);
    await page.locator('.cat-sheet[open] [data-opt="storage"][data-val="256GB"]').click();
    await page.waitForTimeout(500);
  }
  // trocar a cor: foto antiga por cima e some em ~0,2s
  const other = colors[1];
  await page.locator(`.cat-sheet[open] [data-opt="color"][data-val="${other}"]`).click();
  const t0 = Date.now();
  let sawGhost = false, gone = -1;
  for (let i = 0; i < 40; i++) {
    const g = await page.evaluate(() => !!document.querySelector('.cat-sheet[open] .cat-ghost'));
    if (g) sawGhost = true; else if (sawGhost) { gone = Date.now() - t0; break; }
    await page.waitForTimeout(20);
  }
  const panelY = await page.evaluate(() => Math.round(document.querySelector('.cat-sheet[open] .cat-sheet-panel').getBoundingClientRect().top));
  ok2(sawGhost && gone > 0 && gone < 700, `troca de cor com transição curta (foto antiga some em ${gone} ms)`);
  ok2(panelY >= 0, `ficha não sai do lugar ao trocar a cor (topo ${panelY})`);
  ok2(errors.length === 0, `sem erro de JS ${errors.join(' | ')}`);
  await browser.close();
}
console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK');
process.exit(fails ? 1 : 0);
