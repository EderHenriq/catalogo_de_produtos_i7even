// Responsividade do sistema no celular: todas as telas e as principais janelas
// do iPhone SE (320 px) ao 15 Pro Max (430 px). Em cada uma: nada passa da
// largura da tela (nem empurra a página de lado), campos com fonte >= 16 px.
import { createDb, open, SHOTS, audit } from './harness.mjs';
const env = await createDb();
const q = async (sql, p) => (await env.db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];

const pid = async (slug) => (await one(`select id from public.products where slug = $1`, [slug])).id;
const P15 = await pid('iphone-15-pro-max');
const P13 = await pid('iphone-13');
const CAPA = await pid('capa');
const v15 = await one(`insert into public.product_variants (product_id, storage, color, condition, price, cost, stock) values ($1, '256GB', 'Titânio natural', 'Lacrado', 7499, 6200, 0) returning id`, [P15]);
const v13 = await one(`insert into public.product_variants (product_id, storage, color, condition, price, cost, stock) values ($1, '128GB', 'Meia-noite', 'Seminovo', 2899, 2200, 0) returning id`, [P13]);
const vCapa = await one(`insert into public.product_variants (product_id, storage, color, condition, price, cost, stock) values ($1, 'Couro', 'Diversas', 'Lacrado', 89.9, 30, 10) returning id`, [CAPA]);
const u1 = await one(`insert into public.units (variant_id, serial, cost, battery_health) values ($1, '356789012345671', 6200, 100) returning id`, [v15.id]);
await q(`insert into public.units (variant_id, serial, cost, battery_health) values ($1, '356789012345672', 6200, 100)`, [v15.id]);
const u3 = await one(`insert into public.units (variant_id, serial, cost, battery_health) values ($1, '356789012345673', 2200, 88) returning id`, [v13.id]);
await q(`insert into public.units (variant_id, serial, cost, battery_health) values ($1, null, 2200, 91)`, [v13.id]);
await q(`update public.product_variants set stock = (select count(*) from public.units u where u.variant_id = product_variants.id and u.status = 'estoque') where id in ($1, $2)`, [v15.id, v13.id]);

const c1 = await one(`insert into public.customers (name, phone, city, uf) values ('Ana Souza', '44999887766', 'Maringá', 'PR') returning id`);
const c2 = await one(`insert into public.customers (name, phone) values ('Carlos Lima', '44988776655') returning id`);
await q(`insert into public.customers (name, phone, instagram) values ('Bia Fiado', '44933332222', '@bia')`);

async function order({ name, status, date, items, pays = [], ship = 0, inst = [], customer = null }) {
  const o = await one(`insert into public.orders (user_id, customer_name, customer_phone, status, order_date, shipping_cost, legacy_migrated, customer_id)
    values ($6, $1, '44999887766', $2, $3, $4, true, $5) returning id`, [name, status, date, ship, customer, env.eder]);
  let pos = 1;
  for (const it of items) {
    await q(`insert into public.order_items (order_id, position, variant_id, product_id, product_name, storage, color, condition, qty, unit_price, unit_cost, unit_ids)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, [o.id, pos++, it.v, it.p, it.name, it.storage, it.color, it.cond, it.qty || 1, it.price, it.cost, it.units || []]);
  }
  for (const p of pays) await q(`insert into public.payments (order_id, paid_at, amount, method) values ($1, $2, $3, $4)`, [o.id, p.date || date, p.amount, p.method]);
  for (const [i, x] of inst.entries()) await q(`insert into public.order_installments (order_id, number, due_date, amount) values ($1, $2, $3, $4)`, [o.id, i, x.due, x.amount]);
  await q(`update public.orders set updated_at = now() where id = $1`, [o.id]);
  return o;
}
const today = new Date();
const d = (n) => { const x = new Date(today); x.setDate(x.getDate() + n); return x.toLocaleDateString('sv-SE'); };
await order({ name: 'Ana Souza', customer: c1.id, status: 'novo', date: d(0), items: [{ v: v13.id, p: P13, name: 'iPhone 13', storage: '128GB', color: 'Meia-noite', cond: 'Seminovo', price: 2899, cost: 2200 }], pays: [{ amount: 1000, method: 'PIX' }] });
await order({ name: 'Carlos Lima', customer: c2.id, status: 'entregue', date: d(-10), items: [{ v: vCapa.id, p: CAPA, name: 'Capa', storage: 'Couro', color: 'Diversas', cond: 'Lacrado', qty: 2, price: 89.9, cost: 30 }], pays: [{ amount: 179.8, method: 'Dinheiro' }] });
await order({ name: 'Bia Fiado', status: 'aguardando', date: d(-40), items: [{ v: v15.id, p: P15, name: 'iPhone 15 Pro Max', storage: '256GB', color: 'Titânio natural', cond: 'Lacrado', price: 7499, cost: 6200 }], pays: [{ amount: 2499, method: 'PIX' }], inst: [{ due: d(-40), amount: 2499 }, { due: d(-10), amount: 2500 }, { due: d(20), amount: 2500 }] });
await order({ name: 'Diego Ramos', status: 'enviado', date: d(-3), ship: 45, items: [{ v: vCapa.id, p: CAPA, name: 'Capa', storage: 'Couro', color: 'Diversas', cond: 'Lacrado', qty: 1, price: 89.9, cost: 30 }], pays: [{ amount: 134.9, method: 'Cartão de crédito' }] });
await order({ name: 'Orçamento Teste', status: 'orcamento', date: d(-1), items: [{ v: v15.id, p: P15, name: 'iPhone 15 Pro Max', storage: '256GB', color: 'Titânio natural', cond: 'Lacrado', price: 7499, cost: 6200 }] });
void u1; void u3;


const ROUTES = ['dashboard', 'pedidos', 'receber', 'clientes', 'estoque', 'produtos', 'entradas', 'catalogo', 'vitrine', 'categorias', 'relatorios', 'ajustes'];
const DEVICES = (process.argv[2] || 'iPhone SE,Galaxy S8,iPhone 13 Mini,iPhone 13,iPhone 15 Pro Max').split(',');
const SHOOT = process.argv.includes('--shots');

/** Elementos que passam da largura da tela (fora de faixas que rolam ou cortam de propósito). */
const overflow = (page) => page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const out = [];
  const topDlg = [...document.querySelectorAll('dialog[open]')].pop();
  const scope = topDlg || document.body;
  const clipped = (el) => { for (let a = el.parentElement; a && a !== document.body && a !== scope.parentElement; a = a.parentElement) { if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(a).overflowX)) return true; } return false; };
  for (const el of scope.querySelectorAll('*')) {
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) continue;
    if (el.closest('[inert], [aria-hidden="true"]')) continue;
    if (el.closest('.sidebar') && !document.querySelector('.sidebar.open, .sidebar.is-open, .app.menu-open, body.menu-open')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (s.position !== 'fixed' && clipped(el)) continue;
    if (r.right > vw + 1 || r.left < -1) out.push(`${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : ''}${el.id ? '#' + el.id : ''} [${Math.round(r.left)}…${Math.round(r.right)} de ${vw}]`);
  }
  const de = document.documentElement;
  const dlgScroll = topDlg ? [...topDlg.querySelectorAll('.modal-body, .modal-panel')].filter((x) => x.scrollWidth > x.clientWidth + 1).map((x) => x.className.split(' ')[0]) : [];
  return { scroll: de.scrollWidth - vw, dlgScroll, items: [...new Set(out)].slice(0, 6) };
});

let problems = 0;
for (const device of DEVICES) {
  const tag = device.replace(/\W/g, '');
  console.log(`== ${device}`);
  const { browser, page, errors } = await open(env, { device });
  await page.waitForSelector('.app', { timeout: 15000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  const closeAll = async () => { while (await page.locator('dialog.modal[open]').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(150); } };
  const check = async (label) => {
    await page.waitForTimeout(350);
    await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
    const o = await overflow(page);
    const a = (await audit(page, label, { mobile: true })).filter((x) => !/toque pequeno/.test(x));
    const bad = o.scroll > 1 || o.items.length || o.dlgScroll.length || a.length;
    if (bad) { problems++; console.log(`  ✗ ${label}: rolagem=${o.scroll} ${o.dlgScroll.length ? 'modal rola de lado: ' + o.dlgScroll.join(',') : ''} ${o.items.join(' | ')} ${a.join(' | ')}`); }
    if (SHOOT || bad) await page.screenshot({ path: `${SHOTS}rs-${tag}-${label}.png` });
  };
  const go = async (r) => { await closeAll(); await page.evaluate((id) => { location.hash = `#/${id}`; }, r); await page.waitForTimeout(500); };
  const step = async (label, fn) => { try { await fn(); await check(label); } catch (e) { problems++; console.log(`  ✗ ${label}: não abriu - ${e.message.split('\n')[0]}`); } await closeAll(); };

  for (const r of ROUTES) { await go(r); await check(r); }
  await step('menu-mais', async () => { await page.locator('.tabbar button, .tabbar a').filter({ hasText: 'Mais' }).first().tap(); await page.waitForTimeout(500); });
  await page.reload(); await page.waitForSelector('.app', { timeout: 15000 }); await page.waitForTimeout(500);
  await step('filtros', async () => { await go('pedidos'); await page.locator('button:has-text("Filtros")').first().tap(); await page.waitForSelector('dialog.modal[open]'); });
  await step('pedido-detalhe', async () => { await go('pedidos'); await page.locator('.order-card', { hasText: 'Bia Fiado' }).first().tap(); await page.waitForSelector('.steps'); await page.locator('dialog.modal[open] .modal-body').evaluate((el) => { el.scrollTop = el.scrollHeight; }); });
  await step('pedido-novo', async () => { await go('pedidos'); await page.locator('.fab').tap(); await page.waitForSelector('[data-save]'); await page.locator('dialog.modal[open] .modal-body').evaluate((el) => { el.scrollTop = el.scrollHeight; }); });
  await step('pedido-editar', async () => { await go('pedidos'); await page.locator('.order-card', { hasText: 'Ana Souza' }).first().tap(); await page.waitForSelector('.steps'); await page.locator('dialog.modal[open] [data-edit]').tap(); await page.waitForSelector('[data-save]'); await page.locator('dialog.modal[open] .modal-body').evaluate((el) => { el.scrollTop = el.scrollHeight * 0.5; }); });
  await step('seletor', async () => { await go('pedidos'); await page.locator('.fab').tap(); await page.waitForSelector('[data-save]'); await page.locator('dialog.modal[open] [data-pick]').tap(); await page.waitForSelector('.picker'); });
  await step('item-editor', async () => {
    await go('pedidos'); await page.locator('.fab').tap(); await page.waitForSelector('[data-save]');
    await page.locator('dialog.modal[open] [data-pick]').tap(); await page.waitForSelector('.picker');
    await page.locator('dialog.modal[open] .pick-product').first().tap(); await page.waitForSelector('.item-editor');
  });
  await step('pagamento', async () => { await go('pedidos'); await page.locator('.order-card', { hasText: 'Bia Fiado' }).locator('[data-advance]').tap(); await page.waitForSelector('#pay-amount'); });
  await step('troca', async () => { await go('pedidos'); await page.locator('.order-card', { hasText: 'Bia Fiado' }).locator('[data-advance]').tap(); await page.waitForSelector('#pay-method'); await page.locator('#pay-method').selectOption('Aparelho na troca'); });
  await step('cliente', async () => { await go('clientes'); await page.locator('[data-open]', { hasText: 'Ana Souza' }).first().tap(); await page.waitForTimeout(400); });
  await step('cliente-form', async () => { await go('clientes'); await page.locator('.view button:visible', { hasText: 'Cliente' }).first().tap(); await page.waitForSelector('#cf-name'); });
  await step('estoque-item', async () => { await go('estoque'); await page.locator('[data-item]').first().tap(); await page.waitForTimeout(400); });
  await step('estoque-add', async () => { await go('estoque'); await page.locator('button:has-text("Adicionar")').first().tap(); await page.waitForTimeout(500); });
  await step('produto', async () => { await go('produtos'); await page.locator('[data-open]').first().tap(); await page.waitForTimeout(500); });
  await step('entrada-nova', async () => { await go('entradas'); await page.locator('button:has-text("Nova entrada")').first().tap(); await page.waitForTimeout(500); });
  await step('vitrine-item', async () => { await go('vitrine'); await page.locator('.vit-name').first().tap(); await page.waitForTimeout(500); });
  await step('categoria', async () => { await go('categorias'); await page.locator('.view button:visible', { hasText: 'Categoria' }).first().tap(); await page.waitForTimeout(400); });
  console.log(errors.length ? `  ERROS JS: ${errors.join(' | ')}` : '  sem erros de JS');
  await browser.close();
}
console.log(problems ? `\n${problems} tela(s) com problema` : '\nTUDO OK');
process.exit(problems ? 1 : 0);
