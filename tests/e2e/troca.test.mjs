// Aparelho na troca (o cliente dá o aparelho dele como parte do pagamento),
// no iPhone: pela ficha do pedido (grava na hora) e no pedido novo (entra
// junto ao salvar). O aparelho entra no estoque com o valor da troca de
// custo; excluir o pagamento tira o aparelho do estoque de novo.
import { createDb, open, SHOTS } from './harness.mjs';

let fails = 0;
const ok = (c, m) => { console.log(`${c ? '  ✓' : '  ✗'} ${m}`); if (!c) fails++; };
const env = await createDb();
const q = async (sql, p) => (await env.db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];

const user = (await one(`select id from auth.users limit 1`)).id;
const capa = await one(`select id, name from public.products where slug = 'capa'`);
const vCapa = await one(`insert into public.product_variants (product_id, color, condition, price, cost, stock) values ($1, 'Preta', 'Lacrado', 3000, 1000, 5) returning id`, [capa.id]);
const o = await one(`insert into public.orders (user_id, customer_name, status, legacy_migrated) values ($1, 'Cliente Troca', 'novo', true) returning id, code`, [user]);
await env.db.query(`insert into public.order_items (order_id, position, variant_id, product_id, product_name, qty, unit_price) values ($1, 1, $2, $3, $4, 1, 3000)`, [o.id, vCapa.id, capa.id, capa.name]);
await env.db.query(`update public.orders set updated_at = now() where id = $1`, [o.id]);

const { browser, page, errors } = await open(env, { device: 'iPhone 13' });
const top = () => page.locator('dialog.modal[open]').last();
const waitDb = async (sql, test, ms = 8000) => {
  const t0 = Date.now();
  for (;;) { const r = await q(sql); if (test(r)) return r; if (Date.now() - t0 > ms) return r; await page.waitForTimeout(150); }
};
async function fillTrade({ model, storage, color, bat, serial, value }) {
  await top().locator('#pay-method').selectOption('Aparelho na troca');
  await top().locator('#tr-model').fill(model);
  await top().locator('#tr-model').dispatchEvent('change');
  await top().locator('#tr-storage').fill(storage);
  await top().locator('#tr-color').fill(color);
  await top().locator('#tr-bat').fill(String(bat));
  await top().locator('#tr-serial').fill(serial);
  await top().locator('#pay-amount').fill(value);
}
await page.waitForSelector('.app');

console.log('1. ficha do pedido: aparelho na troca');
await page.evaluate(() => { location.hash = '#/pedidos'; });
await page.waitForSelector('.order-card');
await page.locator('.order-card', { hasText: 'Cliente Troca' }).first().locator('.cell-primary, .grow').first().tap();
await page.waitForSelector('dialog.modal[open] [data-add-pay]');
await top().locator('[data-add-pay]').tap();
await page.waitForSelector('#pay-method');
await fillTrade({ model: 'iPhone 13', storage: '128GB', color: 'Azul', bat: 84, serial: '359000000000777', value: '1.800,00' });
ok(await top().locator('[data-trade]').isVisible(), 'escolheu "Aparelho na troca": aparecem os campos do aparelho');
await page.screenshot({ path: `${SHOTS}troca-1-dialogo.png` });
await top().locator('.modal-foot [data-ok]').tap();
let r = await waitDb(`select p.amount, p.method, p.trade_unit_id, u.status, u.cost, u.battery_health, u.origin
  from public.payments p left join public.units u on u.id = p.trade_unit_id where p.order_id = '${o.id}'`, (x) => x.length === 1);
ok(r.length === 1 && r[0].method === 'Aparelho na troca' && Number(r[0].amount) === 1800, 'pagamento de 1.800 como "Aparelho na troca"');
ok(r[0].status === 'estoque' && Number(r[0].cost) === 1800 && r[0].battery_health === 84 && r[0].origin === 'Troca (cliente)',
  'o iPhone 13 entrou no estoque (custo 1.800, bateria 84%)');
r = await one(`select paid_amount, balance from public.orders where id = $1`, [o.id]);
ok(Number(r.paid_amount) === 1800 && Number(r.balance) === 1200, `falta receber 1.200 (${r.balance})`);
await page.waitForTimeout(500);
const row = await top().locator('.pay-row', { hasText: 'Aparelho na troca' }).innerText();
ok(/iPhone 13/.test(row) && /128GB/.test(row) && /no estoque/.test(row), 'a lista mostra o aparelho da troca');
await page.screenshot({ path: `${SHOTS}troca-2-lista.png` });

console.log('2. excluir o pagamento da troca desfaz a entrada no estoque');
await top().locator('.pay-row', { hasText: 'Aparelho na troca' }).locator('[data-del-pay]').tap();
await page.waitForSelector('dialog.modal[open] .modal-foot [data-confirm]');
await top().locator('.modal-foot [data-confirm]').tap();
r = await waitDb(`select count(*)::int n from public.units where serial = '359000000000777'`, (x) => x[0].n === 0);
ok(r[0].n === 0, 'aparelho saiu do estoque');
r = await one(`select paid_amount from public.orders where id = $1`, [o.id]);
ok(Number(r.paid_amount) === 0, 'o valor saiu do pedido');
await top().locator('.modal-head [data-close]').tap();
await page.waitForTimeout(400);

console.log('3. pedido novo (Vender do Estoque) com aparelho na troca');
await page.evaluate(() => { location.hash = '#/estoque'; });
await page.waitForSelector('[data-item]');
await page.locator('[data-item]').first().tap();
await page.waitForSelector('dialog.modal[open] .modal-foot [data-sell]');
await top().locator('.modal-foot [data-sell]').tap();
await page.waitForSelector('dialog.modal[open] #f-name');
await top().locator('#f-name').fill('Comprador Com Troca');
await top().locator('[data-add-pay]').scrollIntoViewIfNeeded();
await top().locator('[data-add-pay]').tap();
await page.waitForSelector('#pay-method');
await fillTrade({ model: 'iPhone 12', storage: '64GB', color: 'Preto', bat: 79, serial: '359000000000888', value: '1.000,00' });
await top().locator('.modal-foot [data-ok]').tap();
await page.waitForTimeout(300);
ok((await top().locator('.pay-row', { hasText: 'Aparelho na troca' }).count()) === 1, 'a troca aparece no pedido antes de salvar');
await top().locator('.modal-foot [data-save]').tap();
r = await waitDb(`select o.code, p.method, p.amount, u.status, u.cost from public.orders o join public.payments p on p.order_id = o.id
  left join public.units u on u.id = p.trade_unit_id where o.customer_name = 'Comprador Com Troca'`, (x) => x.length === 1 && x[0].status);
ok(r.length === 1 && r[0].method === 'Aparelho na troca' && Number(r[0].amount) === 1000 && r[0].status === 'estoque' && Number(r[0].cost) === 1000,
  'pedido criado: troca de 1.000 lançada e o iPhone 12 no estoque');

ok(errors.length === 0, `sem erro de JS ${errors.join(' | ')}`);
await browser.close();
console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK');
process.exit(fails ? 1 : 0);
