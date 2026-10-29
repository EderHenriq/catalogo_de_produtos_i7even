// Fiado de ponta a ponta, contra o schema.sql real:
// pedido com entrada + 3 parcelas → "Finalizado" sem quitar vira entrega no
// fiado (Aguardando pagamento) → A receber mostra atrasada/hoje → cobrar no
// WhatsApp marca "cobrado hoje" → receber parcela por parcela → quitou,
// o pedido finaliza sozinho. Também: "Pago" sem quitar não passa.
import { createDb, open, SHOTS, audit } from './harness.mjs';

const DEVICE = process.argv[2] || 'iPhone 13';
const tag = DEVICE.replace(/\W/g, '');
let fails = 0;
const ok = (c, m) => { console.log(`${c ? '  ✓' : '  ✗'} ${m}`); if (!c) fails++; };
const env = await createDb();
const q = async (sql, p) => (await env.db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];
const touch = DEVICE !== 'Desktop';

const CAPA = await one(`select id from public.products where slug = 'capa'`);
await env.db.query(`insert into public.product_variants (product_id, storage, color, condition, price, cost, stock)
                    values ($1, 'Couro', 'Diversas', 'Lacrado', 1000, 500, 10)`, [CAPA.id]);

const { browser, page, errors } = await open(env, { device: DEVICE });
const tap = (loc) => (touch ? loc.first().tap() : loc.first().click());
const top = () => page.locator('dialog.modal[open]').last();
const shot = (n) => page.screenshot({ path: `${SHOTS}fiado-${tag}-${n}.png` });
const auditNow = async (label) => { const i = await audit(page, label, { mobile: touch }); if (i.length) console.log('    ⚠', i.join('\n    ⚠ ')); };
const waitDb = async (sql, test, ms = 6000) => {
  const t0 = Date.now();
  for (;;) { const r = await q(sql); if (test(r)) return r; if (Date.now() - t0 > ms) return r; await page.waitForTimeout(150); }
};
const closeAll = async () => { while (await page.locator('dialog.modal[open]').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); } };
await page.waitForSelector('.app');

console.log('1. pedido com entrada e 3 parcelas');
await tap(page.locator(touch ? '.fab' : '.sidebar [data-new]'));
await page.waitForSelector('[data-save]');
await page.locator('#f-name').fill('Bia Fiado');
await page.locator('#f-phone').fill('44933332222');
await tap(top().locator('[data-pick]'));
await page.waitForSelector('.picker');
await top().locator('[data-search]').fill('capa');
await page.waitForTimeout(300);
await tap(top().locator('.pick-product', { has: page.locator('.pick-name', { hasText: /Capa/ }) }));
await page.waitForSelector('.item-editor');
await tap(top().locator('[data-set="variant"][data-value="Couro"]'));
await tap(top().locator('.modal-foot [data-ok]'));
await page.waitForTimeout(250);
await tap(top().locator('[data-done]'));
await page.waitForTimeout(250);
// entrada de 400 já recebida
await tap(top().locator('[data-add-pay]'));
await page.waitForSelector('#pay-amount');
await top().locator('#pay-amount').fill('');
await top().locator('#pay-amount').pressSequentially('40000');
await tap(top().locator('.modal-foot [data-ok]'));
await page.waitForTimeout(200);
// monta as parcelas: entrada 400 (já preenchida com o recebido) + 3x 200
await tap(top().locator('[data-plan-box] > summary'));
await page.waitForTimeout(150);
ok((await top().locator('#pl-down').inputValue()) === '400,00', 'entrada já vem com o que foi recebido');
await top().locator('#pl-count').selectOption('3');
await top().locator('#pl-first').fill('2026-09-28');
await top().locator('#pl-first').dispatchEvent('change');
ok((await top().locator('[data-pl-preview]').innerText()).includes('3x de R$'), 'prévia: "3x de R$ 200,00"');
await tap(top().locator('[data-pl-build]'));
await page.waitForTimeout(200);
ok(await top().locator('.plan-row').count() === 4, 'entrada + 3 parcelas na tela');
await shot('01-parcelas');
await auditNow('parcelas-no-pedido');
// status "Finalizado" sem quitar: avisa e entrega no fiado
await top().locator('#f-status').selectOption('entregue');
await page.waitForTimeout(100);
ok(await top().locator('[data-status-hint]').isVisible(), 'aviso: "fica Aguardando pagamento até quitar"');
await tap(top().locator('[data-save]'));
await page.waitForSelector('dialog.modal[open] [data-confirm]');
ok((await top().innerText()).includes('fiado'), 'confirmação "Entregar no fiado?"');
await tap(top().locator('[data-confirm]'));
let r = await waitDb(`select id, status, handed_over_at, balance, installments from public.orders where customer_name = 'Bia Fiado'`, (x) => x.length === 1);
const O = r[0];
ok(O?.status === 'aguardando' && O.handed_over_at && Number(O.balance) === 600, `gravado: Aguardando pagamento, cliente levou, falta 600 (${O?.status})`);
r = await q(`select number, due_date::text d, amount::float a from public.order_installments where order_id = $1 order by number`, [O.id]);
ok(r.length === 4 && r[0].a === 400 && r[1].d === '2026-09-28' && r[3].d === '2026-11-28' && r.reduce((a, x) => a + x.a, 0) === 1000,
  `parcelas gravadas: ${r.map((x) => `${x.d}=${x.a}`).join(', ')}`);

console.log('2. A receber');
await page.evaluate(() => { location.hash = '#/receber'; });
await page.waitForSelector('.recv-kpis');
await page.waitForTimeout(300);
const kpis = await page.locator('.recv-kpis').innerText();
ok(/600,00/.test(kpis), 'total a receber R$ 600');
ok(await page.locator('[data-tab="atrasadas"][aria-pressed="true"]').count() === 1, `abre direto nas atrasadas (${await page.locator('[data-tab][aria-pressed="true"]').innerText()})`);
ok(await page.locator('.inst-row').count() >= 1, `lista as parcelas atrasadas (${await page.locator('.inst-row').count()})`);
ok(await page.locator('.nav-item[data-route="receber"] [data-due-count]:not([hidden])').count() === 1, 'menu com o contador de cobranças');
await shot('02-receber');
await auditNow('a-receber');

console.log('3. cobrar no WhatsApp');
await tap(page.locator('.inst-row [data-remind]'));
await page.waitForSelector('.wa-bubble');
const msg = await top().locator('.wa-bubble').innerText();
ok(/Bia/.test(msg) && /R\$\s?200,00/.test(msg) && /venceu/.test(msg), 'mensagem com nome, valor e "venceu em"');
await shot('03-cobranca');
await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
await tap(top().locator('[data-copy]'));
r = await waitDb(`select count(*)::int n from public.order_installments where order_id = '${O.id}' and reminded_at is not null`, (x) => x[0].n >= 1);
ok(r[0].n >= 1, 'parcela marcada "cobrado hoje"');
await closeAll();
await page.waitForTimeout(400);
ok((await page.locator('.inst-row').first().innerText()).includes('cobrado hoje'), 'lista mostra "cobrado hoje"');

console.log('4. receber parcela por parcela até quitar');
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => { location.hash = '#/receber'; });
  await page.waitForTimeout(250);
  await tap(page.locator('[data-tab="tudo"]'));
  await page.waitForTimeout(150);
  await tap(page.locator('.inst-row [data-receive]'));
  await page.waitForSelector('#pay-amount');
  ok((await top().locator('#pay-amount').inputValue()) === '200,00', `parcela ${i + 1}: valor já preenchido (200,00)`);
  await tap(top().locator('.modal-foot [data-ok]'));
  await page.waitForTimeout(500);
}
r = await waitDb(`select status, balance, delivered_at from public.orders where id = '${O.id}'`, (x) => x[0].status === 'entregue');
ok(r[0].status === 'entregue' && Number(r[0].balance) === 0 && r[0].delivered_at, 'quitou: pedido FINALIZADO sozinho');
await page.waitForTimeout(300);
ok(await page.locator('.inst-row').count() === 0, 'A receber ficou vazio');
await shot('04-quitado');

console.log('5. "Pago" sem quitar não passa');
await env.db.query(`insert into public.orders (customer_name, status, legacy_migrated) values ('Sem Pagar', 'novo', true)`);
const o2 = await one(`select id from public.orders where customer_name = 'Sem Pagar'`);
const v = await one(`select id from public.product_variants where product_id = $1 and storage = 'Couro'`, [CAPA.id]);
await env.db.query(`insert into public.order_items (order_id, position, variant_id, product_id, product_name, qty, unit_price) values ($1, 1, $2, $3, 'Capa', 1, 1000)`, [o2.id, v.id, CAPA.id]);
await env.db.query(`update public.orders set updated_at = now() where id = $1`, [o2.id]);
await page.evaluate(async () => { const m = await import('/assets/js/core/data.js'); await m.reload('orders'); });
await page.evaluate(() => { location.hash = '#/pedidos'; });
await page.waitForTimeout(400);
await tap(page.locator(touch ? '.order-card' : 'tr[data-id]', { hasText: 'Sem Pagar' }));
await page.waitForSelector('.steps');
await tap(top().locator('.step[data-status="pago"]'));
await page.waitForSelector('.choice-list');
ok(/Falta receber R\$\s1\.000,00/.test(await top().innerText()), 'pedir "Pago" mostra quanto falta');
ok(await top().locator('[data-c="fiado"]').count() === 0, '"Pago" não oferece fiado (só receber / aguardar)');
await shot('05-falta-receber');
await tap(top().locator('[data-c="aguardando"]'));
r = await waitDb(`select status from public.orders where id = '${o2.id}'`, (x) => x[0].status === 'aguardando');
ok(r[0].status === 'aguardando', 'ficou "Aguardando pagamento"');
await closeAll();

ok(errors.length === 0, `sem erro de JS ${errors.join(' | ')}`);
await browser.close();
console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK');
process.exit(fails ? 1 : 0);
