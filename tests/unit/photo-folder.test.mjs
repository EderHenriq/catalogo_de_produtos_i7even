// Pasta de fotos → plano (assets/js/core/photo-folder.js), com nomes de
// pasta do jeito que a loja organiza (acentos, "2a ger", "Padrao"...).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG } from '../../assets/js/data/catalog.js';
import { planFolder, matchModel, matchColor, matchCategory } from '../../assets/js/core/photo-folder.js';

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
});

test('cor: exata, por palavra, "Padrão" e cor nova', () => {
  assert.deepEqual(matchColor('Preto', byName('iPhone 11').colors), { color: 'Preto', isNew: false });
  assert.deepEqual(matchColor('Azul', byName('iPhone 15 Pro').colors), { color: 'Titânio azul', isNew: false });
  assert.deepEqual(matchColor('Padrao', byName('PlayStation 5 Pro').colors), { color: 'Branco', isNew: false });
  assert.deepEqual(matchColor('Pokemon', byName('Nintendo Switch OLED').colors), { color: 'Pokemon', isNew: true });
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
