// Backup + restauração de verdade: gera o backup com os MESMOS parâmetros do
// .github/workflows/backup.yml (DATA_ARGS / LOGIN_ARGS), restaura num banco
// novo (schema.sql + 2_login.sql + 1_dados.sql) e compara tabela a tabela.
// Um backup que sai "verde" mas não restaura não serve para nada.
//
// Rodar:  cd tests  &&  npm run test:db
import { PGlite } from '@electric-sql/pglite';
import { pgDump } from '@electric-sql/pglite-tools/pg_dump';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => fs.readFileSync(ROOT + p, 'utf8');
const schema = read('supabase/schema.sql').replace(/create extension if not exists pgcrypto;/, '');
const seed = read('supabase/seed_catalogo.sql');
const prelude = read('supabase/backup_prelude.sql');
const workflow = read('.github/workflows/backup.yml');

let fails = 0, passes = 0;
const ok = (cond, msg) => { if (cond) { passes++; console.log('  ✓', msg); } else { fails++; console.log('  ✗', msg); } };
process.on('unhandledRejection', (e) => { console.error('ERRO:', e?.message || e); process.exit(1); });

const argsOf = (name) => {
  const m = new RegExp(`^\\s*${name}:\\s*(.+)$`, 'm').exec(workflow);
  return m ? m[1].trim().split(/\s+/) : [];
};
const DATA_ARGS = argsOf('DATA_ARGS');
const LOGIN_ARGS = argsOf('LOGIN_ARGS');

/** Banco "Supabase" vazio: papéis, auth.users/identities e auth.uid(). */
async function supabaseLike() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, encrypted_password text,
      email_confirmed_at timestamptz, confirmed_at timestamptz generated always as (email_confirmed_at) stored);
    create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id),
      provider text not null, identity_data jsonb, email text generated always as (lower(identity_data ->> 'email')) stored);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
  `);
  return db;
}

async function as(db, role, uid) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
  if (role) await db.exec(`set role ${role}`);
}

const TABLES = ['store_settings', 'store_members', 'categories', 'suppliers', 'customers', 'products', 'product_variants', 'units',
  'stock_movements', 'orders', 'order_items', 'payments', 'order_installments', 'purchases', 'purchase_items', 'client_errors',
  'catalog_requests'];

async function fingerprint(db) {
  await db.exec('reset role');
  const out = {};
  for (const t of TABLES) out[t] = (await db.query(`select count(*)::int n from public.${t}`)).rows[0].n;
  const x = (await db.query(`select
      (select sum(stock)::int from public.product_variants) stock,
      (select round(sum(cost), 4)::text from public.product_variants) cost,
      (select count(*)::int from public.units where status = 'estoque') units_in,
      (select sum(total)::text from public.orders) total,
      (select sum(balance)::text from public.orders) balance,
      (select sum(paid_amount)::text from public.orders) paid,
      (select string_agg(status, ',' order by code) from public.orders) statuses,
      (select sum(amount)::text from public.order_installments) plan,
      (select store_name from public.store_settings) store,
      (select max(code)::int from public.orders) last_order`)).rows[0];
  return { ...out, ...x };
}

console.log('1. o workflow faz o backup do jeito certo');
ok(DATA_ARGS.includes('--schema=public') && DATA_ARGS.includes('--data-only'), `dados: ${DATA_ARGS.join(' ')}`);
ok(!DATA_ARGS.some((a) => a.startsWith('--table')), 'os dados não misturam --table com --schema');
ok(LOGIN_ARGS.includes('--table=auth.users') && !LOGIN_ARGS.some((a) => a.startsWith('--schema')), 'o login vai num pg_dump separado');
ok(/cat supabase\/backup_prelude\.sql/.test(workflow) && /echo 'reset all;'/.test(workflow), 'o arquivo de dados começa pelo cabeçalho de restauração');
ok(/--symmetric --cipher-algo AES256/.test(workflow) && !/upload-artifact[\s\S]*\.tar\.gz\s*$/m.test(workflow), 'o backup sobe só criptografado (repositório público)');
ok(/for t in store_settings store_members categories products product_variants/.test(workflow), 'confere as tabelas essenciais antes de guardar');

console.log('2. loja com movimento de verdade');
const src = await supabaseLike();
const eder = (await src.query(`insert into auth.users (email, encrypted_password, email_confirmed_at) values ('eder.pontes2014@gmail.com', 'hash', now()) returning id`)).rows[0].id;
await src.query(`insert into auth.identities (user_id, provider, identity_data) values ($1, 'email', $2)`, [eder, JSON.stringify({ email: 'eder.pontes2014@gmail.com' })]);
await src.exec(schema);
await src.exec(seed);
await as(src, 'authenticated', eder);
const q1 = async (sql, p) => (await src.query(sql, p)).rows[0];
const iph = (await q1(`select id from public.products where slug = 'iphone-15'`)).id;
const v = (await q1(`insert into public.product_variants (product_id, storage, color, condition, price) values ($1, '128GB', 'Preto', 'Lacrado', 4699) returning id`, [iph])).id;
await src.query(`update public.store_settings set store_name = 'i7even (backup)', catalog_enabled = true`);
await src.query(`select public.post_purchase($1::jsonb)`, [JSON.stringify({ supplier_name: 'Fornecedor', items: [{ variant_id: v, unit_cost: 3800,
  units: [{ serial: '350000000000901' }, { serial: '350000000000902' }, { serial: '350000000000903' }] }] })]);
const units = (await src.query(`select id from public.units where variant_id = $1 order by serial`, [v])).rows;
// fiado: entrada + 2 parcelas, cliente levou
await src.query(`select public.save_order($1::jsonb)`, [JSON.stringify({ status: 'entregue', customer_name: 'Bia Fiado', customer_phone: '44933332222',
  items: [{ variant_id: v, product_name: 'iPhone 15', qty: 1, unit_price: 4699, unit_ids: [units[0].id] }],
  payments: [{ amount: 1699, method: 'PIX' }],
  plan: [{ number: 0, due_date: '2026-10-01', amount: 1699 }, { number: 1, due_date: '2026-11-01', amount: 1500 }, { number: 2, due_date: '2026-12-01', amount: 1500 }] })]);
// à vista, cancelado com estorno
const paid = (await src.query(`select * from public.save_order($1::jsonb)`, [JSON.stringify({ status: 'pago', customer_name: 'Rui',
  items: [{ variant_id: v, product_name: 'iPhone 15', qty: 1, unit_price: 4699, unit_ids: [units[1].id] }],
  payments: [{ amount: 4699, method: 'PIX' }] })])).rows[0];
await src.query(`select public.cancel_order($1, true)`, [paid.id]);
await src.query(`insert into public.client_errors (message) values ('teste')`);
await as(src, 'anon');
await src.query(`select public.catalog_request($1::jsonb)`, [JSON.stringify({ customer_name: 'Cliente', items: [{ variant_id: v, qty: 1 }] })]);
const before = await fingerprint(src);
ok(before.orders === 2 && before.payments === 3 && before.order_installments === 3 && before.catalog_requests === 1,
  `pedidos ${before.orders}, pagamentos ${before.payments} (com estorno), 3 parcelas, pedido do catálogo`);
ok(before.statuses === 'aguardando,cancelado' && before.units_in === 2, `fiado aguardando pagamento; 2 aparelhos no estoque (${before.statuses})`);

console.log('3. gera o backup (mesmos parâmetros do workflow)');
const dataSql = prelude + await (await pgDump({ pg: src, args: DATA_ARGS })).text() + '\nreset all;\n';
await src.exec('reset role; set search_path to public');
const loginSql = 'set session_replication_role = replica;\n' + await (await pgDump({ pg: src, args: LOGIN_ARGS })).text() + '\nreset all;\n';
for (const t of ['store_settings', 'store_members', 'categories', 'products', 'product_variants', 'units', 'orders', 'payments', 'order_installments']) {
  ok(dataSql.includes(`INSERT INTO public.${t} `), `1_dados.sql tem ${t}`);
}
ok(loginSql.includes('INSERT INTO auth.users ') && loginSql.includes('INSERT INTO auth.identities ') && !loginSql.includes('INSERT INTO public.'), '2_login.sql tem só o login');
ok(!/INSERT INTO public\.orders \([^)]*\bbalance\b/.test(dataSql), 'coluna calculada (saldo) fica fora: o banco recalcula');

console.log('4. restaura num banco novo (schema.sql → 2_login.sql → 1_dados.sql)');
const dst = await supabaseLike();
await dst.exec(schema);
await dst.exec(loginSql);
await dst.exec(dataSql);
const after = await fingerprint(dst);
const diff = Object.keys(before).filter((k) => String(before[k]) !== String(after[k]));
ok(diff.length === 0, diff.length ? `diferenças: ${diff.map((k) => `${k} ${before[k]} → ${after[k]}`).join(', ')}` : 'todas as tabelas, estoque, IMEIs, totais, recebidos e parcelas iguais');
ok(after.stock_movements === before.stock_movements, `gatilhos desligados na carga: nenhum movimento a mais (${after.stock_movements})`);

console.log('5. o sistema funciona no banco restaurado');
await as(dst, 'authenticated', eder);
const who = (await dst.query('select public.whoami() w')).rows[0].w;
ok(who.member === true, 'o mesmo login continua sendo da loja');
const next = (await dst.query(`select * from public.save_order($1::jsonb)`, [JSON.stringify({ customer_name: 'Depois', items: [{ variant_id: v, product_name: 'iPhone 15', qty: 1, unit_price: 4699, unit_ids: [units[2].id] }] })])).rows[0];
ok(Number(next.code) === before.last_order + 1, `numeração continua de onde parou (#${next.code})`);
const sold = (await dst.query(`select status from public.units where id = $1`, [units[2].id])).rows[0].status;
ok(sold === 'vendido', 'gatilhos voltam ao normal depois da carga (venda nova baixa o aparelho)');
const bia = (await dst.query(`select id from public.orders where customer_name = 'Bia Fiado'`)).rows[0].id;
await dst.query(`insert into public.payments (order_id, amount, method) values ($1, 3000, 'PIX')`, [bia]);
const st = (await dst.query(`select status from public.orders where id = $1`, [bia])).rows[0].status;
ok(st === 'entregue', 'fiado restaurado: quitou e finalizou sozinho');

console.log('6. rodar de novo por cima (voltar no tempo) substitui, não duplica');
await dst.exec('reset role');
await dst.exec(dataSql);
const again = await fingerprint(dst);
ok(again.orders === before.orders && again.units === before.units && again.statuses === before.statuses,
  `${again.orders} pedidos e ${again.units} aparelhos (o que foi feito depois some)`);

console.log(`\n${passes} ok, ${fails} falha(s)`);
process.exit(fails ? 1 : 0);
