// Ataque SEM login contra o Supabase de verdade: tudo deve ser recusado.
// Rodar depois de cada mudança no banco (e antes de divulgar o catálogo):
//   cd tests && npm run test:security
// Opcional: SITE_URL=https://seu-site.netlify.app npm run test:security
//   (confere cabeçalhos de segurança, noindex e as pastas escondidas)
import fs from 'node:fs';

const cfg = fs.readFileSync(new URL('../../assets/js/config.js', import.meta.url), 'utf8');
const URL_ = /url:\s*'([^']+)'/.exec(cfg)[1];
const KEY = /anonKey:\s*'([^']+)'/.exec(cfg)[1];
const H = { apikey: KEY, 'Content-Type': 'application/json' };
const ZERO = '00000000-0000-0000-0000-000000000000';
// No Windows, sair com conexões do fetch ainda abertas derruba o Node: espera fechar.
const exit = async (code) => { await new Promise((r) => setTimeout(r, 300)); process.exit(code); };

let fails = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++; };
const call = async (path, opts = {}) => {
  const r = await fetch(URL_ + path, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  let body = null;
  try { body = await r.json(); } catch { /* sem corpo */ }
  return { status: r.status, body };
};

console.log('0. banco na versão nova?');
let r = await call('/rest/v1/rpc/keepalive', { method: 'POST', body: '{}' });
if (r.status === 404) {
  console.log('  ! keepalive() não existe: o banco ainda é a v1. Rode o supabase/schema.sql (e o seed) antes deste teste.');
  await exit(1);
}
ok(r.status === 200, `keepalive responde (sinal de vida do backup): ${r.status}`);

console.log('1. leitura sem login');
for (const t of ['store_settings', 'store_members', 'categories', 'products', 'product_variants', 'units', 'stock_movements', 'customers',
  'suppliers', 'orders', 'order_items', 'payments', 'order_installments', 'purchases', 'purchase_items', 'catalog_requests', 'client_errors',
  'order_items_view', 'order_payments_view']) {
  r = await call(`/rest/v1/${t}?select=*&limit=1`);
  ok(r.status >= 400 || (Array.isArray(r.body) && r.body.length === 0), `${t}: ${r.status}`);
}

console.log('2. escrita sem login');
r = await call('/rest/v1/customers', { method: 'POST', body: JSON.stringify({ name: 'invasor' }) });
ok(r.status >= 400, `insert customers: ${r.status}`);
r = await call('/rest/v1/product_variants?price=gt.0', { method: 'PATCH', body: JSON.stringify({ price: 1 }), headers: { Prefer: 'return=representation' } });
ok(r.status >= 400 || (Array.isArray(r.body) && !r.body.length), `baixar preço das variações: ${r.status}`);
r = await call('/rest/v1/payments', { method: 'POST', body: JSON.stringify({ order_id: ZERO, amount: -10 }) });
ok(r.status >= 400, `lançar pagamento/estorno: ${r.status}`);
r = await call('/rest/v1/order_installments?id=neq.' + ZERO, { method: 'PATCH', body: JSON.stringify({ reminded_at: new Date().toISOString() }), headers: { Prefer: 'return=representation' } });
ok(r.status >= 400 || (Array.isArray(r.body) && !r.body.length), `mexer nas parcelas do fiado: ${r.status}`);
r = await call('/rest/v1/store_settings?id=eq.1', { method: 'PATCH', body: JSON.stringify({ phone: '00000000000' }), headers: { Prefer: 'return=representation' } });
ok(r.status >= 400 || (Array.isArray(r.body) && !r.body.length), `trocar o WhatsApp da loja: ${r.status}`);

console.log('3. funções da loja sem login');
for (const [fn, args] of [
  ['whoami', {}], ['save_order', { p: { customer_name: 'x', items: [] } }], ['set_order_status', { p_id: ZERO, p_status: 'entregue' }],
  ['cancel_order', { p_id: ZERO, p_refund: true }], ['delete_order', { p_id: ZERO }], ['post_purchase', { p: {} }],
  ['cancel_purchase', { p_id: ZERO }], ['adjust_stock', { p_variant: ZERO, p_new_stock: 9 }], ['add_units', { p_variant: ZERO, p_units: [] }],
  ['save_unit', { p: {} }], ['discard_unit', { p_id: ZERO }], ['restore_unit', { p_id: ZERO }], ['set_prices', { p_items: [] }],
  ['delete_variant', { p_id: ZERO }], ['delete_product', { p_id: ZERO }], ['delete_category', { p_id: ZERO }],
  ['reorder_categories', { p_ids: [] }], ['import_order_list', { p: { items: [] } }], ['_migrate_legacy_orders', {}],
]) {
  r = await call(`/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
  ok(r.status >= 400, `${fn}: ${r.status}`);
}

console.log('4. catálogo público');
r = await call('/rest/v1/rpc/public_catalog', { method: 'POST', body: '{}' });
const txt = JSON.stringify(r.body || {});
ok(r.status === 200, `catálogo responde (aberto: ${r.body?.enabled})`);
ok(!/"(cost|order_cost|order_supplier|serial|stock|min_stock|barcode|supplier)"/.test(txt), 'sem custo, fornecedor, IMEI, saldo exato ou código de barras');
r = await call('/rest/v1/rpc/catalog_request', { method: 'POST', body: JSON.stringify({ p: { customer_name: '', items: [] } }) });
ok(r.status >= 400, `pedido do catálogo vazio é recusado: ${r.status}`);
r = await call('/rest/v1/rpc/log_client_error', { method: 'POST', body: JSON.stringify({ p: { message: '' } }) });
ok(r.status < 500, `catálogo consegue registrar erro (vazio não grava): ${r.status}`);

console.log('5. configuração do login');
r = await call('/auth/v1/settings');
ok(r.body?.disable_signup === true, `cadastro público desligado (Authentication → Sign In / Providers): disable_signup=${r.body?.disable_signup}`);

if (process.env.SITE_URL) {
  console.log('6. site publicado');
  const site = process.env.SITE_URL.replace(/\/$/, '');
  const home = await fetch(site);
  ok(/frame-ancestors 'none'/.test(home.headers.get('content-security-policy') || ''), 'CSP presente');
  ok(!!home.headers.get('strict-transport-security'), 'HSTS presente');
  ok(/noindex/.test(home.headers.get('x-robots-tag') || ''), 'painel fora dos buscadores (X-Robots-Tag)');
  const cat = await fetch(site + '/catalogo.html');
  ok(/noindex/.test(cat.headers.get('x-robots-tag') || '') || /name="robots" content="noindex/.test(await cat.text()), 'catálogo fora dos buscadores');
  for (const p of ['/supabase/schema.sql', '/tests/package.json', '/09_guia_para_replicar.md', '/.github/workflows/backup.yml']) {
    const x = await fetch(site + p);
    ok(x.status === 404, `${p} escondido: ${x.status}`);
  }
}

console.log(fails ? `\n${fails} falha(s)` : '\ntudo recusado como deveria');
await exit(fails ? 1 : 0);
