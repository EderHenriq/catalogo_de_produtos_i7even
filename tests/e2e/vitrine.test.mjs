// Vitrine de demonstração do catálogo público (visual imoove): vários
// iPhones com foto por cor em fundo branco, pronta entrega + encomenda,
// parcelamento 12x. Gera capturas no iPhone e no desktop, confere o
// layout (sem rolagem lateral, toques >= 36px, campos >= 16px) e a troca
// de foto ao escolher a cor (inclusive na versão sob encomenda).
import { createDb, open, SHOTS, audit } from './harness.mjs';

let fails = 0;
const ok = (c, m) => { console.log(`${c ? '  ✓' : '  ✗'} ${m}`); if (!c) fails++; };
const env = await createDb();
const q = async (sql, p) => (await env.db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];
const BASE = 'https://teste.supabase.co/storage/v1/object/public/produtos/';

// Fotos "de estúdio": aparelho desenhado em canvas sobre fundo branco (como o upload deixa).
const { page: painter, browser: b0 } = await open(env, { device: 'Desktop' });
async function phonePhoto(name, color) {
  const b64 = await painter.evaluate(({ color }) => {
    const c = document.createElement('canvas'); c.width = 900; c.height = 900;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 900, 900);
    const r = (x, y, w, h, rad, fill) => { g.beginPath(); g.roundRect(x, y, w, h, rad); g.fillStyle = fill; g.fill(); };
    g.shadowColor = 'rgba(0,0,0,.18)'; g.shadowBlur = 40; g.shadowOffsetY = 18;
    r(250, 120, 330, 660, 70, color);
    g.shadowColor = 'transparent';
    r(330, 160, 330, 660, 70, '#1b1b1d');
    r(342, 172, 306, 636, 60, `linear-gradient` && '#2c2f36');
    const grd = g.createLinearGradient(342, 172, 648, 808); grd.addColorStop(0, '#3a4a6b'); grd.addColorStop(1, '#0d0f14');
    r(342, 172, 306, 636, 60, grd);
    r(270, 150, 150, 150, 40, 'rgba(0,0,0,.12)');
    for (const [x, y] of [[300, 180], [360, 180], [300, 240]]) { g.beginPath(); g.arc(x + 18, y + 18, 26, 0, 7); g.fillStyle = '#111'; g.fill(); }
    return c.toDataURL('image/png').split(',')[1];
  }, { color });
  const path = `p/demo-${name}.png`;
  env.uploads.set(path, { type: 'image/png', body: Buffer.from(b64, 'base64') });
  env.uploads.set(path.replace('.png', '.t.png'), { type: 'image/png', body: Buffer.from(b64, 'base64') });
  return BASE + path;
}

const MODELS = [
  ['iphone-17-pro-max', [['Laranja-cósmico', '#e9733a'], ['Azul-profundo', '#3c4a5e'], ['Prateado', '#e6e6e8']], 9587, true],
  ['iphone-17-pro', [['Prateado', '#e6e6e8'], ['Laranja-cósmico', '#e9733a']], 8387, false],
  ['iphone-16-pro', [['Titânio-deserto', '#bfa48f'], ['Titânio natural', '#bab4a9']], 7299, false],
  ['iphone-16', [['Ultramarino', '#6f82d9'], ['Rosa', '#f3c9cf'], ['Preto', '#2a2a2c']], 5199, true],
  ['iphone-15', [['Preto', '#2a2a2c'], ['Azul', '#bcd0e0']], 4290, false],
  ['iphone-13', [['Meia-noite', '#232a31'], ['Estelar', '#f0e5d3']], 2650, false],
];
let firstColorChanged = null;
for (const [slug, colors, price, semi] of MODELS) {
  const p = await one(`select id, storages, colors from public.products where slug = $1`, [slug]);
  if (!p) { console.log('  ! sem', slug); continue; }
  const storage = p.storages[1] || p.storages[0];
  let cover = null;
  const used = new Set();
  for (const [i, [color, hex]] of colors.entries()) {
    const c = p.colors.includes(color) && !used.has(color) ? color : p.colors.find((x) => !used.has(x)) || color;
    used.add(c);
    const img = await phonePhoto(`${slug}-${i}`, hex);
    cover ||= img;
    await env.db.query(`insert into public.product_variants (product_id, storage, color, condition, price, image_url) values ($1,$2,$3,'Lacrado',$4,$5)`,
      [p.id, storage, c, price + i * 100, img]);
    const v = await one(`select id from public.product_variants where product_id = $1 and storage = $2 and color = $3 and condition = 'Lacrado'`, [p.id, storage, c]);
    if (i === 0) await env.db.query(`update public.product_variants set stock = 3 where id = $1`, [v.id]);
    else await env.db.query(`update public.product_variants set on_order = true, order_price = $2, order_lead = '7 a 10 dias' where id = $1`, [v.id, price + i * 100 - 150]);
    if (slug === 'iphone-17-pro-max' && i === 1) firstColorChanged = { color: c, img };
  }
  if (semi) {
    await env.db.query(`insert into public.product_variants (product_id, storage, color, condition, price) values ($1,$2,$3,'Seminovo',$4)`, [p.id, p.storages[0], p.colors[0], Math.round(price * 0.72)]);
    const v = await one(`select id from public.product_variants where product_id = $1 and condition = 'Seminovo'`, [p.id]);
    await env.db.query(`update public.product_variants set stock = 1 where id = $1`, [v.id]);
  }
  await env.db.query(`update public.products set image_url = $2, gallery = array[$2]::text[], show_in_catalog = true, active = true, featured = $3 where id = $1`,
    [p.id, cover, slug === 'iphone-17-pro-max']);
}
await env.db.query(`update public.store_settings set catalog_enabled = true, store_name = 'i7even store', instagram = '@i7even_store',
  address = 'Maringá - PR', catalog_installments = 12, catalog_card_fee = 17.08 where id = 1`);
await b0.close();

for (const device of ['iPhone 13', 'Desktop']) {
  const tag = device.replace(/\W/g, '');
  console.log(`== ${device}`);
  const { browser, page, errors } = await open(env, { device, path: 'catalogo.html' });
  const touch = device !== 'Desktop';
  const tap = (l) => (touch ? l.first().tap() : l.first().click());
  await page.waitForSelector('.cat-card');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}vitrine-${tag}-1-topo.png` });
  ok(await page.locator('.cat-hero-sub, .cat-eyebrow').count() === 0, 'sem a frase embaixo da logo');
  ok(await page.locator('.cat-brand h1').innerText().then((t) => t.includes('i7even store')), 'cartão da marca com o nome');
  ok(!(await page.locator('.cat-foot').innerText()).includes('sujeitos'), 'rodapé sem o texto de preços sujeitos');
  ok(await page.locator('.cat-action').count() === 2, 'botões Instagram e Contato');
  ok(await page.locator('.cat-pill[data-cond="lacrado"]').count() === 1 && await page.locator('.cat-pill[data-cond="semi"]').count() === 1, 'filtros Todos · Lacrado · Semi');
  const first = await page.locator('.cat-card').first().innerText();
  ok(/A partir de/.test(first) && /12x de/.test(first) && /Ver opções/.test(first) && /Pronta entrega|Sob encomenda/.test(first), 'cartão: disponibilidade, "A partir de", "12x de" e "Ver opções"');
  ok(/cores/.test(first), `cartão com capacidade e cores (${first.split('\n').slice(0, 3).join(' | ')})`);
  const issues = await audit(page, 'vitrine', { mobile: touch });
  ok(!issues.length, `layout ok ${issues.join(' | ')}`);
  await page.mouse.wheel(0, 700);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOTS}vitrine-${tag}-2-grade.png` });
  ok(await page.locator('.cat-mini.is-on').count() === 1, 'barra compacta aparece ao rolar');
  // filtro Semi
  await tap(page.locator('.cat-pill[data-cond="semi"]'));
  await page.waitForTimeout(300);
  ok(await page.locator('.cat-card').count() === 2, `Semi: só os 2 modelos com seminovo (${await page.locator('.cat-card').count()})`);
  await tap(page.locator('.cat-pill[data-cond="todos"]'));
  // lista
  await tap(page.locator('[data-view="list"]'));
  await page.waitForTimeout(400);
  ok(await page.locator('.cat-grid.is-list').count() === 1, 'modo lista');
  await page.screenshot({ path: `${SHOTS}vitrine-${tag}-3-lista.png` });
  await tap(page.locator('[data-view="grid"]'));
  // ficha: trocar a cor troca a foto (cor de encomenda)
  await page.evaluate(() => window.scrollTo(0, 0));
  await tap(page.locator('.cat-card', { hasText: 'iPhone 17 Pro Max' }));
  await page.waitForSelector('.cat-sheet[open] .cat-price');
  await tap(page.locator(`.cat-sheet[open] [data-opt="color"][data-val="${firstColorChanged.color}"]`));
  await page.waitForTimeout(400);
  const src = await page.locator('.cat-sheet[open] .cat-slide img').first().getAttribute('src');
  ok(src === firstColorChanged.img, 'escolheu a cor (sob encomenda): a foto da cor aparece');
  ok((await page.locator('.cat-sheet[open]').innerText()).includes('12x de'), 'ficha mostra o parcelamento');
  await page.screenshot({ path: `${SHOTS}vitrine-${tag}-4-ficha.png` });
  ok(errors.length === 0, `sem erro de JS ${errors.join(' | ')}`);
  await browser.close();
}
console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK');
process.exit(fails ? 1 : 0);
