// Leitor da lista de encomenda colada do WhatsApp (assets/js/core/order-list.js),
// com o catálogo REAL da loja (assets/js/data/catalog.js, a base do seed) e
// mensagens no formato que os fornecedores mandam.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG } from '../../assets/js/data/catalog.js';
import { parseOrderList, matchPrice, salePrice, listCost, norm } from '../../assets/js/core/order-list.js';

const products = CATALOG.flatMap((c) => c.products.map((p) => ({
  id: p.id, name: p.name, storages: p.storages || [], colors: p.colors || [], sizes: p.sizes || [],
})));
const read = (text, opts) => parseOrderList(text, { products, ...opts });
const pick = (rows) => rows.map((r) => `${r.product.id}|${r.storage}|${r.color}|${r.condition}|${r.price}${r.currency === 'USD' ? 'USD' : ''}`);

test('títulos valem para as linhas de baixo', () => {
  const { rows, unknown } = read(`*LISTA ATUALIZADA HOJE* 🔥
📱 IPHONE 15 PRO MAX
256GB AZUL - R$ 6.200
256gb natural 6.150
512GB preto R$ 6.900,00

📱 iPhone 15
128 preto 3.950
128 rosa 3.990`);
  assert.deepEqual(pick(rows), [
    'iphone-15-pro-max|256GB|Titânio azul|Lacrado|6200',
    'iphone-15-pro-max|256GB|Titânio natural|Lacrado|6150',
    'iphone-15-pro-max|512GB|Titânio preto|Lacrado|6900',
    'iphone-15|128GB|Preto|Lacrado|3950',
    'iphone-15|128GB|Rosa|Lacrado|3990',
  ]);
  assert.equal(unknown.length, 0);
});

test('modelo na própria linha, abreviações e "k"', () => {
  const { rows } = read(`15pm 256 azul 6200
ip 16 pro 128 deserto 7.300
iPhone 13 128gb meia noite R$2.650
16e 128 branco 3,9k
17 pro max 2tb laranja 14.999`);
  assert.deepEqual(pick(rows), [
    'iphone-15-pro-max|256GB|Titânio azul|Lacrado|6200',
    'iphone-16-pro|128GB|Titânio deserto|Lacrado|7300',
    'iphone-13|128GB|Meia-noite|Lacrado|2650',
    'iphone-16e|128GB|Branco|Lacrado|3900',
    'iphone-17-pro-max|2TB|Laranja-cósmico|Lacrado|14999',
  ]);
});

test('várias cores na linha e seções de seminovo/lacrado', () => {
  const { rows } = read(`*SEMINOVOS*
iPhone 14 Pro 128gb roxo/preto 4.100 (bateria 89%)
iPhone 12 64gb azul 1.800
*LACRADOS*
iPhone 16 256 preto/branco 5.400`);
  assert.deepEqual(pick(rows), [
    'iphone-14-pro|128GB|Roxo-profundo|Seminovo|4100',
    'iphone-14-pro|128GB|Preto-espacial|Seminovo|4100',
    'iphone-12|64GB|Azul|Seminovo|1800',
    'iphone-16|256GB|Preto|Lacrado|5400',
    'iphone-16|256GB|Branco|Lacrado|5400',
  ]);
});

test('condição na própria linha vence a seção', () => {
  const { rows } = read(`SEMINOVOS
15 pro 256 natural 5.100
15 pro 256 natural LACRADO 6.300
13 128 azul swap 2.100`, { defaultCondition: 'Lacrado' });
  assert.deepEqual(rows.map((r) => r.condition), ['Seminovo', 'Lacrado', 'Seminovo']);
});

test('lista em dólar', () => {
  const { rows } = read(`IPHONE 15 PRO 128 natural $ 720
15 pro 256 preto 790 usd
15 pro 512 branco U$ 905,50`);
  assert.deepEqual(pick(rows), [
    'iphone-15-pro|128GB|Titânio natural|Lacrado|720USD',
    'iphone-15-pro|256GB|Titânio preto|Lacrado|790USD',
    'iphone-15-pro|512GB|Titânio branco|Lacrado|905.5USD',
  ]);
});

test('saudação, frete, Pix e telefone não viram oferta', () => {
  const { rows, unknown } = read(`Bom dia! Segue a tabela 👇
iPhone 15 128 azul 4.000
Frete grátis acima de 5 aparelhos
Chama no whats (44) 99999-0000
Pix 5% de desconto
Garantia de 1 ano`);
  assert.deepEqual(pick(rows), ['iphone-15|128GB|Azul|Lacrado|4000']);
  assert.equal(rows.length, 1);
  assert.ok(!unknown.some((u) => /99999/.test(u.line)), 'telefone não aparece nem como dúvida');
});

test('outra marca e iPhone fora do cadastro não herdam o modelo de cima', () => {
  const { rows, unknown } = read(`📱 iPhone 15
128 preto 3.950
Galaxy S24 256 5.000
iPhone XR 64 1.200
256 azul 4.300`);
  assert.deepEqual(pick(rows), ['iphone-15|128GB|Preto|Lacrado|3950', 'iphone-15|256GB|Azul|Lacrado|4300']);
  assert.equal(unknown.length, 2);
  assert.match(unknown[0].reason, /Outra marca/);
  assert.match(unknown[1].reason, /iPhone/);
});

test('preço antes da capacidade e capacidade com espaço', () => {
  const { rows } = read(`iPhone 15 R$ 4.200 - 128 GB preto
iPhone 15 Pro Max 1 TB azul 8.900`);
  assert.deepEqual(pick(rows), ['iphone-15|128GB|Preto|Lacrado|4200', 'iphone-15-pro-max|1TB|Titânio azul|Lacrado|8900']);
});

test('capacidade ou cor que faltam ficam marcadas para corrigir', () => {
  const { rows } = read(`iPhone 16 Pro 7.000
iPhone 16 Pro 256 verde-limao 7.200`);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].issues, ['capacidade', 'cor']);
  assert.deepEqual(rows[1].issues, ['cor']);
  assert.equal(rows[1].storage, '256GB');
});

test('AirPods, Watch e console (opções em texto e tamanho)', () => {
  const { rows } = read(`AirPods Pro 2 USB-C 1.350
Apple Watch Series 10 46mm GPS preto 2.600
PS5 slim digital 3.200
PlayStation 5 Slim com leitor 3.500`);
  const r = rows.map((x) => `${x.product.id}|${x.storage}|${x.size}|${x.price}`);
  assert.equal(r[0], 'airpods-pro-2|USB-C||1350');
  assert.equal(r[1].split('|')[0], 'watch-s10');
  assert.match(r[1], /\|GPS\|46mm\|2600$/);
  assert.equal(rows.length >= 3, true);
});

test('preço: formatos do WhatsApp', () => {
  const v = (s) => matchPrice(s)?.value;
  assert.equal(v('R$ 6.200,00'), 6200);
  assert.equal(v('6.200'), 6200);
  assert.equal(v('6200'), 6200);
  assert.equal(v('por 6,2k'), 6200);
  assert.equal(v('7k'), 7000);
  assert.equal(v('256gb azul'), undefined);
  assert.equal(v('bateria 89% - 3.100'), 3100);
  assert.equal(v('46mm 2.600'), 2600);
  assert.equal(matchPrice('$ 650').currency, 'USD');
  assert.equal(matchPrice('R$ 650').currency, 'BRL');
});

test('preço de venda: margem, câmbio e arredondamento', () => {
  assert.equal(salePrice(5000, { mode: 'pct', value: 12 }), 5600);
  assert.equal(salePrice(5000, { mode: 'add', value: 450, round: '90' }), 5490);
  assert.equal(salePrice(720, { currency: 'USD', rate: 5.5, mode: 'pct', value: 15, round: '10' }), 4560);
  assert.equal(salePrice(6200, { mode: 'venda' }), 6200);
  assert.equal(listCost(720, { currency: 'USD', rate: 5.5, mode: 'pct' }), 3960);
  assert.equal(listCost(6200, { mode: 'venda' }), 0);
});

test('norm tira acento, emoji e formatação do WhatsApp', () => {
  assert.equal(norm('*IPHONE* 15 📱 Titânio _azul_'), 'iphone 15 titanio azul');
});

test('todo iPhone do catálogo: 4 jeitos de escrever × capacidade × cor', () => {
  const iphones = products.filter((p) => /^iPhone/.test(p.name));
  const errs = [];
  let n = 0;
  for (const p of iphones) {
    const short = p.name.replace(/^iPhone\s*/, '');                       // "15 Pro Max"
    const abbr = short.replace(/\s*Pro Max$/i, 'pm').replace(/\s+/g, ''); // "15pm"
    const strip = (c) => c.replace(/^Titânio\s+/i, '').split('-')[0];     // "Titânio azul" → "azul", "Laranja-cósmico" → "Laranja"
    for (const s of p.storages) {
      for (const c of p.colors) {
        const price = 1000 + n;
        const lines = [
          `${p.name} ${s} ${c} - R$ ${price.toLocaleString('pt-BR')},00`,
          `${short.toUpperCase()} ${s.toLowerCase()} ${strip(c).toUpperCase()} ${price}`,
          `*${abbr}* ${s.replace('GB', '')} ${strip(c)} 💰 ${price.toLocaleString('pt-BR')}`,
          `📱 ${p.name}\n${s} ${c}: ${price}`,
        ];
        for (const line of lines) {
          n += 1;
          const { rows } = read(line);
          const ok = rows.length >= 1 && rows[0].product.id === p.id && rows[0].storage === s && rows[0].color === c && rows[0].price === price;
          if (!ok) errs.push(`${JSON.stringify(line)} → ${rows.map((r) => `${r.product.id}|${r.storage}|${r.color}|${r.price}`).join(' ; ') || 'nada'}`);
        }
      }
    }
  }
  assert.equal(errs.length, 0, `${errs.length} de ${n} linhas erradas:\n${errs.filter((e) => !/Air/i.test(e)).concat(errs.filter((e) => /Air/i.test(e)).slice(0, 2)).slice(0, 15).join('\n')}`);
});

test('número de iPad/Watch/Mac não vira iPhone', () => {
  const { rows } = read(`iPad Air 11 M2 128 azul 4.000
Apple Watch Series 11 46mm preto 3.100
AirPods 4 com cancelamento 1.200
iPhone 11 64 preto 1.500`);
  assert.ok(!rows.some((r) => r.product.id === 'iphone-11' && r.price !== 1500), 'nenhum produto de outra família virou iPhone 11');
  assert.ok(rows.some((r) => r.product.id === 'iphone-11' && r.price === 1500), 'o iPhone 11 de verdade foi lido');
  assert.ok(rows.some((r) => r.product.id.startsWith('airpods-4')), 'AirPods 4 reconhecido');
});

test('iPhone Air: "Air", "iPhone Air" e "17 Air"', () => {
  const { rows } = read(`AIR 256 preto 7100
iPhone Air 512 branco 8.200
17 air 256 azul 7.000`);
  assert.deepEqual(rows.map((r) => r.product.id), ['iphone-air', 'iphone-air', 'iphone-air']);
});

test('lista real da loja (blocos: modelo / 💰 preço / ▫️ cores)', async () => {
  const fs = await import('node:fs');
  const text = fs.readFileSync(new URL('./fixtures/lista-i7even.txt', import.meta.url), 'utf8');
  const { rows, missing, unknown } = read(text);
  const key = (r) => `${r.product.id}|${r.storage}|${r.color}|${r.condition}|${r.price}`;
  const all = rows.map(key);
  assert.equal(rows.length, 36, `36 ofertas (${rows.length})`);
  // cada cor do bloco vira uma oferta com o preço do bloco
  assert.ok(all.includes('iphone-14|128GB|(PRODUCT)RED|Seminovo|2297'), 'vermelho = (PRODUCT)RED');
  assert.ok(all.includes('iphone-14|128GB|Roxo|Seminovo|2297'), 'lilás = roxo');
  assert.ok(all.includes('iphone-13|128GB|Meia-noite|Seminovo|2147'), 'preto num iPhone 13 = meia-noite');
  assert.ok(all.includes('iphone-14-pro-max|128GB|Preto-espacial|Seminovo|3497'), 'preto num 14 Pro Max = preto-espacial');
  assert.ok(all.includes('iphone-16-pro|128GB|Titânio deserto|Seminovo|4397'));
  assert.ok(all.includes('iphone-17-pro-max|512GB|Prateado|Seminovo|7597'));
  // iPhone 17: o verde da lista é a cor "Vapor" do cadastro (não vira cor nova)
  const v17 = rows.find((r) => r.product.id === 'iphone-17');
  assert.ok(v17 && v17.color === 'Vapor' && !v17.newColor, `verde no iPhone 17 = Vapor (${v17?.color})`);
  // seção LACRADOS / SEMINOVOS vale para os blocos de baixo
  assert.ok(rows.filter((r) => r.product.id === 'iphone-18-pro-max').every((r) => r.condition === 'Lacrado'));
  // cor que o cadastro não tem entra como nova (não some, não vira "todas as cores")
  const burg = rows.find((r) => r.color === 'Burgundy');
  assert.ok(burg && burg.newColor && !burg.issues.length, 'Burgundy entra como cor nova');
  assert.ok(rows.every((r) => r.color), 'nenhuma oferta sem cor');
  // modelo fora do cadastro volta para "Criar modelo", sem herdar o de cima
  assert.equal(missing.length, 1);
  assert.equal(missing[0].name, 'iPhone 17e');
  assert.equal(missing[0].storage, '256GB');
  assert.deepEqual(missing[0].colors, ['Rosa']);
  assert.equal(missing[0].price, 3547);
  assert.equal(unknown.length, 0, unknown.map((u) => u.line).join(' | '));
});

test('iPhone 17: verde/sálvia = Vapor, azul = Névoa, lilás = Lavanda', () => {
  const { rows } = read(`iPhone 17 256GB verde 4.697
iPhone 17 256GB salvia 4.697
iPhone 17 256GB azul 4.697
iPhone 17 512GB lilás 5.197
iPhone 17 256GB vapor 4.697`);
  assert.deepEqual(rows.map((r) => r.color), ['Vapor', 'Vapor', 'Névoa', 'Lavanda', 'Vapor']);
  assert.ok(rows.every((r) => !r.newColor));
});

test('grudado, PS5 e quantidade', () => {
  const { rows, unknown } = read(`iPhone 12 128GB Branco (Swap) R$1.950
📍 PS5 SLIM DIGITAL 3.290
iphone16promax 512 natural 8.900
IPHONE 16E 128 BRANCO 3.700 (2 un)
AirPods Pro 2 USB-C 3x 1.290`);
  const k = rows.map((r) => `${r.product.id}|${r.qty ?? ''}`);
  assert.ok(k.includes('ps5-slim|'), `PS5 vira PlayStation 5 Slim (${k})`);
  assert.ok(k.includes('iphone-16-pro-max|'), '"iphone16promax" grudado');
  assert.ok(k.includes('iphone-16e|2'), 'quantidade "(2 un)"');
  assert.ok(k.includes('airpods-pro-2|3'), 'quantidade "3x"');
  assert.ok(!rows.some((r) => r.product.id === 'iphone-12' && r.price === 3290), 'PS5 não herda o iPhone de cima');
  assert.equal(unknown.length, 0);
});
