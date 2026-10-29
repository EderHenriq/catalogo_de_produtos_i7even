// Testa supabase/schema.sql + seed_catalogo.sql num Postgres real (PGlite)
// imitando o Supabase: papéis anon/authenticated, auth.users, auth.uid()
// lendo o "sub" do JWT e os privilégios padrão do "Automatically expose new
// tables" ligado (pior caso: tudo liberado até o schema revogar).
//
// O roteiro começa como a PRODUÇÃO está hoje: roda o schema da v1
// (fixtures/schema_v1.sql), grava pedidos do jeito que o app da v1 gravava
// e só então roda o schema novo - duas vezes. Os pedidos antigos têm que
// chegar intactos (mesmos totais, itens e pagamentos).
//
// Rodar:  cd tests  &&  npm install  &&  npm run test:db
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../supabase/', import.meta.url));
const strip = (sql) => sql.replace(/create extension if not exists pgcrypto;/, '');
const legacy = strip(fs.readFileSync(fileURLToPath(new URL('./fixtures/schema_v1.sql', import.meta.url)), 'utf8'));
const schema = strip(fs.readFileSync(ROOT + 'schema.sql', 'utf8'));
const seed = fs.readFileSync(ROOT + 'seed_catalogo.sql', 'utf8');

const db = new PGlite();
let fails = 0, passes = 0;
const ok = (cond, msg) => { if (cond) { passes++; console.log('  ✓', msg); } else { fails++; console.log('  ✗', msg); } };

async function expectError(sql, re, msg, params) {
  try { await db.query(sql, params); ok(false, `${msg} (não deu erro)`); }
  catch (e) { ok(re.test(e.message), `${msg} → "${e.message.split('\n')[0]}"`); }
}

async function as(role, uid) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
  if (role) await db.exec(`set role ${role}`);
}

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const all = async (sql, params) => (await db.query(sql, params)).rows;
const rpc = async (fn, arg) => one(`select * from public.${fn}($1::jsonb)`, [JSON.stringify(arg)]);
const n = (v) => Number(v);

await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text unique);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  create publication supabase_realtime;
`);

// Erro fora de um ok(): mostra só a mensagem do Postgres (a pilha do PGlite é enorme).
process.on('unhandledRejection', (e) => {
  console.error('\nERRO:', e?.message, e?.where ? `\n  em: ${e.where.split('\n')[0]}` : '');
  process.exit(1);
});

const eder = (await one(`insert into auth.users (email) values ('eder.pontes2014@gmail.com') returning id`)).id;
const julie = (await one(`insert into auth.users (email) values ('Juluccas1609@gmail.com') returning id`)).id;
const intruder = (await one(`insert into auth.users (email) values ('outro@x.com') returning id`)).id;

/* ------------------------------------------------------------------ v1 -- */

console.log('0. produção de hoje: schema da v1 + pedidos gravados pelo app da v1');
await db.exec(legacy);
await as('authenticated', eder);
const legacyOrders = [
  {
    customer_name: 'Maria Souza', customer_phone: '(44) 99999-1111', channel: 'Instagram', status: 'entregue',
    items: [
      { id: 'a1', categoryId: 'iphone', productId: 'iphone-15', productName: 'iPhone 15', variant: '128GB', color: 'Preto',
        condition: 'Lacrado', origin: 'Nacional', serial: '356789012345678', qty: 1, unitPrice: 4500, unitCost: 3900, warrantyDays: 365, note: '' },
      { id: 'a2', categoryId: 'acessorio', productId: 'capa', productName: 'Capa / Case', variant: 'Silicone', color: 'Diversas',
        condition: 'Lacrado', qty: 2, unitPrice: 79.9, unitCost: 20, warrantyDays: 0 },
    ],
    payments: [
      { id: '6f1c2a3e-1111-4a5b-8c9d-0e1f2a3b4c5d', date: '2026-09-10', amount: 2000, method: 'PIX', note: 'sinal' },
      { id: 'id-legado-sem-uuid', date: '2026-09-12', amount: 2659.8, method: 'Dinheiro', note: '' },
    ],
    discount: 0, shipping_cost: 0, shipping_expense: 0,
  },
  {
    customer_name: 'João Lima', customer_phone: '44988887777', status: 'aguardando',
    items: [{ id: 'b1', categoryId: 'watch', productId: 'watch-se-3', productName: 'Apple Watch SE 3', size: '40mm',
      variant: 'GPS', color: 'Meia-noite', band: 'Loop esportiva', condition: 'Lacrado', qty: 1, unitPrice: 2500, unitCost: 0 }],
    payments: [{ id: '7a2b3c4d-2222-4a5b-8c9d-0e1f2a3b4c5d', date: '2026-09-20', amount: 500, method: 'PIX' }],
    discount: 100, shipping_cost: 30, shipping_expense: 25,
  },
  {
    customer_name: 'Maria Souza', customer_phone: '44 99999-1111', status: 'novo',
    items: [{ id: 'c1', categoryId: 'outro', productId: 'livre-xyz', productName: 'Película privacidade', qty: 1, unitPrice: 60 }],
    payments: [],
  },
  { customer_name: 'Sem Itens', status: 'cancelado', items: [], payments: [] },
  // finalizado na v1 sem receber tudo: a migração não pode reescrever (regras do fiado são da v2)
  { customer_name: 'Fiado Antigo', status: 'entregue',
    items: [{ id: 'd1', categoryId: 'outro', productId: 'livre-abc', productName: 'Carregador', qty: 1, unitPrice: 150 }],
    payments: [{ id: '8b3c4d5e-3333-4a5b-8c9d-0e1f2a3b4c5d', date: '2026-09-01', amount: 50, method: 'PIX' }] },
];
for (const o of legacyOrders) {
  await db.query(`insert into public.orders (customer_name, customer_phone, channel, status, items, payments, discount,
      shipping_cost, shipping_expense, created_by_email) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'eder.pontes2014@gmail.com')`,
  [o.customer_name, o.customer_phone || null, o.channel || null, o.status, JSON.stringify(o.items), JSON.stringify(o.payments),
    o.discount || 0, o.shipping_cost || 0, o.shipping_expense || 0]);
}
await as(null);
const before = await all(`select id, code, customer_name, subtotal, total, profit, paid_amount, payment_status, cost_total
                            from public.orders order by code`);
ok(before.length === 5 && n(before[0].total) === 4659.8 && n(before[0].paid_amount) === 4659.8,
  `v1 calculou os totais pelo JSON (${before[0].total})`);

/* -------------------------------------------------------------- schema v2 -- */

console.log('1. schema.sql + seed rodam duas vezes sobre o banco da v1 (idempotente)');
await db.exec(schema); await db.exec(schema);
await db.exec(seed); await db.exec(seed);
ok(true, 'rodou 2× cada');
let r = await one('select count(*)::int n from public.store_members');
ok(r.n === 2, 'Eder e Julie autorizados (e-mail sem diferenciar maiúsculas)');
r = await one('select count(*)::int n, count(distinct slug)::int s from public.products');
ok(r.n === 113 && r.s === 113, `seed: 113 modelos sem duplicar (${r.n})`);
r = await one(`select count(*)::int n from public.categories`);
ok(r.n === 8, 'seed: 8 categorias');
r = await one(`select tracks_serial from public.products where slug = 'iphone-15'`);
ok(r.tracks_serial === true, 'iPhone controla IMEI; ');
r = await one(`select tracks_serial from public.products where slug = 'capa'`);
ok(r.tracks_serial === false, 'capa é por quantidade');

console.log('2. migração dos pedidos da v1');
const after = await all(`select id, code, customer_name, subtotal, total, profit, paid_amount, payment_status, cost_total,
                                legacy_migrated, customer_id from public.orders order by code`);
ok(after.every((o) => o.legacy_migrated), 'todos marcados como migrados');
for (const [i, b] of before.entries()) {
  const a = after[i];
  ok(['subtotal', 'total', 'profit', 'paid_amount', 'cost_total'].every((k) => n(a[k]) === n(b[k])) && a.payment_status === b.payment_status,
    `pedido #${b.code} (${b.customer_name}): totais iguais (${a.total} / recebido ${a.paid_amount} / ${a.payment_status})`);
}
r = await one(`select count(*)::int n from public.order_items`);
ok(r.n === 5, 'itens copiados para order_items (5)');
r = await one(`select count(*)::int n from public.payments`);
ok(r.n === 4, 'pagamentos copiados (4)');
r = await one(`select count(*)::int n from public.payments where id = '6f1c2a3e-1111-4a5b-8c9d-0e1f2a3b4c5d'`);
ok(r.n === 1, 'pagamento mantém o id da v1 quando era UUID');
r = await one(`select oi.product_id is not null as linked, oi.serial, oi.storage, oi.legacy_product, c.slug
                 from public.order_items oi left join public.categories c on c.id = oi.category_id
                where oi.product_name = 'iPhone 15'`);
ok(r.linked && r.slug === 'iphone' && r.storage === '128GB' && r.serial === '356789012345678',
  'item antigo ligado ao modelo iphone-15, categoria e IMEI preservados');
r = await one(`select band, size from public.order_items where product_name = 'Apple Watch SE 3'`);
ok(r.band === 'Loop esportiva' && r.size === '40mm', 'pulseira e caixa preservadas');
r = await one(`select count(*)::int n from public.customers`);
ok(r.n === 4, `clientes cadastrados a partir dos pedidos (Maria com 2 pedidos vira 1) - ${r.n}`);
r = await one(`select count(distinct customer_id)::int n from public.orders where customer_name = 'Maria Souza'`);
ok(r.n === 1, 'os dois pedidos da Maria apontam para o mesmo cliente (mesmo telefone)');
r = await one(`select items from public.orders where code = 1`);
ok(r.items.length === 2, 'JSON original da v1 continua guardado');
r = await one(`select count(*)::int n from public.stock_movements`);
ok(r.n === 0, 'pedidos antigos não mexem em estoque');
r = await one(`select public._migrate_legacy_orders() n`);
ok(r.n === 0, 'rodar a migração de novo não faz nada');
r = await one(`select status, balance from public.orders where customer_name = 'Fiado Antigo'`);
ok(r.status === 'entregue' && n(r.balance) === 100, 'pedido antigo finalizado com saldo continua como estava (aparece em "A receber")');

/* ------------------------------------------------------------- segurança -- */

console.log('3. anon (sem login)');
await as('anon');
for (const t of ['products', 'product_variants', 'units', 'orders', 'order_items', 'payments', 'customers',
  'store_settings', 'store_members', 'stock_movements', 'purchases', 'catalog_requests', 'client_errors']) {
  await expectError(`select * from public.${t}`, /permission denied/, `anon não lê ${t}`);
}
await expectError(`select public.save_order('{}'::jsonb)`, /permission denied/, 'anon não chama save_order');
await expectError(`select public.whoami()`, /permission denied/, 'anon não chama whoami');
await expectError(`select public._migrate_legacy_orders()`, /permission denied/, 'anon não chama função interna');
r = await one('select public.keepalive() as t');
ok(!!r.t, 'anon chama keepalive (sinal de vida, sem dados)');

r = await all(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute') order by 1`);
ok(JSON.stringify(r.map((x) => x.proname)) === JSON.stringify(['catalog_request', 'keepalive', 'log_client_error', 'public_catalog']),
  `anon só executa as 4 funções públicas (${r.map((x) => x.proname).join(', ')})`);
r = await all(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'v') and has_table_privilege('anon', c.oid, 'select') order by 1`);
ok(r.length === 0, `anon não lê nenhuma tabela nem view (${r.map((x) => x.relname).join(', ') || 'nenhuma'})`);
r = await all(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1`);
ok(r.length === 0, `RLS ligado em toda tabela (${r.map((x) => x.relname).join(', ') || 'todas'})`);

console.log('4. login que não é da loja');
await as('authenticated', intruder);
r = await one('select count(*)::int n from public.orders');
ok(r.n === 0, 'não enxerga pedidos');
r = await one('select count(*)::int n from public.products');
ok(r.n === 0, 'não enxerga produtos');
r = await one(`select public.whoami() w`);
ok(r.w.member === false && r.w.schema_version === 2, 'whoami: não é membro, banco versão 2');
await expectError(`insert into public.customers (name) values ('x')`, /row-level security/, 'não cadastra cliente');
await expectError(`select public.save_order('{"customer_name":"x"}'::jsonb)`, /Acesso negado/, 'não cria pedido');
await expectError(`select public.adjust_stock(gen_random_uuid(), 5)`, /Acesso negado/, 'não ajusta estoque');

console.log('5. membro: cadastro e permissões de coluna');
await as('authenticated', julie);
r = await one(`select public.whoami() w`);
ok(r.w.member === true && r.w.name === 'Julie', 'whoami: Julie é da loja');
await expectError(`insert into public.orders (customer_name) values ('x')`, /permission denied/, 'pedido não é gravado direto na tabela');
await expectError(`update public.orders set total = 1`, /permission denied/, 'total do pedido não muda direto');
r = await one(`update public.orders set priority = true where code = 2 returning priority`);
ok(r.priority === true, 'urgência muda direto');
await expectError(`delete from public.orders where code = 4`, /permission denied/, 'pedido não é excluído direto');
await expectError(`insert into public.stock_movements (variant_id, kind, qty) values (gen_random_uuid(), 'ajuste', 1)`,
  /permission denied/, 'movimento não é gravado direto');
await expectError(`insert into public.units (variant_id, serial) values (gen_random_uuid(), 'x')`,
  /permission denied/, 'aparelho não é gravado direto');

const pid = async (slug) => (await one(`select id from public.products where slug = $1`, [slug])).id;
const iph15 = await pid('iphone-15');
const capa = await pid('capa');
const vCapa = (await one(`insert into public.product_variants (product_id, storage, color, condition, price, cost, stock, min_stock)
  values ($1, 'Silicone', 'Preta', 'Lacrado', 89.9, 22, 10, 2) returning id, stock`, [capa]));
ok(vCapa.stock === 10, 'variação de capa nasce com estoque 10');
r = await one(`select kind, qty from public.stock_movements where variant_id = $1`, [vCapa.id]);
ok(r?.kind === 'inicial' && r.qty === 10, 'estoque inicial vira movimento "inicial"');
await expectError(`update public.product_variants set stock = 99 where id = $1`, /permission denied/, 'saldo não muda por update direto', [vCapa.id]);
r = await one(`update public.product_variants set price = 99.9, min_stock = 3 where id = $1 returning price`, [vCapa.id]);
ok(n(r.price) === 99.9, 'preço e mínimo mudam direto');
await expectError(`insert into public.product_variants (product_id, storage, color, condition) values ($1, 'silicone', 'PRETA', 'lacrado')`,
  /duplicate key|product_variants_combo_uk/, 'mesma combinação não duplica (sem diferenciar maiúsculas)', [capa]);

const v128 = (await one(`insert into public.product_variants (product_id, storage, color, condition, price, stock)
  values ($1, '128GB', 'Preto', 'Lacrado', 4599, 5) returning id, stock`, [iph15]));
ok(v128.stock === 0, 'modelo com IMEI ignora saldo digitado (vem das unidades)');
const v256 = (await one(`insert into public.product_variants (product_id, storage, color, condition, price)
  values ($1, '256GB', 'Azul', 'Lacrado', 5299) returning id`, [iph15])).id;

/* ---------------------------------------------------------------- entradas -- */

console.log('6. entrada: frete rateado, câmbio, IMEI');
r = await rpc('post_purchase', {
  supplier_name: 'Fornecedor PY', currency: 'USD', exchange_rate: 5.5, freight: 110,
  items: [
    { variant_id: v128.id, unit_cost: 700, sale_price: 4699, units: [
      { serial: '350000000000001', origin: 'Importado (Paraguai)' },
      { serial: '350000000000002', origin: 'Importado (Paraguai)', battery_health: 100 },
    ] },
    { variant_id: vCapa.id, qty: 20, unit_cost: 2 },
  ],
});
// nota em R$: 2 × 700 × 5,5 = 7700 + 20 × 2 × 5,5 = 220 → 7920; frete 110
ok(n(r.items_total) === 7920 && n(r.total) === 8030, `total da nota em R$ (${r.items_total} + frete = ${r.total})`);
const purchase1 = r.id;
r = await one(`select stock, cost, price from public.product_variants where id = $1`, [v128.id]);
// cada iPhone: 3850 + 110 × 3850/7920 = 53,4722 → 3903,4722
ok(r.stock === 2 && Math.abs(n(r.cost) - 3903.4722) < 0.001 && n(r.price) === 4699,
  `iPhone: 2 aparelhos, custo real ${r.cost}, preço da entrada`);
r = await one(`select stock, cost from public.product_variants where id = $1`, [vCapa.id]);
// capa: 2 × 5,5 = 11 + 110 × 220/7920 / 20 = 0,1528 → 11,1528; médio (10×22 + 20×11,1528)/30 = 14,7685
ok(r.stock === 30 && Math.abs(n(r.cost) - 14.7685) < 0.001, `capa: 10 + 20 = 30, custo médio ${r.cost}`);
await expectError(`select public.post_purchase($1::jsonb)`, /já está no estoque/, 'IMEI repetido é recusado',
  [JSON.stringify({ items: [{ variant_id: v128.id, unit_cost: 1, units: [{ serial: '350000000000001' }] }] })]);
// IMEI opcional (v2.1): entrada por quantidade num modelo com IMEI cria aparelhos sem IMEI
const vNoImei = (await one(`insert into public.product_variants (product_id, storage, color, condition, price)
  values ($1, '64GB', 'Teste', 'Seminovo', 0) returning id`, [iph15])).id;
r = await rpc('post_purchase', { items: [{ variant_id: vNoImei, qty: 2, unit_cost: 1000 }] });
r = await one(`select stock, (select count(*)::int from public.units where variant_id = $1 and serial is null) n from public.product_variants where id = $1`, [vNoImei]);
ok(r.stock === 2 && r.n === 2, `entrada sem IMEI: 2 aparelhos sem IMEI no estoque (${r.stock})`);
r = await one(`select public.add_units($1, $2::jsonb) n`, [vNoImei, JSON.stringify([{ cost: 900 }])]);
ok(r.n === 1, 'cadastrar aparelho sem IMEI também vale');
const oNo = await rpc('save_order', { status: 'pago', customer_name: 'Sem IMEI', items: [{ variant_id: vNoImei, product_name: 'iPhone 15', qty: 2, unit_price: 2000 }],
  payments: [{ amount: 4000, method: 'PIX' }] });
r = await one(`select cardinality(unit_ids) n from public.order_items where order_id = $1`, [oNo.id]);
ok(r.n === 2, 'venda sem escolher o aparelho: o sistema separa 2 do estoque sozinho');
r = await one(`select stock from public.product_variants where id = $1`, [vNoImei]);
ok(r.stock === 1, `estoque 3 → 1 (${r.stock})`);
r = await one(`select status from public.set_order_status($1, 'entregue')`, [oNo.id]);
ok(r.status === 'entregue', 'finaliza sem pedir IMEI');
await db.query(`select public.delete_order($1)`, [oNo.id]);
r = await one(`select stock from public.product_variants where id = $1`, [vNoImei]);
ok(r.stock === 3, 'excluir a venda devolve os aparelhos (3)');
r = await rpc('add_units', null).catch(() => null);
r = await one(`select public.add_units($1, $2::jsonb, 'troca') n`, [v256, JSON.stringify([{ serial: '350000000000009', cost: 4100, battery_health: 88 }])]);
ok(r.n === 1, 'aparelho avulso (troca/estoque inicial) entra com add_units');
r = await one(`select stock, cost from public.product_variants where id = $1`, [v256]);
ok(r.stock === 1 && n(r.cost) === 4100, 'saldo e custo da variação vêm da unidade');

/* ----------------------------------------------------------------- pedidos -- */

console.log('7. pedido: estoque por quantidade, IMEI, encomenda, cliente');
const unitsOf = async (vid) => all(`select id, serial, status from public.units where variant_id = $1 order by serial`, [vid]);
let [u1, u2] = await unitsOf(v128.id);
const ref = '11111111-2222-4333-8444-555555555555';
const o1 = await rpc('save_order', {
  client_ref: ref, status: 'pago', customer_name: 'Carla Dias', customer_phone: '(44) 91234-5678',
  items: [
    { variant_id: v128.id, product_name: 'iPhone 15', qty: 1, unit_price: 4699, unit_ids: [u1.id], warranty_days: 365 },
    { variant_id: vCapa.id, product_name: 'Capa / Case', qty: 3, unit_price: 99.9 },
  ],
  payments: [{ id: '22222222-3333-4444-8555-666666666666', paid_at: '2026-10-01', amount: 1000, method: 'PIX' }],
});
ok(n(o1.total) === 4998.7 && n(o1.paid_amount) === 1000 && o1.payment_status === 'parcial', `total ${o1.total}, recebido 1000, parcial`);
ok(o1.stock_applied === true && o1.created_by_email === 'juluccas1609@gmail.com', 'estoque aplicado; carimbo de quem lançou vem do banco');
r = await one(`select status, order_id from public.units where id = $1`, [u1.id]);
ok(r.status === 'vendido' && r.order_id === o1.id, 'aparelho escolhido virou "vendido" neste pedido');
r = await one(`select stock from public.product_variants where id = $1`, [v128.id]);
ok(r.stock === 1, 'iPhone 2 → 1');
r = await one(`select stock from public.product_variants where id = $1`, [vCapa.id]);
ok(r.stock === 27, 'capa 30 → 27');
r = await one(`select serial, unit_cost from public.order_items where order_id = $1 and position = 1`, [o1.id]);
ok(r.serial === '350000000000001' && Math.abs(n(r.unit_cost) - 3903.4722) < 0.001, 'item guarda o IMEI e o custo do aparelho');
r = await one(`select profit from public.orders where id = $1`, [o1.id]);
ok(Math.abs(n(r.profit) - (4998.7 - 3903.47 - 3 * 14.77)) < 0.05, `lucro = venda − custo (${r.profit})`);

r = await rpc('save_order', { client_ref: ref, customer_name: 'Carla Dias', items: [] });
ok(r.id === o1.id, 'reenvio com o mesmo client_ref devolve o pedido existente');
r = await one(`select count(*)::int n from public.orders where customer_name = 'Carla Dias'`);
ok(r.n === 1, 'e não grava outro');

await expectError(`select public.save_order($1::jsonb)`, /Estoque insuficiente[\s\S]*Capa \/ Case · Silicone · Preta · Lacrado: tem 27, precisa de 50/,
  'pedido acima do estoque é recusado com o nome', [JSON.stringify({ customer_name: 'X', items: [{ variant_id: vCapa.id, qty: 50, unit_price: 1 }] })]);
await expectError(`select public.save_order($1::jsonb)`, /IMEI 350000000000001: já vendido no pedido/,
  'mesmo aparelho em dois pedidos é recusado', [JSON.stringify({ customer_name: 'X', items: [{ variant_id: v128.id, qty: 1, unit_price: 1, unit_ids: [u1.id] }] })]);
r = await one(`select stock from public.product_variants where id = $1`, [vCapa.id]);
ok(r.stock === 27, 'recusa não mexe em nada');

// encomenda: combinação que não existia + sem aparelho escolhido
const o2 = await rpc('save_order', {
  status: 'aguardando', customer_name: 'Pedro', customer_phone: '44 3333-2222',
  items: [{ product_id: iph15, storage: '512GB', color: 'Rosa', condition: 'Lacrado', product_name: 'iPhone 15', qty: 1, unit_price: 6200 }],
});
r = await one(`select v.id, v.price, v.stock from public.order_items oi join public.product_variants v on v.id = oi.variant_id where oi.order_id = $1`, [o2.id]);
ok(r && n(r.price) === 6200 && r.stock === 0, 'encomenda cria a variação 512GB · Rosa (preço do pedido, sem estoque)');
r = await one(`select status from public.set_order_status($1, 'enviado')`, [o2.id]);
ok(r.status === 'enviado', 'encomenda sem aparelho no estoque pode ir para "Em entrega" (IMEI opcional)');
r = await one(`select cardinality(unit_ids) n from public.order_items where order_id = $1`, [o2.id]);
ok(r.n === 0, 'sem estoque da variação: continua sem aparelho (encomenda)');

// edição com a trava de versão
const fresh = await one(`select updated_at from public.orders where id = $1`, [o1.id]);
await expectError(`select public.save_order($1::jsonb)`, /CONFLITO/, 'versão velha do pedido é recusada',
  [JSON.stringify({ id: o1.id, expected_updated_at: '2020-01-01T00:00:00Z', customer_name: 'Carla Dias', items: [] })]);
const o1b = await rpc('save_order', {
  id: o1.id, expected_updated_at: fresh.updated_at, status: 'entregue', customer_name: 'Carla Dias', customer_phone: '(44) 91234-5678',
  items: [{ variant_id: v128.id, product_name: 'iPhone 15', qty: 1, unit_price: 4699, unit_ids: [u2.id] }],
  payments: [
    { id: '22222222-3333-4444-8555-666666666666', paid_at: '2026-10-01', amount: 1000, method: 'PIX' },
    { id: '33333333-3333-4444-8555-666666666666', paid_at: '2026-10-05', amount: 3699, method: 'Cartão de crédito' },
  ],
});
ok(o1b.payment_status === 'pago' && n(o1b.total) === 4699 && o1b.delivered_at, 'editado: troca de aparelho, sem capa, quitado e finalizado');
r = await all(`select serial, status from public.units where variant_id = $1 order by serial`, [v128.id]);
ok(r[0].status === 'estoque' && r[1].status === 'vendido', 'aparelho trocado: o 1º voltou ao estoque, o 2º foi vendido');
r = await one(`select stock from public.product_variants where id = $1`, [vCapa.id]);
ok(r.stock === 30, 'capas tiradas do pedido voltaram (30)');
r = await one(`select count(*)::int n from public.payments where order_id = $1`, [o1.id]);
ok(r.n === 2, 'pagamentos: lista inteira (2)');

// cliente pelo telefone
r = await one(`select count(*)::int n from public.customers where name = 'Carla Dias'`);
ok(r.n === 1, 'cliente criado uma vez só');
const o3 = await rpc('save_order', { customer_name: 'Carla D.', customer_phone: '44912345678', status: 'orcamento', items: [] });
r = await one(`select c.name from public.orders o join public.customers c on c.id = o.customer_id where o.id = $1`, [o3.id]);
ok(r.name === 'Carla Dias', 'mesmo telefone acha a cliente mesmo com outro nome');

console.log('8. status, cancelamento e estorno');
r = await one(`select * from public.cancel_order($1, true, '2026-10-10')`, [o1.id]);
ok(r.status === 'cancelado' && r.payment_status === 'estornado' && n(r.paid_amount) === 0, 'cancelado com estorno: recebido zera');
r = await all(`select amount, method, paid_at::text from public.payments where order_id = $1 and amount < 0 order by method`, [o1.id]);
ok(r.length === 2 && n(r[0].amount) === -3699 && r[0].paid_at === '2026-10-10', 'estorno por forma, na data da devolução');
r = await one(`select count(*)::int n from public.units where variant_id = $1 and status = 'estoque'`, [v128.id]);
ok(r.n === 2, 'aparelhos do pedido cancelado voltaram ao estoque');
r = await one(`select * from public.set_order_status($1, 'novo')`, [o1.id]);
ok(r.stock_applied === true, 'reabrir o pedido tira do estoque de novo');
await db.query(`select public.delete_order($1)`, [o1.id]);
r = await one(`select count(*)::int n from public.units where variant_id = $1 and status = 'estoque'`, [v128.id]);
ok(r.n === 2, 'excluir o pedido devolve os aparelhos');

console.log('9. ajuste, baixa de aparelho, preços e exclusão');
r = await one(`select stock from public.adjust_stock($1, 25, 'contagem')`, [vCapa.id]);
ok(r.stock === 25, 'ajuste de quantidade');
await expectError(`select public.adjust_stock($1, 5)`, /controlado por IMEI/, 'aparelho não usa ajuste de quantidade', [v128.id]);
[u1] = await unitsOf(v128.id);
r = await one(`select status from public.discard_unit($1, 'tela quebrada')`, [u1.id]);
ok(r.status === 'baixa', 'baixa de aparelho');
r = await one(`select stock from public.product_variants where id = $1`, [v128.id]);
ok(r.stock === 1, 'saldo recalculado (1)');
await db.query(`select public.restore_unit($1)`, [u1.id]);
r = await one(`select stock from public.product_variants where id = $1`, [v128.id]);
ok(r.stock === 2, 'desfazer a baixa devolve (2)');
r = await one(`select serial from public.save_unit($1::jsonb)`, [JSON.stringify({ id: u1.id, serial: ' 350000000000077 ', battery_health: 91 })]);
ok(r.serial === '350000000000077', 'corrige o IMEI digitado errado');
r = await one(`select public.set_prices($1::jsonb) n`, [JSON.stringify([{ variant_id: v128.id, price: 4499 }, { variant_id: v256, price: 5299 }])]);
ok(r.n === 1, 'reajuste em lote grava só o que mudou');
await expectError(`select public.delete_variant($1)`, /EM_USO/, 'variação com histórico não é excluída', [v128.id]);
await expectError(`select public.delete_product($1)`, /EM_USO/, 'modelo com pedidos não é excluído', [iph15]);
const tmp = (await one(`insert into public.product_variants (product_id, storage, color, condition, price, stock) values ($1, 'Couro', 'Marrom', 'Lacrado', 120, 3) returning id`, [capa])).id;
await db.query(`select public.delete_variant($1)`, [tmp]);
r = await one(`select count(*)::int n from public.product_variants where id = $1`, [tmp]);
ok(r.n === 0, 'variação sem histórico (só estoque inicial) é excluída');
await expectError(`update public.products set tracks_serial = false where id = $1`, /não dá mais para trocar/, 'não troca o controle por IMEI com histórico', [iph15]);

console.log('10. cancelar entrada');
const sold = await one(`select id from public.units where serial = '350000000000002'`);
const oSold = await rpc('save_order', { status: 'pago', customer_name: 'Venda da entrada',
  items: [{ variant_id: v128.id, product_name: 'iPhone 15', qty: 1, unit_price: 4499, unit_ids: [sold.id] }] });
await expectError(`select public.cancel_purchase($1)`, /já saiu do estoque[\s\S]*350000000000002 já foi vendido/,
  'entrada com aparelho já vendido não cancela', [purchase1]);
await db.query(`select public.delete_order($1)`, [oSold.id]);
const p2 = await rpc('post_purchase', { items: [{ variant_id: v256, unit_cost: 4000, units: [{ serial: '350000000000500' }] }] });
r = await one(`select stock from public.product_variants where id = $1`, [v256]);
ok(r.stock === 2, 'entrada nova: 2 em estoque');
r = await one(`select status from public.cancel_purchase($1)`, [p2.id]);
ok(r.status === 'cancelada', 'entrada intacta é cancelada');
r = await one(`select stock, cost from public.product_variants where id = $1`, [v256]);
ok(r.stock === 1 && n(r.cost) === 4100, 'saldo e custo voltaram');

/* --------------------------------------------------------------- catálogo -- */

console.log('11. catálogo público');
await as('anon');
r = await one(`select public.public_catalog() c`);
ok(r.c.enabled === false && !r.c.products, 'fechado: não devolve produtos');
await expectError(`select public.catalog_request($1::jsonb)`, /fechado/, 'fechado: não aceita pedido', [JSON.stringify({ customer_name: 'A', items: [{ variant_id: v256, qty: 1 }] })]);
await as('authenticated', eder);
await db.query(`update public.store_settings set catalog_enabled = true, phone = '44999990000', store_name = 'i7even Store'`);
await db.query(`update public.product_variants set show_in_catalog = false where id = $1`, [vCapa.id]);
const activeCats = (await one(`select count(*)::int n from public.categories where active`)).n;
await as('anon');
r = await one(`select public.public_catalog() c`);
const prod = r.c.products.find((p) => p.name === 'iPhone 15');
ok(r.c.enabled && prod && prod.variants.length >= 2, `aberto: iPhone 15 com ${prod?.variants.length} variações`);
const json = JSON.stringify(r.c);
ok(!/"cost"|"stock"|"serial"|"min_stock"|3903|350000000/.test(json), 'nunca sai custo, saldo exato nem IMEI');
ok(!r.c.products.some((p) => p.name === 'Capa / Case'), 'variação escondida não aparece (e o modelo sem variação visível some)');
ok(r.c.categories.length === activeCats, `todas as categorias ativas (também as vazias): ${r.c.categories.length}`);
const v128pub = prod.variants.find((v) => v.storage === '128GB');
ok(v128pub.available === true && v128pub.last_units === true && n(v128pub.price) === 4499, 'variação disponível, "últimas unidades", preço do banco ' + JSON.stringify(v128pub));
r = await one(`select public.catalog_request($1::jsonb) r`, [JSON.stringify({
  customer_name: 'Ana', customer_phone: '(44) 98888-0000', items: [{ variant_id: v128.id, qty: 1, unit_price: 1 }, { variant_id: vCapa.id, qty: 1 }],
})]);
ok(n(r.r.total) === 4499 && r.r.items.length === 1, 'pedido do catálogo: preço do BANCO e item escondido descartado');
ok(r.r.items[0].name === 'iPhone 15 · 128GB · Preto · Lacrado', `nome completo da variação (${r.r.items[0].name})`);
await expectError(`select * from public.catalog_requests`, /permission denied/, 'anon não lê os pedidos do catálogo');
for (let i = 0; i < 8; i++) {
  await db.query(`select public.catalog_request($1::jsonb)`, [JSON.stringify({ customer_name: 'Robô', customer_phone: '11999999999', items: [{ variant_id: v256, qty: 1 }] })]).catch(() => {});
}
await expectError(`select public.catalog_request($1::jsonb)`, /Muitos pedidos/, 'freio por telefone (8/hora)',
  [JSON.stringify({ customer_name: 'Robô', customer_phone: '11999999999', items: [{ variant_id: v256, qty: 1 }] })]);
await db.query(`select public.log_client_error($1::jsonb)`, [JSON.stringify({ message: 'erro no celular do cliente' })]);
await as('authenticated', eder);
r = await one(`select count(*)::int n from public.client_errors where context ->> 'source' = 'catalogo'`);
ok(r.n === 1, 'erro do catálogo chega no diagnóstico');

console.log('13. sob encomenda: lista do fornecedor');
await as('anon');
await expectError(`select public.import_order_list('{}'::jsonb)`, /permission denied/, 'anon não importa lista');
await as('authenticated', julie);
const i16 = await pid('iphone-16');
r = await one(`select public.import_order_list($1::jsonb) r`, [JSON.stringify({ supplier: 'Fornecedor SP', lead: '7 a 10 dias', items: [
  { product_id: iph15, storage: '256GB', color: 'Azul', condition: 'Lacrado', cost: 4800, price: 5390 },
  { product_id: i16, storage: '128GB', color: 'Preto', condition: 'Lacrado', cost: 4500, price: 4990 },
  { product_id: i16, storage: '256GB', color: 'Branco', condition: 'Seminovo', cost: 3900, price: 4390 },
] })]);
ok(r.r.created === 2 && r.r.updated === 1 && r.r.removed === 0, `importou: 2 novas + 1 existente (${JSON.stringify(r.r)})`);
r = await one(`select on_order, order_price, order_cost, order_lead, order_supplier, price, stock from public.product_variants where id = $1`, [v256]);
ok(r.on_order && Number(r.order_price) === 5390 && Number(r.order_cost) === 4800 && r.order_lead === '7 a 10 dias' && Number(r.price) === 5299,
  'variação existente: oferta de encomenda ligada, preço de pronta entrega intacto');
await expectError(`select public.import_order_list($1::jsonb)`, /valor de venda/, 'item sem preço de venda é recusado',
  [JSON.stringify({ items: [{ product_id: i16, storage: '128GB', color: 'Preto', price: 0 }] })]);
r = await one(`select public.import_order_list($1::jsonb) r`, [JSON.stringify({ supplier: 'Fornecedor SP', replace: true, items: [
  { product_id: i16, storage: '128GB', color: 'Preto', condition: 'Lacrado', cost: 4400, price: 4890 },
] })]);
ok(r.r.updated === 1 && r.r.removed === 2, `substituir a lista: o que não veio sai da encomenda (${JSON.stringify(r.r)})`);
r = await one(`select on_order from public.product_variants where id = $1`, [v256]);
ok(r.on_order === false, 'o iPhone 15 256GB saiu da encomenda');
await db.query(`select public.import_order_list($1::jsonb)`, [JSON.stringify({ supplier: 'Outro fornecedor', items: [
  { product_id: iph15, storage: '256GB', color: 'Azul', condition: 'Lacrado', price: 5400 }] })]);
await as('anon');
r = await one(`select public.public_catalog() c`);
let p16 = r.c.products.find((x) => x.name === 'iPhone 16');
let v16 = p16?.variants.find((v) => v.storage === '128GB');
ok(p16 && v16.on_order && !v16.available && Number(v16.price) === 4890 && v16.order_lead === '7 a 10 dias',
  'catálogo: iPhone 16 aparece sob encomenda com preço e prazo');
const p15 = r.c.products.find((x) => x.name === 'iPhone 15');
const v15 = p15.variants.find((v) => v.storage === '256GB');
ok(v15.available && v15.on_order && Number(v15.ready_price) === 5299 && Number(v15.order_price) === 5400,
  'variação com estoque E encomenda mostra os dois preços');
ok(!/order_cost|order_supplier|4400/.test(JSON.stringify(r.c)), 'custo e fornecedor da encomenda nunca saem no catálogo');
r = await one(`select public.catalog_request($1::jsonb) r`, [JSON.stringify({ customer_name: 'Lia', customer_phone: '44955554444', items: [
  { variant_id: v16.id, qty: 1, mode: 'encomenda' },
  { variant_id: v15.id, qty: 1, mode: 'pronta' },
  { variant_id: v15.id, qty: 1, mode: 'encomenda' },
] })]);
const its = r.r.items;
ok(its[0].mode === 'encomenda' && Number(its[0].unit_price) === 4890 && its[0].lead === '7 a 10 dias', 'item de encomenda com preço e prazo da lista');
ok(its[1].mode === 'pronta' && Number(its[1].unit_price) === 5299 && its[2].mode === 'encomenda' && Number(its[2].unit_price) === 5400,
  'mesma variação: pronta entrega e encomenda com preços diferentes');
r = await one(`select public.catalog_request($1::jsonb) r`, [JSON.stringify({ customer_name: 'Rui', items: [{ variant_id: v16.id, qty: 1, mode: 'pronta' }] })]);
ok(r.r.items[0].mode === 'encomenda', 'pediu pronta entrega do que não tem estoque: vira encomenda');
await as('authenticated', eder);

console.log('13b. lista de PRONTA ENTREGA (a lista da loja vira o catálogo)');
const p13 = await pid('iphone-13');
await db.query(`update public.products set show_in_catalog = false where id = $1`, [p13]);
const listaPronta = { mode: 'pronta', replace: false, items: [
  { product_id: p13, storage: '128GB', color: 'Meia-noite', condition: 'Seminovo', price: 2147 },
  { product_id: p13, storage: '256GB', color: 'Rosa', condition: 'Seminovo', price: 2297, qty: 2 },
  { product_id: capa, storage: 'Silicone', color: 'Azul', condition: 'Lacrado', price: 99, qty: 5 },
] };
r = await one(`select public.import_order_list($1::jsonb) r`, [JSON.stringify(listaPronta)]);
ok(r.r.created === 3 && r.r.units === 8, `3 variações criadas, 1 + 2 aparelhos sem IMEI + 5 capas (${JSON.stringify(r.r)})`);
r = await one(`select show_in_catalog, active from public.products where id = $1`, [p13]);
ok(r.show_in_catalog && r.active, 'modelo escondido volta a aparecer no catálogo');
r = await all(`select storage, price::float p, stock from public.product_variants where product_id = $1 and condition = 'Seminovo' order by storage`, [p13]);
ok(r.length === 2 && r[0].p === 2147 && r[0].stock === 1 && r[1].stock === 2, 'preço e estoque da lista gravados');
r = await one(`select public.import_order_list($1::jsonb) r`, [JSON.stringify(listaPronta)]);
ok(r.r.units === 0 && r.r.updated === 3, 'colar a mesma lista de novo não duplica estoque');
await as('anon');
r = await one(`select public.public_catalog() c`);
const c13 = r.c.products.find((x) => x.name === 'iPhone 13');
ok(c13 && c13.variants.filter((v) => v.available).length === 2, 'iPhone 13 aparece na hora como pronta entrega');
await as('authenticated', eder);
r = await one(`select public.import_order_list($1::jsonb) r`, [JSON.stringify({ ...listaPronta, replace: true, items: listaPronta.items.slice(0, 1) })]);
r = await one(`select show_in_catalog, stock from public.product_variants where product_id = $1 and storage = '256GB' and condition = 'Seminovo'`, [p13]);
ok(!r.show_in_catalog && r.stock === 2, 'substituir: o que saiu da lista sai do catálogo, mas o estoque fica');

console.log('14. fiado: parcelas, aguardando pagamento e finalização automática');
const cap2 = (await one(`insert into public.product_variants (product_id, storage, color, condition, price, cost, stock)
                          values ($1, 'Fiado', 'Azul', 'Lacrado', 1000, 600, 5) returning id`, [capa])).id;
const plan = [
  { id: '0f000000-0000-4000-8000-000000000000', number: 0, due_date: '2026-10-01', amount: 400, note: 'Entrada' },
  { id: '0f000000-0000-4000-8000-000000000001', number: 1, due_date: '2026-11-01', amount: 300 },
  { id: '0f000000-0000-4000-8000-000000000002', number: 2, due_date: '2026-12-01', amount: 300 },
];
let of = await rpc('save_order', { status: 'entregue', customer_name: 'Bia Fiado', customer_phone: '44933332222',
  items: [{ variant_id: cap2, product_name: 'Capa', qty: 1, unit_price: 1000 }], plan,
  payments: [{ id: '0e000000-0000-4000-8000-000000000000', paid_at: '2026-10-01', amount: 400, method: 'PIX' }] });
ok(of.status === 'aguardando' && of.handed_over_at && !of.delivered_at,
  'finalizar sem receber tudo: fica "Aguardando pagamento", com a data em que o cliente levou');
ok(n(of.balance) === 600 && of.installments === 2, `saldo 600 e 2 parcelas (${of.balance}, ${of.installments})`);
r = await all(`select number, due_date::text, amount from public.order_installments where order_id = $1 order by number`, [of.id]);
ok(r.length === 3 && r[0].number === 0 && n(r[2].amount) === 300, 'entrada + 2 parcelas gravadas');
await expectError(`select public.set_order_status($1, 'pago')`, /Falta receber R\$ 600,00/, '"Pago" sem quitar é recusado com o valor que falta', [of.id]);
r = await one(`select * from public.set_order_status($1, 'entregue')`, [of.id]);
ok(r.status === 'aguardando', '"Finalizado" sem quitar continua aguardando');
await expectError(`select public.save_order($1::jsonb)`, /parcelas somam R\$ 900,00, mas o pedido é de R\$ 1000,00/,
  'parcelas que não fecham com o total são recusadas',
  [JSON.stringify({ id: of.id, status: 'aguardando', customer_name: 'Bia Fiado', items: [{ variant_id: cap2, product_name: 'Capa', qty: 1, unit_price: 1000 }],
    plan: plan.map((x, i) => (i === 2 ? { ...x, amount: 200 } : x)) })]);
// 1ª parcela por pagamento lançado direto (como a tela "Receber parcela")
await db.query(`insert into public.payments (id, order_id, paid_at, amount, method) values ('0e000000-0000-4000-8000-000000000001', $1, '2026-11-02', 300, 'PIX')`, [of.id]);
r = await one(`select status, balance from public.orders where id = $1`, [of.id]);
ok(r.status === 'aguardando' && n(r.balance) === 300, 'pagou a 1ª parcela: ainda aguardando, falta 300');
await db.query(`insert into public.payments (id, order_id, paid_at, amount, method) values ('0e000000-0000-4000-8000-000000000002', $1, '2026-12-01', 300, 'Dinheiro')`, [of.id]);
r = await one(`select status, balance, delivered_at, handed_over_at from public.orders where id = $1`, [of.id]);
ok(r.status === 'entregue' && n(r.balance) === 0 && r.delivered_at, 'quitou: o pedido finaliza sozinho');
await db.query(`delete from public.payments where id = '0e000000-0000-4000-8000-000000000002'`);
r = await one(`select status, handed_over_at from public.orders where id = $1`, [of.id]);
ok(r.status === 'aguardando' && r.handed_over_at, 'apagou um pagamento: volta para aguardando (o cliente continua com o produto)');
r = await one(`select status from public.save_order($1::jsonb)`, [JSON.stringify({ status: 'aguardando', customer_name: 'Paga Tudo',
  items: [{ variant_id: cap2, product_name: 'Capa', qty: 1, unit_price: 1000 }],
  payments: [{ id: '0e000000-0000-4000-8000-000000000009', amount: 1000, method: 'PIX' }] })]);
ok(r.status === 'pago', 'aguardando pagamento que já veio quitado vira "Pago"');
r = await one(`update public.order_installments set reminded_at = now() where number = 1 and order_id = $1 returning reminded_at`, [of.id]);
ok(!!r?.reminded_at, 'a loja marca "cobrei hoje" na parcela');
await expectError(`update public.order_installments set amount = 1 where order_id = $1`, /permission denied/, 'valor da parcela só muda pelo save_order', [of.id]);
await as('anon');
await expectError(`select count(*) from public.order_installments`, /permission denied/, 'anon não lê parcelas');
await as('authenticated', eder);

console.log('12. views de relatório');
r = await one(`select count(*)::int n from public.order_items_view`);
ok(r.n > 0, `order_items_view lê as tabelas novas (${r.n})`);

await as(null);
console.log(`\n${passes} ok, ${fails} falha(s)`);
process.exit(fails ? 1 : 0);
