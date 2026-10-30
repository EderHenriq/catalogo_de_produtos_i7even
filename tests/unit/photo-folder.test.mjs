// Pasta de fotos → plano (assets/js/core/photo-folder.js), com nomes de
// pasta do jeito que a loja organiza (acentos, "2a ger", "Padrao"...).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG } from '../../assets/js/data/catalog.js';
import { planFolder, matchModel, matchColor, matchCategory, fileHash, photoHash, uniqueByHash, photoMetrics, photoScore, orderByScore } from '../../assets/js/core/photo-folder.js';

const categories = CATALOG.map((c) => ({ id: c.id, slug: c.id, name: c.label }));
const products = CATALOG.flatMap((c) => c.products.map((p) => ({ id: p.id, name: p.name, categoryId: c.id, colors: p.colors || [] })));
const byName = (n) => products.find((p) => p.name === n);

test('categoria pelo nome da pasta (com número na frente)', () => {
  assert.equal(matchCategory('01_iPhone', categories)?.id, 'iphone');
  assert.equal(matchCategory('08_Acessorios', categories)?.id, 'acessorio');
  assert.equal(matchCategory('06_Consoles', categories)?.id, 'console');
  assert.equal(matchCategory('Fotos aleatórias', categories), null);
});

test('modelo: nomes parecidos, números iguais', () => {
  const m = (f) => matchModel(f, products)?.id;
  assert.equal(m('iPhone 16 Pro Max'), 'iphone-16-pro-max');
  assert.equal(m('iPhone 16'), 'iphone-16');
  assert.equal(m('Apple Watch SE (2a ger)'), 'watch-se-2');
  assert.equal(m('MacBook Pro 14 M1 Pro-Max'), 'mbp-14-m1');
  assert.equal(m('PlayStation 5'), 'ps5-fat');
  assert.equal(m('PlayStation 5 Slim'), 'ps5-slim');
  assert.equal(m('Nintendo Switch'), undefined, 'Switch "normal" não vira OLED/Lite');
  assert.equal(m('PlayStation 4 Slim'), undefined);
  // geração "2a" = número; iPad de dois tamanhos; sigla da marca
  assert.equal(m('AirPods Pro (2a ger)'), 'airpods-pro-2');
  assert.equal(m('AirPods Pro (3a ger)'), 'airpods-pro-3');
  assert.equal(m('AirPods (3a ger)'), 'airpods-3', 'AirPods comum não vira o Pro');
  assert.equal(m('iPad (10a ger)'), 'ipad-10');
  assert.equal(m('iPad Pro 13 M4'), byName('iPad Pro M4 (11" / 13")').id);
  assert.equal(m('iPad Air 11 M2'), byName('iPad Air M2 (11" / 13")').id);
  assert.equal(m('YSL Y'), byName('Yves Saint Laurent Y').id);
});

test('pasta da categoria manda: "iPad Air 13 M2" não cai no MacBook Air 13" M2', () => {
  const plan = planFolder([
    { path: 'Imagens/04_iPad/iPad Air 13 M2/Cinza/a.webp' },
    { path: 'Imagens/03_MacBook/MacBook Air 13 M2/Prateado/a.webp' },
  ], { categories, products });
  assert.equal(plan.models.find((x) => x.folder === 'iPad Air 13 M2').product?.categoryId, 'ipad');
  assert.equal(plan.models.find((x) => x.folder === 'MacBook Air 13 M2').product?.categoryId, 'macbook');
});

test('cor: exata, por palavra, "Padrão" e cor nova', () => {
  assert.deepEqual(matchColor('Preto', byName('iPhone 11').colors), { color: 'Preto', isNew: false });
  assert.deepEqual(matchColor('Azul', byName('iPhone 15 Pro').colors), { color: 'Titânio azul', isNew: false });
  assert.deepEqual(matchColor('Padrao', byName('PlayStation 5 Pro').colors), { color: 'Branco', isNew: false });
  assert.deepEqual(matchColor('Pokemon', byName('Nintendo Switch OLED').colors), { color: 'Pokemon', isNew: true });
  assert.deepEqual(matchColor('Verde', byName('iPhone 17').colors), { color: 'Vapor', isNew: false }, 'iPhone 17: verde = Vapor');
  assert.deepEqual(matchColor('Azul', byName('iPhone 17').colors), { color: 'Névoa', isNew: false }, 'iPhone 17: azul = Névoa');
  assert.deepEqual(matchColor('Verde', byName('iPhone 13').colors), { color: 'Verde', isNew: false }, 'onde existe "Verde", fica Verde');
});

test('plano: categoria, capa do modelo, fotos por cor e o que fica de fora', () => {
  const files = [
    'Imagens/06_Consoles/categoria Consoles.jpg',
    'Imagens/01_iPhone/AQUI_VAI_A_IMAGEM_DA_CATEGORIA.txt',
    'Imagens/01_iPhone/iPhone 11/Preto/b.webp',
    'Imagens/01_iPhone/iPhone 11/Preto/a.webp',
    'Imagens/01_iPhone/iPhone 11/Verde/a.webp',
    'Imagens/06_Consoles/PlayStation 5 Slim/categoria.webp',
    'Imagens/06_Consoles/PlayStation 5 Slim/Padrao/x.webp',
    'Imagens/06_Consoles/Jogo midia fisica/PS4/Resident evil/x.webp',
    'Imagens/Outras/foto.webp',
  ].map((path) => ({ path }));
  const plan = planFolder(files, { categories, products });
  assert.ok(plan.categories.find((c) => c.category?.id === 'console').cover, 'foto da categoria Consoles');
  const ip = plan.models.find((m) => m.product?.id === 'iphone-11');
  assert.deepEqual(ip.colors.map((c) => [c.color, c.files.map((f) => f.path.split('/').pop())]), [['Preto', ['a.webp', 'b.webp']], ['Verde', ['a.webp']]]);
  const ps = plan.models.find((m) => m.product?.id === 'ps5-slim');
  assert.ok(ps.cover && ps.colors[0].color === 'Branco', 'capa do PS5 Slim e "Padrao" = Branco');
  assert.equal(plan.skipped.length, 2, plan.skipped.map((s) => s.reason).join(' | '));
});

test('foto repetida: mesmo conteúdo = mesmo código, com qualquer nome', async () => {
  const a = new Blob([new Uint8Array([1, 2, 3, 4])]);
  const copia = new Blob([new Uint8Array([1, 2, 3, 4])]);
  const b = new Blob([new Uint8Array([9, 9, 9])]);
  const [ha, hc, hb] = await Promise.all([fileHash(a), fileHash(copia), fileHash(b)]);
  assert.match(ha, /^[0-9a-f]{20}$/);
  assert.equal(ha, hc);
  assert.notEqual(ha, hb);
  const files = [{ path: 'a.png', h: ha }, { path: 'a (1).png', h: hc }, { path: 'b.png', h: hb }, { path: 'x.png', h: '' }];
  assert.deepEqual(uniqueByHash(files, (f) => f.h).map((f) => f.path), ['a.png', 'b.png', 'x.png']);
});

test('código da foto pelo endereço (só fotos enviadas pela importação)', () => {
  const h = '0123456789abcdef0123';
  assert.equal(photoHash(`https://x.supabase.co/storage/v1/object/public/produtos/p/h2-${h}.webp`), h);
  assert.equal(photoHash(`https://x.supabase.co/storage/v1/object/public/produtos/p/h2-${h}.jpg?v=2`), h);
  assert.equal(photoHash('https://x.supabase.co/storage/v1/object/public/produtos/p/lx2a9-k3j4h.webp'), '');
  assert.equal(photoHash(''), '');
});

/** Foto sintética 60×80 (RGBA): fundo branco e retângulos de cor. */
function img(w, h, rects) {
  const d = new Uint8ClampedArray(w * h * 4).fill(255);
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * 4; d[i] = 30; d[i + 1] = 60; d[i + 2] = 140; }
  }
  return d;
}

test('vitrine: frente + verso primeiro, close cortado e foto de lado por último', () => {
  const W = 60; const H = 80;
  // par de aparelhos com canto arredondado (como na foto: o lado não enche a borda)
  const phone = (x0, y0, x1, y1, r = 5) => [[x0 + r, y0, x1 - r, y1], [x0, y0 + r, x1, y1 - r]];
  const pair = img(W, H, [...phone(8, 10, 28, 70), ...phone(31, 10, 51, 70)]);
  // close: o produto termina numa linha reta embaixo e à direita (cortado)
  const close = img(W, H, [[10, 20, 52, 74], [14, 12, 52, 20]]);
  // de lado: fininho
  const side = img(W, H, [[27, 8, 33, 72]]);
  const mp = photoMetrics(pair, W, H);
  const mc = photoMetrics(close, W, H);
  assert.equal(mp.touch, 0);
  assert.ok(mp.aspect > 0.6 && mp.aspect < 0.92, `par com proporção de dois aparelhos (${mp.aspect})`);
  assert.ok(mc.cut >= 2, `close tem lados retos (${mc.sides})`);
  const files = [{ path: 'a/close.webp', m: mc }, { path: 'a/lado.webp', m: photoMetrics(side, W, H) }, { path: 'a/par.webp', m: mp }];
  const order = orderByScore(files, (f) => photoScore(f.m, { pair: true })).map((f) => f.path.split('/').pop());
  assert.equal(order[0], 'par.webp');
  // marcada à mão ("00_...") vence a nota
  files.push({ path: 'a/00_escolhida.webp', m: mc });
  assert.equal(orderByScore(files, (f) => photoScore(f.m, { pair: true }))[0].path, 'a/00_escolhida.webp');
});

test('vitrine: foto de ambiente (fundo colorido) vai para o fim', () => {
  const W = 40; const H = 40;
  const d = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < d.length; i += 4) { d[i] = 120; d[i + 1] = 90; d[i + 2] = 60; d[i + 3] = 255; }
  const m = photoMetrics(d, W, H);
  assert.ok(m.bg < 0.5 && photoScore(m) < 60, JSON.stringify(m));
});
