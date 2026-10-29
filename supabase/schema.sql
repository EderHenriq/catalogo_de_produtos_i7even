-- =====================================================================
--  i7even Store - esquema do banco (Supabase / PostgreSQL)
--
--  Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.
--  Pode rodar de novo sem medo: tudo é idempotente e NADA é apagado.
--  Depois rode o supabase/seed_catalogo.sql (categorias e modelos Apple).
--
--  Regras do projeto (contextos/03):
--    - nada é criado pelo painel: tabela, função, política e permissão só
--      existem se estiverem aqui (é o que permite recriar o banco do zero);
--    - a loja já tem pedidos reais: mudança aqui SÓ ACRESCENTA. Nunca
--      `drop table`, nunca apagar dado. Os pedidos da v1 (itens e pagamentos
--      dentro do próprio pedido, em JSON) são copiados para as tabelas novas
--      por _migrate_legacy_orders() - o JSON original fica guardado;
--    - estoque, vendas e entradas só mudam por FUNÇÃO (RPC) - atômicas, com
--      trava de linha em ordem de id. O navegador nunca grava saldo direto;
--    - dois donos (Eder e Julie) e UMA base: quem está em store_members vê
--      tudo; qualquer outro login, mesmo criado por engano, não vê nada.
--
--  Versão do banco: 2 (whoami().schema_version). Subiu? Suba junto o
--  APP.schemaVersion em assets/js/config.js.
-- =====================================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------ utilitário --

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- =====================================================================
--  ACESSO: quem pode usar o sistema (v1, mantido)
-- =====================================================================

create table if not exists public.store_members (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  nome       text,
  criado_em  timestamptz not null default now()
);

/*
 * SECURITY DEFINER: se a política de store_members consultasse a própria
 * tabela, o Postgres entraria em recursão; a função roda com os direitos do
 * dono e corta o ciclo. Toda política do banco passa por aqui.
 */
create or replace function public.eh_membro()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.store_members where user_id = auth.uid());
$$;

revoke all on function public.eh_membro() from public, anon;
grant execute on function public.eh_membro() to authenticated;

/* Primeira linha de toda função que grava: recusa quem não é da loja. */
create or replace function public.require_member()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.eh_membro() then
    raise exception 'Acesso negado: este login não está autorizado na loja.' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.require_member() from public, anon;
grant execute on function public.require_member() to authenticated;

alter table public.store_members enable row level security;

drop policy if exists "membros_leem_membros" on public.store_members;
create policy "membros_leem_membros" on public.store_members
  for select to authenticated
  using (public.eh_membro());

revoke all on public.store_members from anon;
revoke insert, update, delete on public.store_members from authenticated;
grant select on public.store_members to authenticated;

/* A tela pergunta "quem sou eu" logo após o login. */
create or replace function public.whoami()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'email', (select email from auth.users where id = auth.uid()),
    'member', public.eh_membro(),
    'name', (select nome from public.store_members where user_id = auth.uid()),
    -- O app confere: banco mais antigo que o app = tela "rode o schema.sql".
    'schema_version', 2
  );
$$;

revoke all on function public.whoami() from public, anon;
grant execute on function public.whoami() to authenticated;

/*
 * Sinal de vida para o GitHub Actions (.github/workflows/backup.yml): o plano
 * grátis do Supabase pausa o projeto após ~7 dias sem acesso. Não lê nem
 * devolve dado nenhum - só a hora do servidor.
 */
create or replace function public.keepalive()
returns timestamptz
language sql
stable
set search_path = public
as $$
  select now();
$$;

grant execute on function public.keepalive() to anon, authenticated;

-- =====================================================================
--  CONFIGURAÇÕES DA LOJA (linha única)
-- =====================================================================

create table if not exists public.store_settings (
  id                    int primary key default 1 check (id = 1),
  store_name            text not null default 'i7even Store' check (length(btrim(store_name)) between 1 and 80),
  phone                 text check (phone is null or length(phone) <= 30),
  instagram             text check (instagram is null or length(instagram) <= 60),
  email                 text check (email is null or length(email) <= 120),
  address               text check (address is null or length(address) <= 240),
  pix_key               text check (pix_key is null or length(pix_key) <= 120),
  footer_text           text check (footer_text is null or length(footer_text) <= 240),
  -- Margem padrão para SUGERIR o preço de venda numa entrada (20% = custo + 20%).
  default_markup_pct    numeric(7,2) not null default 20 check (default_markup_pct between 0 and 1000),
  -- Desligado: a venda é recusada se faltar estoque (produtos por quantidade).
  allow_negative_stock  boolean not null default false,
  -- Garantia padrão (dias) por condição: {"Lacrado": 365, "Seminovo": 90, ...}
  warranty_days         jsonb not null default '{"Lacrado": 365, "Novo (caixa aberta)": 180, "Vitrine": 180, "Seminovo": 90, "CPO / Recondicionado": 180}'::jsonb,
  catalog_enabled       boolean not null default false,
  catalog_show_out_of_stock boolean not null default true,
  catalog_message       text check (catalog_message is null or length(catalog_message) <= 300),
  updated_at            timestamptz not null default now()
);

alter table public.store_settings drop constraint if exists store_settings_warranty_check;
alter table public.store_settings add constraint store_settings_warranty_check
  check (jsonb_typeof(warranty_days) = 'object' and pg_column_size(warranty_days) <= 2000);

insert into public.store_settings (id) values (1) on conflict (id) do nothing;

drop trigger if exists store_settings_touch_trg on public.store_settings;
create trigger store_settings_touch_trg
  before update on public.store_settings
  for each row execute function public.touch_updated_at();

-- =====================================================================
--  CATEGORIAS, FORNECEDORES, CLIENTES
-- =====================================================================

/*
 * `slug` liga a categoria ao catálogo antigo (data/catalog.js: 'iphone',
 * 'watch'...) - é por ele que o seed não duplica e que os pedidos da v1
 * encontram a categoria certa. Os rótulos dizem como cada categoria chama
 * as variações: "Armazenamento" no iPhone, "Caixa" no Watch, "Tamanho" no
 * perfume. `tracks_serial` é o padrão dos produtos novos daquela categoria.
 */
create table if not exists public.categories (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique check (slug is null or slug ~ '^[a-z0-9-]{1,40}$'),
  name          text not null check (length(btrim(name)) between 1 and 60),
  emoji         text check (emoji is null or length(emoji) <= 8),
  image         text check (image is null or length(image) <= 500),
  description   text check (description is null or length(description) <= 240),
  variant_label text not null default 'Variação' check (length(variant_label) between 1 and 30),
  color_label   text not null default 'Cor' check (length(color_label) between 1 and 30),
  size_label    text not null default 'Tamanho' check (length(size_label) between 1 and 30),
  tracks_serial boolean not null default false,
  sort          int not null default 100,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create unique index if not exists categories_name_uk on public.categories (lower(btrim(name)));

-- Opções extras escolhidas na hora da venda (ex.: pulseira do Apple Watch).
alter table public.categories add column if not exists bands text[] not null default '{}';

/* Ordem das categorias (catálogo, seletor do pedido): a lista inteira de uma vez. */
create or replace function public.reorder_categories(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_member();
  update public.categories c
     set sort = x.pos * 10
    from unnest(p_ids) with ordinality as x(id, pos)
   where c.id = x.id;
end;
$$;

revoke all on function public.reorder_categories(uuid[]) from public, anon;
grant execute on function public.reorder_categories(uuid[]) to authenticated;

create table if not exists public.suppliers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(btrim(name)) between 1 and 120),
  contact_name text check (contact_name is null or length(contact_name) <= 80),
  phone        text check (phone is null or length(phone) <= 30),
  city         text check (city is null or length(city) <= 80),
  notes        text check (notes is null or length(notes) <= 1000),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

drop trigger if exists suppliers_touch_trg on public.suppliers;
create trigger suppliers_touch_trg before update on public.suppliers
  for each row execute function public.touch_updated_at();

/*
 * Cliente. Na v1 o cliente existia só dentro do pedido; aqui ele ganha
 * cadastro próprio (histórico, quanto deve, aniversário). O pedido continua
 * guardando nome/telefone/endereço do momento da venda.
 */
create table if not exists public.customers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 120),
  phone       text check (phone is null or length(phone) <= 30),
  email       text check (email is null or length(email) <= 160),
  doc         text check (doc is null or length(doc) <= 30),
  instagram   text check (instagram is null or length(instagram) <= 60),
  cep         text check (cep is null or length(cep) <= 12),
  street      text check (street is null or length(street) <= 160),
  number      text check (number is null or length(number) <= 20),
  complement  text check (complement is null or length(complement) <= 80),
  district    text check (district is null or length(district) <= 80),
  city        text check (city is null or length(city) <= 80),
  uf          text check (uf is null or length(uf) = 2),
  birthday    date,
  notes       text check (notes is null or length(notes) <= 1000),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists customers_phone_idx on public.customers ((regexp_replace(coalesce(phone, ''), '\D', '', 'g')));
create index if not exists customers_name_idx on public.customers (lower(btrim(name)));

drop trigger if exists customers_touch_trg on public.customers;
create trigger customers_touch_trg before update on public.customers
  for each row execute function public.touch_updated_at();

-- =====================================================================
--  PRODUTOS: MODELO → VARIAÇÕES → UNIDADES
-- =====================================================================
--
--  products          o MODELO ("iPhone 15 Pro"): foto, descrição, as opções
--                    que ele tem (capacidades, cores, tamanhos) e se cada
--                    unidade tem IMEI/série (tracks_serial).
--  product_variants  o que se VENDE ("256GB · Titânio natural · Lacrado"):
--                    preço, custo médio, saldo e mínimo próprios.
--  units             (só modelos com tracks_serial) cada APARELHO com o seu
--                    IMEI, custo, origem e saúde da bateria. O saldo da
--                    variação é a contagem das unidades em estoque.

create table if not exists public.products (
  id            uuid primary key default gen_random_uuid(),
  code          int generated by default as identity unique,
  slug          text unique check (slug is null or slug ~ '^[a-z0-9-]{1,60}$'),
  category_id   uuid references public.categories (id) on delete set null,
  name          text not null check (length(btrim(name)) between 1 and 120),
  brand         text check (brand is null or length(brand) <= 60),
  year          smallint check (year is null or year between 1990 and 2100),
  description   text check (description is null or length(description) <= 1000),
  image_url     text check (image_url is null or length(image_url) <= 500),
  storages      text[] not null default '{}' check (cardinality(storages) <= 30),
  colors        text[] not null default '{}' check (cardinality(colors) <= 40),
  sizes         text[] not null default '{}' check (cardinality(sizes) <= 20),
  tracks_serial boolean not null default false,
  show_in_catalog boolean not null default true,
  featured      boolean not null default false,
  needs_review  boolean not null default false,
  notes         text check (notes is null or length(notes) <= 1000),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Fotos extras do modelo (a capa é image_url): viram carrossel no catálogo.
alter table public.products add column if not exists gallery text[] not null default '{}';
alter table public.products drop constraint if exists products_gallery_check;
alter table public.products add constraint products_gallery_check check (cardinality(gallery) <= 8);

create index if not exists products_category_idx on public.products (category_id);
create index if not exists products_active_idx on public.products (active);

drop trigger if exists products_touch_trg on public.products;
create trigger products_touch_trg before update on public.products
  for each row execute function public.touch_updated_at();

create table if not exists public.product_variants (
  id              uuid primary key default gen_random_uuid(),
  code            int generated by default as identity unique,
  product_id      uuid not null references public.products (id) on delete restrict,
  storage         text not null default '' check (length(storage) <= 60),
  color           text not null default '' check (length(color) <= 60),
  size            text not null default '' check (length(size) <= 30),
  condition       text not null default 'Lacrado' check (length(btrim(condition)) between 1 and 40),
  price           numeric(12,2) not null default 0 check (price >= 0),
  cost            numeric(12,4) not null default 0 check (cost >= 0),
  stock           int not null default 0,
  min_stock       int not null default 0 check (min_stock >= 0),
  barcode         text check (barcode is null or length(barcode) <= 40),
  image_url       text check (image_url is null or length(image_url) <= 500),
  show_in_catalog boolean not null default true,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists product_variants_combo_uk on public.product_variants
  (product_id, lower(btrim(storage)), lower(btrim(color)), lower(btrim(size)), lower(btrim(condition)));
create index if not exists product_variants_product_idx on public.product_variants (product_id);

-- Oferta "sob encomenda" (lista do fornecedor): preço e custo próprios,
-- prazo, fornecedor e quando a lista foi atualizada. A mesma variação pode
-- estar em pronta entrega (estoque) e também sob encomenda.
alter table public.product_variants add column if not exists on_order boolean not null default false;
alter table public.product_variants add column if not exists order_price numeric(12,2);
alter table public.product_variants add column if not exists order_cost numeric(12,4);
alter table public.product_variants add column if not exists order_lead text;
alter table public.product_variants add column if not exists order_supplier text;
alter table public.product_variants add column if not exists order_updated_at timestamptz;
alter table public.product_variants drop constraint if exists product_variants_order_check;
alter table public.product_variants add constraint product_variants_order_check check (
  (order_price is null or order_price >= 0) and (order_cost is null or order_cost >= 0)
  and (order_lead is null or length(order_lead) <= 40) and (order_supplier is null or length(order_supplier) <= 120));
create index if not exists product_variants_on_order_idx on public.product_variants (order_supplier) where on_order;

drop trigger if exists product_variants_touch_trg on public.product_variants;
create trigger product_variants_touch_trg before update on public.product_variants
  for each row execute function public.touch_updated_at();

create table if not exists public.units (
  id             uuid primary key default gen_random_uuid(),
  variant_id     uuid not null references public.product_variants (id) on delete restrict,
  serial         text check (serial is null or length(btrim(serial)) between 1 and 40),
  status         text not null default 'estoque' check (status in ('estoque', 'vendido', 'baixa')),
  cost           numeric(12,4) not null default 0 check (cost >= 0),
  origin         text check (origin is null or length(origin) <= 40),
  battery_health smallint check (battery_health is null or battery_health between 0 and 100),
  notes          text check (notes is null or length(notes) <= 500),
  purchase_id    uuid,
  order_id       uuid,
  sold_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- O mesmo IMEI não pode estar duas vezes no estoque. (Vendido e recomprado
-- depois vira uma unidade nova - a antiga fica no histórico como vendida.)
create unique index if not exists units_serial_stock_uk on public.units (upper(btrim(serial)))
  where status = 'estoque' and serial is not null;
create index if not exists units_variant_idx on public.units (variant_id, status);
create index if not exists units_order_idx on public.units (order_id);
create index if not exists units_purchase_idx on public.units (purchase_id);
create index if not exists units_serial_idx on public.units (upper(btrim(serial)));

drop trigger if exists units_touch_trg on public.units;
create trigger units_touch_trg before update on public.units
  for each row execute function public.touch_updated_at();

/* Nome curto de uma variação: "256GB · Titânio natural · Lacrado". */
create or replace function public._vlabel(p_size text, p_storage text, p_color text, p_condition text)
returns text
language sql
immutable
as $$
  select concat_ws(' · ', nullif(btrim(p_size), ''), nullif(btrim(p_storage), ''), nullif(btrim(p_color), ''), nullif(btrim(p_condition), ''));
$$;

create or replace function public.variant_label(v public.product_variants)
returns text
language sql
immutable
as $$
  select public._vlabel(v.size, v.storage, v.color, v.condition);
$$;

/*
 * Modelo com IMEI: o saldo da variação é SEMPRE a contagem das unidades em
 * estoque e o custo médio é a média do custo delas. Derivado, nunca somado
 * à mão - não tem como desencontrar.
 */
create or replace function public._variant_sync(p_variant uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.product_variants v
     set stock = s.n,
         cost  = coalesce(s.avg_cost, v.cost)
    from (
      select count(*)::int as n, round(avg(u.cost), 4) as avg_cost
        from public.units u
       where u.variant_id = p_variant and u.status = 'estoque'
    ) s,
    public.products p
   where v.id = p_variant and p.id = v.product_id and p.tracks_serial;
end;
$$;

revoke all on function public._variant_sync(uuid) from public, anon, authenticated;

/*
 * Guardas da variação:
 *   - ao cadastrar uma variação de modelo SEM IMEI já com estoque, o saldo
 *     vira movimento "inicial" (de onde veio cada unidade fica registrado);
 *   - modelo COM IMEI não aceita saldo digitado: ele vem das unidades.
 */
create or replace function public.product_variants_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_serial boolean;
begin
  select tracks_serial into v_serial from public.products where id = new.product_id;
  if tg_op = 'INSERT' then
    if v_serial then
      new.stock := 0;
    end if;
  elsif new.product_id is distinct from old.product_id then
    raise exception 'Uma variação não pode mudar de modelo. Crie a variação no modelo certo.';
  end if;
  return new;
end;
$$;

drop trigger if exists product_variants_guard_trg on public.product_variants;
create trigger product_variants_guard_trg before insert or update on public.product_variants
  for each row execute function public.product_variants_guard();

-- =====================================================================
--  MOVIMENTOS DE ESTOQUE (histórico)
-- =====================================================================
--
--  Cada linha é uma mudança de saldo. Vendas e entradas guardam a referência
--  (order_id / purchase_id): o histórico de um pedido é sempre o EFEITO ATUAL
--  dele - editar ou cancelar o pedido refaz os movimentos daquele pedido.

create table if not exists public.stock_movements (
  id          bigint generated always as identity primary key,
  variant_id  uuid not null references public.product_variants (id) on delete cascade,
  kind        text not null check (kind in ('inicial', 'entrada', 'venda', 'ajuste', 'baixa')),
  qty         int not null check (qty <> 0),
  unit_cost   numeric(12,4),
  unit_id     uuid,
  order_id    uuid,
  purchase_id uuid,
  prev_cost   numeric(12,4),
  new_cost    numeric(12,4),
  note        text check (note is null or length(note) <= 240),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

create index if not exists stock_movements_variant_idx on public.stock_movements (variant_id, created_at desc);
create index if not exists stock_movements_order_idx on public.stock_movements (order_id);
create index if not exists stock_movements_purchase_idx on public.stock_movements (purchase_id);

create or replace function public.product_variants_initial_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.stock <> 0 then
    insert into public.stock_movements (variant_id, kind, qty, unit_cost, note)
    values (new.id, 'inicial', new.stock, new.cost, 'Estoque inicial no cadastro');
  end if;
  return new;
end;
$$;

drop trigger if exists product_variants_initial_stock_trg on public.product_variants;
create trigger product_variants_initial_stock_trg after insert on public.product_variants
  for each row execute function public.product_variants_initial_stock();

/*
 * Mudar "tem IMEI" num modelo que já tem estoque ou histórico deixaria o
 * saldo sem explicação. Só antes de movimentar.
 */
create or replace function public.products_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.tracks_serial is distinct from old.tracks_serial and exists (
    select 1 from public.stock_movements m join public.product_variants v on v.id = m.variant_id
     where v.product_id = new.id
  ) then
    raise exception 'Este modelo já tem estoque ou vendas: não dá mais para trocar o controle por IMEI. Cadastre um modelo novo.';
  end if;
  return new;
end;
$$;

drop trigger if exists products_guard_trg on public.products;
create trigger products_guard_trg before update on public.products
  for each row execute function public.products_guard();

-- =====================================================================
--  PEDIDOS (tabela da v1, ampliada)
-- =====================================================================
--
--  status (o funil da loja):
--    orcamento   não mexe no estoque (pode virar pedido depois)
--    novo → aguardando → pago → preparo → enviado → entregue
--                ↑ todos estes já tiram do estoque
--    cancelado   estoque devolvido
--  Aparelho com IMEI precisa ter a unidade escolhida antes de "Em entrega"
--  (enviado) ou "Finalizado" (entregue) - até lá pode ser encomenda.
--  Fiado: "Pago" e "Finalizado" só com o valor TODO recebido. Entregou ao
--  cliente sem quitar = "Aguardando pagamento" (handed_over_at diz quando o
--  cliente levou) e as parcelas (order_installments) dizem quando ele paga.
--  Quitou: o pedido finaliza sozinho.

create table if not exists public.orders (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  code          bigint generated by default as identity,

  customer_name   text not null check (length(btrim(customer_name)) between 1 and 120),
  customer_phone  text check (customer_phone is null or length(customer_phone) <= 30),
  customer_email  text check (customer_email is null or length(customer_email) <= 160),
  customer_doc    text check (customer_doc is null or length(customer_doc) <= 30),
  channel         text check (channel is null or length(channel) <= 40),

  status        text not null default 'novo',
  priority      boolean not null default false,
  -- v1: itens e pagamentos ficavam aqui, em JSON. Desde a v2 moram em
  -- order_items / payments; estas colunas ficam como cópia histórica.
  items         jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  notes         text check (notes is null or length(notes) <= 4000),
  order_date    date not null default current_date,
  due_date      date,
  delivered_at  timestamptz,

  payment_method  text check (payment_method is null or length(payment_method) <= 40),
  payment_status  text not null default 'pendente'
                  check (payment_status in ('pendente','parcial','pago','estornado')),
  installments    smallint not null default 1 check (installments between 1 and 24),
  paid_amount     numeric(12,2) not null default 0,
  discount        numeric(12,2) not null default 0 check (discount >= 0),

  shipping_method   text check (shipping_method is null or length(shipping_method) <= 40),
  shipping_cost     numeric(12,2) not null default 0 check (shipping_cost >= 0),
  shipping_expense  numeric(12,2) not null default 0 check (shipping_expense >= 0),
  tracking_code     text check (tracking_code is null or length(tracking_code) <= 60),
  ship_cep          text check (ship_cep is null or length(ship_cep) <= 12),
  ship_street       text check (ship_street is null or length(ship_street) <= 160),
  ship_number       text check (ship_number is null or length(ship_number) <= 20),
  ship_complement   text check (ship_complement is null or length(ship_complement) <= 80),
  ship_district     text check (ship_district is null or length(ship_district) <= 80),
  ship_city         text check (ship_city is null or length(ship_city) <= 80),
  ship_uf           text check (ship_uf is null or length(ship_uf) = 2),

  subtotal    numeric(12,2) not null default 0,
  cost_total  numeric(12,2) not null default 0,
  total       numeric(12,2) not null default 0,
  profit      numeric(12,2) not null default 0,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.orders add column if not exists created_by_email text;
alter table public.orders add column if not exists payments jsonb not null default '[]'::jsonb;

-- v2
alter table public.orders add column if not exists customer_id uuid references public.customers (id) on delete set null;
alter table public.orders add column if not exists client_ref uuid;
alter table public.orders add column if not exists stock_applied boolean not null default false;
-- Pedidos da v1 nascem "não migrados"; tudo que for criado daqui em diante já nasce no modelo novo.
alter table public.orders add column if not exists legacy_migrated boolean not null default false;
alter table public.orders alter column legacy_migrated set default true;
create unique index if not exists orders_client_ref_uk on public.orders (client_ref);
create index if not exists orders_customer_id_idx on public.orders (customer_id);

-- v2: "orçamento" entra no funil (não mexe no estoque).
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('orcamento','novo','aguardando','pago','preparo','enviado','entregue','cancelado'));

-- v1 exigia recebido ≥ 0; o estorno (dinheiro devolvido) pode deixar o saldo negativo por um instante.
alter table public.orders drop constraint if exists orders_paid_amount_check;

alter table public.orders drop constraint if exists orders_payments_size;
alter table public.orders add constraint orders_payments_size
  check (jsonb_typeof(payments) = 'array' and jsonb_array_length(payments) <= 60 and pg_column_size(payments) <= 16384);

alter table public.orders drop constraint if exists orders_items_size;
alter table public.orders add constraint orders_items_size
  check (jsonb_array_length(items) <= 100 and pg_column_size(items) <= 65536);

/*
 * Saldo a receber calculado pelo próprio banco. Com ele o sistema carrega
 * os últimos 12 meses + tudo que ainda está em aberto, em vez da história inteira.
 */
alter table public.orders add column if not exists balance numeric(12,2)
  generated always as (
    case when status in ('orcamento', 'cancelado') then 0 else greatest(total - paid_amount, 0) end
  ) stored;

create index if not exists orders_user_created_idx on public.orders (user_id, created_at desc);
create index if not exists orders_user_status_idx  on public.orders (user_id, status);
create index if not exists orders_user_date_idx    on public.orders (user_id, order_date desc);
create index if not exists orders_customer_idx     on public.orders using gin (to_tsvector('simple', customer_name));
create index if not exists orders_open_idx on public.orders (order_date) where balance > 0;

/*
 * Item do pedido. Snapshot do que foi vendido (nome, capacidade, cor...) -
 * mudar o cadastro depois não reescreve o passado. Três formas:
 *   - variação do catálogo (variant_id)        → mexe no estoque;
 *   - aparelho com IMEI: unit_ids diz QUAIS     → as unidades viram "vendido";
 *   - item avulso (sem variant_id)             → só registra.
 * unit_cost é o custo no momento da venda (o lucro histórico não muda
 * quando o custo médio muda depois).
 */
create table if not exists public.order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders (id) on delete cascade,
  position        int not null default 0,
  product_id      uuid references public.products (id) on delete set null,
  variant_id      uuid references public.product_variants (id) on delete set null,
  category_id     uuid references public.categories (id) on delete set null,
  product_name    text not null check (length(btrim(product_name)) between 1 and 120),
  storage         text check (storage is null or length(storage) <= 60),
  color           text check (color is null or length(color) <= 60),
  size            text check (size is null or length(size) <= 30),
  band            text check (band is null or length(band) <= 60),
  condition       text check (condition is null or length(condition) <= 40),
  origin          text check (origin is null or length(origin) <= 40),
  qty             int not null default 1 check (qty between 1 and 999),
  unit_price      numeric(12,2) not null default 0 check (unit_price >= 0),
  unit_cost       numeric(12,4) not null default 0 check (unit_cost >= 0),
  unit_ids        uuid[] not null default '{}',
  serial          text check (serial is null or length(serial) <= 400),
  warranty_days   int not null default 0 check (warranty_days between 0 and 3650),
  note            text check (note is null or length(note) <= 240),
  -- itens vindos da v1: os ids do catálogo antigo (texto)
  legacy_product  text check (legacy_product is null or length(legacy_product) <= 60),
  legacy_category text check (legacy_category is null or length(legacy_category) <= 40)
);

create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists order_items_variant_idx on public.order_items (variant_id);
create index if not exists order_items_product_idx on public.order_items (product_id);

/*
 * Pagamentos (sinal, parcelas, complemento). O id nasce no aparelho: tocar
 * "Salvar" de novo depois de um erro de rede não lança duas vezes.
 * Valor negativo = estorno (pedido pago e cancelado, dinheiro devolvido).
 */
create table if not exists public.payments (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders (id) on delete cascade,
  paid_at    date not null default current_date,
  amount     numeric(12,2) not null check (amount <> 0),
  method     text check (method is null or length(method) <= 40),
  note       text check (note is null or length(note) <= 160),
  created_at timestamptz not null default now()
);

create index if not exists payments_order_idx on public.payments (order_id);
create index if not exists payments_date_idx on public.payments (paid_at desc);

/*
 * Fiado / crediário: o combinado de QUANDO o cliente paga. Cada parcela tem
 * vencimento e valor; a soma é o total do pedido (a entrada é a parcela 0).
 * Se está paga ou atrasada não fica gravado aqui: sai dos pagamentos
 * lançados, abatendo as parcelas na ordem do vencimento - registrar um
 * pagamento nunca deixa uma parcela "esquecida" como aberta.
 */
create table if not exists public.order_installments (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id) on delete cascade,
  number      int not null default 1 check (number between 0 and 99),
  due_date    date not null,
  amount      numeric(12,2) not null check (amount > 0),
  note        text check (note is null or length(note) <= 160),
  reminded_at timestamptz,          -- última cobrança mandada no WhatsApp
  created_at  timestamptz not null default now()
);

create index if not exists order_installments_order_idx on public.order_installments (order_id);
create index if not exists order_installments_due_idx on public.order_installments (due_date);

-- Quando o cliente levou o produto (pode ser antes de quitar: fiado).
alter table public.orders add column if not exists handed_over_at timestamptz;

/*
 * Totais do pedido, recalculados pelo banco a cada gravação. O navegador
 * nunca dita o total: ele vem dos itens e pagamentos gravados.
 *   pedido migrado (v2): itens e pagamentos das tabelas próprias;
 *   pedido da v1 ainda não migrado: do JSON, como era (só durante a migração).
 */
create or replace function public.orders_compute_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  it    jsonb;
  qty   numeric;
  sub   numeric := 0;
  cost  numeric := 0;
  pago  numeric := 0;
  v_neg boolean := false;
  v_open boolean;
begin
  if coalesce(new.legacy_migrated, true) then
    select coalesce(sum(oi.qty * oi.unit_price), 0), coalesce(sum(oi.qty * oi.unit_cost), 0)
      into sub, cost
      from public.order_items oi where oi.order_id = new.id;
    select coalesce(sum(p.amount), 0), coalesce(bool_or(p.amount < 0), false)
      into pago, v_neg
      from public.payments p where p.order_id = new.id;
  else
    for it in select value from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) loop
      qty  := greatest(coalesce((it->>'qty')::numeric, 1), 0);
      sub  := sub  + coalesce((it->>'unitPrice')::numeric, 0) * qty;
      cost := cost + coalesce((it->>'unitCost')::numeric, 0) * qty;
    end loop;
    for it in select value from jsonb_array_elements(coalesce(new.payments, '[]'::jsonb)) loop
      pago := pago + coalesce((it->>'amount')::numeric, 0);
    end loop;
  end if;

  new.subtotal   := round(sub, 2);
  new.cost_total := round(cost, 2);
  new.total      := round(sub - coalesce(new.discount, 0) + coalesce(new.shipping_cost, 0), 2);
  new.profit     := round(sub - coalesce(new.discount, 0) - cost - coalesce(new.shipping_expense, 0), 2);
  new.paid_amount := round(pago, 2);

  if new.total > 0 and new.paid_amount >= new.total then
    new.payment_status := 'pago';
  elsif new.paid_amount > 0 then
    new.payment_status := 'parcial';
  elsif v_neg then
    new.payment_status := 'estornado';
  else
    new.payment_status := 'pendente';
  end if;

  new.updated_at := now();
  new.user_id    := coalesce(new.user_id, auth.uid());

  -- Fiado: "Pago" e "Finalizado" só com tudo recebido. Entregue sem quitar
  -- vira "Aguardando pagamento" (guardando quando o cliente levou); quitou,
  -- avança sozinho. A migração da v1 não reescreve a história (flag).
  if coalesce(current_setting('i7even.migrating', true), '') <> 'on' then
    v_open := new.total > 0 and new.paid_amount < new.total - 0.005;
    if new.status in ('pago', 'entregue') and v_open then
      if new.status = 'entregue' then
        new.handed_over_at := coalesce(new.handed_over_at, now());
      end if;
      new.status := 'aguardando';
    elsif new.status = 'aguardando' and new.total > 0 and not v_open then
      new.status := case when new.handed_over_at is not null then 'entregue' else 'pago' end;
    end if;
    if new.status = 'entregue' then
      new.handed_over_at := coalesce(new.handed_over_at, now());
    elsif new.status <> 'aguardando' then
      new.handed_over_at := null;
    end if;
  end if;

  if new.status = 'entregue' and new.delivered_at is null then
    new.delivered_at := now();
  elsif new.status <> 'entregue' then
    new.delivered_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists orders_compute_totals_trg on public.orders;
create trigger orders_compute_totals_trg
  before insert or update on public.orders
  for each row execute function public.orders_compute_totals();

create or replace function public.orders_lock_owner()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'user_id é imutável';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_lock_owner_trg on public.orders;
create trigger orders_lock_owner_trg
  before update on public.orders
  for each row execute function public.orders_lock_owner();

/* Mexeu num pagamento: o pedido recalcula o recebido (o gatilho acima). */
create or replace function public.payments_sync_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.orders set updated_at = now() where id = coalesce(new.order_id, old.order_id);
  if tg_op = 'UPDATE' and new.order_id is distinct from old.order_id then
    update public.orders set updated_at = now() where id = old.order_id;
  end if;
  return null;
end;
$$;

drop trigger if exists payments_sync_trg on public.payments;
create trigger payments_sync_trg after insert or update or delete on public.payments
  for each row execute function public.payments_sync_order();

-- =====================================================================
--  ENTRADAS DE MERCADORIA (compra do fornecedor / importação)
-- =====================================================================

create table if not exists public.purchases (
  id            uuid primary key default gen_random_uuid(),
  number        int generated by default as identity unique,
  supplier_id   uuid references public.suppliers (id) on delete set null,
  supplier_name text check (supplier_name is null or length(supplier_name) <= 120),
  purchase_date date not null default current_date,
  invoice_ref   text check (invoice_ref is null or length(invoice_ref) <= 60),
  -- Custo digitado em outra moeda (US$ no Paraguai/EUA): × câmbio = R$.
  currency      text not null default 'BRL' check (currency in ('BRL', 'USD')),
  exchange_rate numeric(10,4) not null default 1 check (exchange_rate > 0),
  freight       numeric(12,2) not null default 0 check (freight >= 0),
  other_costs   numeric(12,2) not null default 0 check (other_costs >= 0),
  items_total   numeric(12,2) not null default 0,
  total         numeric(12,2) not null default 0,
  status        text not null default 'lancada' check (status in ('lancada', 'cancelada')),
  notes         text check (notes is null or length(notes) <= 1000),
  created_at    timestamptz not null default now()
);

create index if not exists purchases_date_idx on public.purchases (purchase_date desc);

/*
 * Item da entrada.
 *   unit_cost_input  custo digitado (na moeda da nota)
 *   unit_cost        custo REAL em R$: input × câmbio + parte do frete/taxas
 *                    (rateio proporcional ao valor da linha)
 *   serials          IMEIs das unidades (modelo com IMEI: um por aparelho)
 */
create table if not exists public.purchase_items (
  id              uuid primary key default gen_random_uuid(),
  purchase_id     uuid not null references public.purchases (id) on delete cascade,
  position        int not null default 0,
  variant_id      uuid references public.product_variants (id) on delete set null,
  description     text not null check (length(btrim(description)) between 1 and 200),
  qty             int not null check (qty between 1 and 9999),
  unit_cost_input numeric(12,2) not null default 0 check (unit_cost_input >= 0),
  unit_cost       numeric(12,4) not null default 0,
  sale_price      numeric(12,2) check (sale_price is null or sale_price >= 0),
  serials         text[] not null default '{}'
);

create index if not exists purchase_items_purchase_idx on public.purchase_items (purchase_id);
create index if not exists purchase_items_variant_idx on public.purchase_items (variant_id);

-- =====================================================================
--  REGRAS DE ESTOQUE DO PEDIDO (internas - não chamadas pelo navegador)
-- =====================================================================

/* Devolve ao estoque tudo o que o pedido tinha tirado e apaga esses movimentos. */
create or replace function public._order_revert_stock(p_order uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  -- produtos por quantidade: devolve o que os movimentos tiraram
  for r in
    select m.variant_id, sum(m.qty)::int as qty
      from public.stock_movements m
      join public.product_variants v on v.id = m.variant_id
      join public.products p on p.id = v.product_id and not p.tracks_serial
     where m.order_id = p_order and m.kind = 'venda'
     group by m.variant_id
     order by m.variant_id
  loop
    update public.product_variants set stock = stock - r.qty where id = r.variant_id;
  end loop;

  -- aparelhos com IMEI: voltam para o estoque
  for r in
    select distinct variant_id from public.units where order_id = p_order and status = 'vendido' order by variant_id
  loop
    update public.units set status = 'estoque', order_id = null, sold_at = null
     where order_id = p_order and status = 'vendido' and variant_id = r.variant_id;
    perform public._variant_sync(r.variant_id);
  end loop;

  delete from public.stock_movements where order_id = p_order and kind = 'venda';
  update public.orders set stock_applied = false where id = p_order and stock_applied;
end;
$$;

revoke all on function public._order_revert_stock(uuid) from public, anon, authenticated;

/*
 * Tira do estoque o que o pedido vende (trava as linhas em ordem de id e
 * confere o saldo). Aparelho com IMEI: as unidades escolhidas viram
 * "vendido"; sem unidade escolhida ainda é encomenda (não tira nada).
 */
create or replace function public._order_apply_stock(p_order uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r         record;
  u         record;
  v_allow   boolean;
  v_code    bigint;
  v_missing text := '';
begin
  select allow_negative_stock into v_allow from public.store_settings where id = 1;
  select code into v_code from public.orders where id = p_order;

  perform 1 from public.product_variants
   where id in (select variant_id from public.order_items where order_id = p_order and variant_id is not null)
   order by id for update;
  perform 1 from public.units
   where id in (select unnest(unit_ids) from public.order_items where order_id = p_order)
   order by id for update;

  -- 1. produtos por quantidade: confere o saldo de tudo antes de mexer
  for r in
    select oi.variant_id, sum(oi.qty)::int as qty, v.stock, v.cost,
           concat_ws(' · ', p.name, nullif(public._vlabel(v.size, v.storage, v.color, v.condition), '')) as label
      from public.order_items oi
      join public.product_variants v on v.id = oi.variant_id
      join public.products p on p.id = v.product_id and not p.tracks_serial
     where oi.order_id = p_order
     group by oi.variant_id, v.stock, v.cost, p.name, v.size, v.storage, v.color, v.condition
     order by label
  loop
    if not coalesce(v_allow, false) and r.stock < r.qty then
      v_missing := v_missing || format(E'\n• %s: tem %s, precisa de %s', r.label, r.stock, r.qty);
    end if;
  end loop;

  -- 2. aparelhos: a unidade escolhida tem que estar no estoque
  for u in
    select un.id, un.serial, un.status, un.variant_id, oi.variant_id as item_variant, o2.code as sold_in
      from public.order_items oi
      cross join lateral unnest(oi.unit_ids) as x(uid)
      join public.units un on un.id = x.uid
      left join public.orders o2 on o2.id = un.order_id
     where oi.order_id = p_order
  loop
    if u.variant_id is distinct from u.item_variant then
      raise exception 'O aparelho % não é desta variação. Escolha de novo o IMEI.', coalesce(u.serial, 'sem IMEI');
    end if;
    if u.status <> 'estoque' then
      v_missing := v_missing || format(E'\n• IMEI %s: %s', coalesce(u.serial, '?'),
        case when u.status = 'vendido' then format('já vendido no pedido #%s', lpad(coalesce(u.sold_in, 0)::text, 4, '0'))
             else 'baixado do estoque' end);
    end if;
  end loop;

  if v_missing <> '' then
    raise exception 'Estoque insuficiente:%', v_missing;
  end if;

  for r in
    select oi.variant_id, sum(oi.qty)::int as qty, v.cost
      from public.order_items oi
      join public.product_variants v on v.id = oi.variant_id
      join public.products p on p.id = v.product_id and not p.tracks_serial
     where oi.order_id = p_order
     group by oi.variant_id, v.cost
  loop
    update public.product_variants set stock = stock - r.qty where id = r.variant_id;
    insert into public.stock_movements (variant_id, kind, qty, unit_cost, order_id, note)
    values (r.variant_id, 'venda', -r.qty, r.cost, p_order, format('Pedido #%s', lpad(v_code::text, 4, '0')));
  end loop;

  for u in
    select un.id, un.variant_id, un.cost
      from public.order_items oi
      cross join lateral unnest(oi.unit_ids) as x(uid)
      join public.units un on un.id = x.uid
     where oi.order_id = p_order
     order by un.id
  loop
    update public.units set status = 'vendido', order_id = p_order, sold_at = now() where id = u.id;
    insert into public.stock_movements (variant_id, kind, qty, unit_cost, unit_id, order_id, note)
    values (u.variant_id, 'venda', -1, u.cost, u.id, p_order, format('Pedido #%s', lpad(v_code::text, 4, '0')));
  end loop;

  for r in
    select distinct oi.variant_id from public.order_items oi
      join public.product_variants v on v.id = oi.variant_id
      join public.products p on p.id = v.product_id and p.tracks_serial
     where oi.order_id = p_order
  loop
    perform public._variant_sync(r.variant_id);
  end loop;

  update public.orders set stock_applied = true where id = p_order and not stock_applied;
end;
$$;

revoke all on function public._order_apply_stock(uuid) from public, anon, authenticated;

/* Status que exigem o IMEI escolhido em todo aparelho do pedido. */
create or replace function public._order_check_serials(p_order uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_list text;
begin
  if p_status not in ('enviado', 'entregue') then return; end if;
  select string_agg(format('• %s (%s de %s)', oi.product_name, cardinality(oi.unit_ids), oi.qty), E'\n' order by oi.position)
    into v_list
    from public.order_items oi
    join public.products p on p.id = oi.product_id and p.tracks_serial
   where oi.order_id = p_order and oi.variant_id is not null and cardinality(oi.unit_ids) < oi.qty;
  if v_list is not null then
    raise exception E'Escolha o IMEI dos aparelhos antes de marcar como %:\n%',
      case p_status when 'enviado' then 'Em entrega' else 'Finalizado' end, v_list;
  end if;
end;
$$;

revoke all on function public._order_check_serials(uuid, text) from public, anon, authenticated;

/*
 * Acha a variação pelos atributos (ou cria, com o preço do pedido). É o que
 * permite vender uma combinação que ainda não tinha cadastro (encomenda):
 * ela nasce sem estoque e já entra nos relatórios do jeito certo.
 */
create or replace function public._variant_find_or_create(
  p_product uuid, p_storage text, p_color text, p_size text, p_condition text, p_price numeric)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_cond text := coalesce(nullif(btrim(p_condition), ''), 'Lacrado');
begin
  select id into v_id from public.product_variants
   where product_id = p_product
     and lower(btrim(storage)) = lower(btrim(coalesce(p_storage, '')))
     and lower(btrim(color)) = lower(btrim(coalesce(p_color, '')))
     and lower(btrim(size)) = lower(btrim(coalesce(p_size, '')))
     and lower(btrim(condition)) = lower(v_cond);
  if found then return v_id; end if;

  insert into public.product_variants (product_id, storage, color, size, condition, price)
  values (p_product, btrim(coalesce(p_storage, '')), btrim(coalesce(p_color, '')), btrim(coalesce(p_size, '')), v_cond,
          greatest(coalesce(p_price, 0), 0))
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.product_variants
     where product_id = p_product
       and lower(btrim(storage)) = lower(btrim(coalesce(p_storage, '')))
       and lower(btrim(color)) = lower(btrim(coalesce(p_color, '')))
       and lower(btrim(size)) = lower(btrim(coalesce(p_size, '')))
       and lower(btrim(condition)) = lower(v_cond);
  end if;
  return v_id;
end;
$$;

revoke all on function public._variant_find_or_create(uuid, text, text, text, text, numeric) from public, anon, authenticated;

/*
 * Cliente do pedido: pelo id; senão pelo telefone (mesmos dígitos); senão
 * pelo nome exato de um cliente sem telefone; senão cria. Completa o
 * cadastro com o que estiver vazio lá e preenchido no pedido.
 */
create or replace function public._customer_resolve(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid := nullif(p ->> 'customer_id', '')::uuid;
  v_name  text := btrim(coalesce(p ->> 'customer_name', ''));
  v_phone text := regexp_replace(coalesce(p ->> 'customer_phone', ''), '\D', '', 'g');
begin
  if length(v_name) = 0 then return null; end if;

  if v_id is not null and not exists (select 1 from public.customers where id = v_id) then
    v_id := null;
  end if;
  if v_id is null and length(v_phone) >= 10 then
    select id into v_id from public.customers
     where regexp_replace(coalesce(phone, ''), '\D', '', 'g') = v_phone
     order by created_at limit 1;
  end if;
  if v_id is null then
    select id into v_id from public.customers
     where lower(btrim(name)) = lower(v_name) and coalesce(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), '') in ('', v_phone)
     order by created_at limit 1;
  end if;

  if v_id is null then
    insert into public.customers (name, phone, email, doc, cep, street, number, complement, district, city, uf)
    values (
      left(v_name, 120),
      nullif(left(btrim(coalesce(p ->> 'customer_phone', '')), 30), ''),
      nullif(left(btrim(coalesce(p ->> 'customer_email', '')), 160), ''),
      nullif(left(btrim(coalesce(p ->> 'customer_doc', '')), 30), ''),
      nullif(left(btrim(coalesce(p ->> 'ship_cep', '')), 12), ''),
      nullif(left(btrim(coalesce(p ->> 'ship_street', '')), 160), ''),
      nullif(left(btrim(coalesce(p ->> 'ship_number', '')), 20), ''),
      nullif(left(btrim(coalesce(p ->> 'ship_complement', '')), 80), ''),
      nullif(left(btrim(coalesce(p ->> 'ship_district', '')), 80), ''),
      nullif(left(btrim(coalesce(p ->> 'ship_city', '')), 80), ''),
      nullif(upper(left(btrim(coalesce(p ->> 'ship_uf', '')), 2)), '')
    )
    returning id into v_id;
  else
    update public.customers c set
      phone      = coalesce(nullif(c.phone, ''), nullif(left(btrim(coalesce(p ->> 'customer_phone', '')), 30), '')),
      email      = coalesce(nullif(c.email, ''), nullif(left(btrim(coalesce(p ->> 'customer_email', '')), 160), '')),
      doc        = coalesce(nullif(c.doc, ''), nullif(left(btrim(coalesce(p ->> 'customer_doc', '')), 30), '')),
      cep        = coalesce(nullif(c.cep, ''), nullif(left(btrim(coalesce(p ->> 'ship_cep', '')), 12), '')),
      street     = coalesce(nullif(c.street, ''), nullif(left(btrim(coalesce(p ->> 'ship_street', '')), 160), '')),
      number     = coalesce(nullif(c.number, ''), nullif(left(btrim(coalesce(p ->> 'ship_number', '')), 20), '')),
      complement = coalesce(nullif(c.complement, ''), nullif(left(btrim(coalesce(p ->> 'ship_complement', '')), 80), '')),
      district   = coalesce(nullif(c.district, ''), nullif(left(btrim(coalesce(p ->> 'ship_district', '')), 80), '')),
      city       = coalesce(nullif(c.city, ''), nullif(left(btrim(coalesce(p ->> 'ship_city', '')), 80), '')),
      uf         = coalesce(nullif(c.uf, ''), nullif(upper(left(btrim(coalesce(p ->> 'ship_uf', '')), 2)), ''))
    where c.id = v_id;
  end if;
  return v_id;
end;
$$;

revoke all on function public._customer_resolve(jsonb) from public, anon, authenticated;

-- =====================================================================
--  RPC: PEDIDOS
-- =====================================================================

/*
 * Cria ou edita um pedido inteiro numa transação só.
 *   p = { id?, client_ref?, expected_updated_at?, status, customer_id?,
 *         customer_name, customer_phone, customer_email, customer_doc, channel,
 *         priority, notes, order_date, due_date, payment_method, installments,
 *         discount, shipping_method, shipping_cost, shipping_expense,
 *         tracking_code, ship_cep … ship_uf,
 *         items: [{ variant_id? | product_id + storage/color/size/condition,
 *                   product_name, band, origin, qty, unit_price, unit_cost?,
 *                   unit_ids?: [uuid], serial?, warranty_days, note }],
 *         payments?: [{ id, paid_at, amount, method, note }] ← lista inteira }
 * Edição: devolve o estoque do jeito antigo e tira do jeito novo (com a
 * conferência de saldo de novo). `expected_updated_at` é a trava de edição
 * simultânea: se o pedido mudou em outro aparelho, recusa em vez de apagar
 * em silêncio o que a outra pessoa lançou.
 * Pedido novo com client_ref já gravado (reenvio depois de a internet cair):
 * devolve o que já existe, sem gravar nada de novo.
 */
create or replace function public.save_order(p jsonb)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id      uuid := nullif(p ->> 'id', '')::uuid;
  v_ref     uuid := nullif(p ->> 'client_ref', '')::uuid;
  v_status  text := coalesce(nullif(p ->> 'status', ''), 'novo');
  v_name    text := left(btrim(coalesce(p ->> 'customer_name', '')), 120);
  v_row     public.orders;
  v_item    jsonb;
  v_pos     int := 0;
  v_variant public.product_variants;
  v_prod    public.products;
  v_vid     uuid;
  v_pid     uuid;
  v_units   uuid[];
  v_qty     int;
  v_cost    numeric;
  v_serial  text;
  v_cust    uuid;
  v_pay     jsonb;
  v_pay_ids uuid[] := '{}';
  v_payid   uuid;
  v_email   text;
  v_inst    jsonb;
  v_inst_ids uuid[] := '{}';
  v_iid     uuid;
  v_n       int := 0;
  v_plan    numeric;
begin
  perform public.require_member();

  if v_status not in ('orcamento','novo','aguardando','pago','preparo','enviado','entregue','cancelado') then
    raise exception 'Situação inválida: %', v_status;
  end if;
  if length(v_name) = 0 then
    raise exception 'Informe o nome do cliente.';
  end if;
  if jsonb_typeof(coalesce(p -> 'items', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p -> 'items', '[]'::jsonb)) > 100 then
    raise exception 'O pedido pode ter no máximo 100 itens.';
  end if;

  if v_id is null then
    if v_ref is not null then
      select * into v_row from public.orders where client_ref = v_ref;
      if found then return v_row; end if;
    end if;
    select lower(email) into v_email from auth.users where id = auth.uid();
    insert into public.orders (customer_name, status, client_ref, created_by_email, legacy_migrated)
    values (v_name, v_status, v_ref, v_email, true)
    on conflict (client_ref) do nothing
    returning id into v_id;
    if v_id is null then
      select * into v_row from public.orders where client_ref = v_ref;
      return v_row;
    end if;
  else
    select * into v_row from public.orders where id = v_id for update;
    if not found then
      raise exception 'Este pedido foi excluído em outro aparelho.';
    end if;
    if nullif(p ->> 'expected_updated_at', '') is not null
       and v_row.updated_at is distinct from (p ->> 'expected_updated_at')::timestamptz then
      raise exception 'CONFLITO: este pedido foi alterado em outro aparelho enquanto você editava. Feche, abra o pedido de novo e refaça a alteração.';
    end if;
    if not v_row.legacy_migrated then
      raise exception 'Este pedido ainda é da versão antiga. Rode o supabase/schema.sql de novo para migrar.';
    end if;
    perform public._order_revert_stock(v_id);
    delete from public.order_items where order_id = v_id;
  end if;

  v_cust := public._customer_resolve(p);

  update public.orders set
    status           = v_status,
    customer_id      = v_cust,
    customer_name    = v_name,
    customer_phone   = nullif(left(btrim(coalesce(p ->> 'customer_phone', '')), 30), ''),
    customer_email   = nullif(left(btrim(coalesce(p ->> 'customer_email', '')), 160), ''),
    customer_doc     = nullif(left(btrim(coalesce(p ->> 'customer_doc', '')), 30), ''),
    channel          = nullif(left(btrim(coalesce(p ->> 'channel', '')), 40), ''),
    priority         = coalesce((p ->> 'priority')::boolean, false),
    notes            = nullif(left(btrim(coalesce(p ->> 'notes', '')), 4000), ''),
    order_date       = coalesce(nullif(p ->> 'order_date', '')::date, order_date),
    due_date         = nullif(p ->> 'due_date', '')::date,
    payment_method   = nullif(left(btrim(coalesce(p ->> 'payment_method', '')), 40), ''),
    installments     = least(greatest(coalesce((p ->> 'installments')::int, 1), 1), 24),
    discount         = greatest(round(coalesce((p ->> 'discount')::numeric, 0), 2), 0),
    shipping_method  = nullif(left(btrim(coalesce(p ->> 'shipping_method', '')), 40), ''),
    shipping_cost    = greatest(round(coalesce((p ->> 'shipping_cost')::numeric, 0), 2), 0),
    shipping_expense = greatest(round(coalesce((p ->> 'shipping_expense')::numeric, 0), 2), 0),
    tracking_code    = nullif(left(btrim(coalesce(p ->> 'tracking_code', '')), 60), ''),
    ship_cep         = nullif(left(btrim(coalesce(p ->> 'ship_cep', '')), 12), ''),
    ship_street      = nullif(left(btrim(coalesce(p ->> 'ship_street', '')), 160), ''),
    ship_number      = nullif(left(btrim(coalesce(p ->> 'ship_number', '')), 20), ''),
    ship_complement  = nullif(left(btrim(coalesce(p ->> 'ship_complement', '')), 80), ''),
    ship_district    = nullif(left(btrim(coalesce(p ->> 'ship_district', '')), 80), ''),
    ship_city        = nullif(left(btrim(coalesce(p ->> 'ship_city', '')), 80), ''),
    ship_uf          = nullif(upper(left(btrim(coalesce(p ->> 'ship_uf', '')), 2)), '')
  where id = v_id;

  for v_item in select * from jsonb_array_elements(coalesce(p -> 'items', '[]'::jsonb))
  loop
    v_pos := v_pos + 1;
    v_vid := nullif(v_item ->> 'variant_id', '')::uuid;
    v_pid := nullif(v_item ->> 'product_id', '')::uuid;
    v_variant := null;
    v_prod := null;

    if v_vid is null and v_pid is not null then
      if not exists (select 1 from public.products where id = v_pid) then
        raise exception 'O produto da linha % não existe mais. Remova e adicione de novo.', v_pos;
      end if;
      v_vid := public._variant_find_or_create(v_pid, v_item ->> 'storage', v_item ->> 'color', v_item ->> 'size',
                                              v_item ->> 'condition', (v_item ->> 'unit_price')::numeric);
    end if;
    if v_vid is not null then
      select * into v_variant from public.product_variants where id = v_vid;
      if not found then
        raise exception 'A variação da linha % não existe mais. Remova e adicione de novo.', v_pos;
      end if;
      select * into v_prod from public.products where id = v_variant.product_id;
    end if;

    v_units := '{}';
    if jsonb_typeof(v_item -> 'unit_ids') = 'array' then
      select coalesce(array_agg(distinct (x)::uuid), '{}') into v_units
        from jsonb_array_elements_text(v_item -> 'unit_ids') x where x <> '';
    end if;
    if cardinality(v_units) > 0 and (v_prod.id is null or not v_prod.tracks_serial) then
      raise exception 'A linha % tem IMEI escolhido, mas o produto não é controlado por IMEI.', v_pos;
    end if;
    if exists (select 1 from unnest(v_units) x(uid) left join public.units u on u.id = x.uid
                where u.id is null or u.variant_id is distinct from v_vid) then
      raise exception 'Um dos aparelhos escolhidos na linha % não é desta variação. Escolha o IMEI de novo.', v_pos;
    end if;

    v_qty := least(greatest(coalesce((v_item ->> 'qty')::int, 1), 1, cardinality(v_units)), 999);

    -- custo: o que a tela mandou (item já existente, custo "congelado") ou,
    -- se não veio, a média das unidades escolhidas / o custo médio da variação.
    v_cost := nullif(v_item ->> 'unit_cost', '')::numeric;
    if v_cost is null then
      if cardinality(v_units) > 0 then
        select avg(cost) into v_cost from public.units where id = any(v_units);
      else
        v_cost := coalesce(v_variant.cost, 0);
      end if;
    end if;

    v_serial := nullif(left(btrim(coalesce(v_item ->> 'serial', '')), 400), '');
    if cardinality(v_units) > 0 then
      select string_agg(serial, ', ' order by serial) into v_serial from public.units where id = any(v_units) and serial is not null;
    end if;

    insert into public.order_items (order_id, position, product_id, variant_id, category_id, product_name,
                                    storage, color, size, band, condition, origin, qty, unit_price, unit_cost,
                                    unit_ids, serial, warranty_days, note)
    values (
      v_id, v_pos, v_prod.id, v_vid, coalesce(v_prod.category_id, nullif(v_item ->> 'category_id', '')::uuid),
      left(coalesce(nullif(btrim(v_item ->> 'product_name'), ''), v_prod.name, 'Item'), 120),
      coalesce(case when v_vid is not null then nullif(v_variant.storage, '') end, nullif(left(btrim(coalesce(v_item ->> 'storage', '')), 60), '')),
      coalesce(case when v_vid is not null then nullif(v_variant.color, '') end, nullif(left(btrim(coalesce(v_item ->> 'color', '')), 60), '')),
      coalesce(case when v_vid is not null then nullif(v_variant.size, '') end, nullif(left(btrim(coalesce(v_item ->> 'size', '')), 30), '')),
      nullif(left(btrim(coalesce(v_item ->> 'band', '')), 60), ''),
      coalesce(case when v_vid is not null then v_variant.condition end, nullif(left(btrim(coalesce(v_item ->> 'condition', '')), 40), '')),
      nullif(left(btrim(coalesce(v_item ->> 'origin', '')), 40), ''),
      v_qty,
      greatest(round(coalesce((v_item ->> 'unit_price')::numeric, 0), 2), 0),
      greatest(round(coalesce(v_cost, 0), 4), 0),
      v_units,
      v_serial,
      least(greatest(coalesce((v_item ->> 'warranty_days')::int, 0), 0), 3650),
      nullif(left(btrim(coalesce(v_item ->> 'note', '')), 240), '')
    );
  end loop;

  -- Pagamentos: a lista inteira (quando vier). Id do aparelho = reenvio não duplica.
  if jsonb_typeof(p -> 'payments') = 'array' then
    for v_pay in select * from jsonb_array_elements(p -> 'payments') loop
      if coalesce((v_pay ->> 'amount')::numeric, 0) = 0 then continue; end if;
      insert into public.payments (id, order_id, paid_at, amount, method, note)
      values (
        coalesce(nullif(v_pay ->> 'id', '')::uuid, gen_random_uuid()),
        v_id,
        coalesce(nullif(v_pay ->> 'paid_at', '')::date, current_date),
        round((v_pay ->> 'amount')::numeric, 2),
        nullif(left(btrim(coalesce(v_pay ->> 'method', '')), 40), ''),
        nullif(left(btrim(coalesce(v_pay ->> 'note', '')), 160), '')
      )
      on conflict (id) do update set
        paid_at = excluded.paid_at, amount = excluded.amount, method = excluded.method, note = excluded.note
      where public.payments.order_id = v_id
      returning id into v_payid;
      if v_payid is not null then v_pay_ids := v_pay_ids || v_payid; end if;
      v_payid := null;
    end loop;
    delete from public.payments where order_id = v_id and not (id = any(v_pay_ids));
  end if;

  -- Parcelas do fiado: a lista inteira (quando vier). Id do aparelho, como os pagamentos.
  if jsonb_typeof(p -> 'plan') = 'array' then
    if jsonb_array_length(p -> 'plan') > 48 then
      raise exception 'O combinado pode ter no máximo 48 parcelas.';
    end if;
    for v_inst in select * from jsonb_array_elements(p -> 'plan') loop
      v_n := v_n + 1;
      if coalesce((v_inst ->> 'amount')::numeric, 0) <= 0 then
        raise exception 'A parcela % precisa de valor maior que zero.', v_n;
      end if;
      if nullif(v_inst ->> 'due_date', '') is null then
        raise exception 'A parcela % precisa da data de vencimento.', v_n;
      end if;
      insert into public.order_installments (id, order_id, number, due_date, amount, note)
      values (
        coalesce(nullif(v_inst ->> 'id', '')::uuid, gen_random_uuid()),
        v_id,
        least(greatest(coalesce((v_inst ->> 'number')::int, v_n), 0), 99),
        (v_inst ->> 'due_date')::date,
        round((v_inst ->> 'amount')::numeric, 2),
        nullif(left(btrim(coalesce(v_inst ->> 'note', '')), 160), '')
      )
      on conflict (id) do update set
        number = excluded.number, due_date = excluded.due_date, amount = excluded.amount, note = excluded.note
      where public.order_installments.order_id = v_id
      returning id into v_iid;
      if v_iid is not null then v_inst_ids := v_inst_ids || v_iid; end if;
      v_iid := null;
    end loop;
    delete from public.order_installments where order_id = v_id and not (id = any(v_inst_ids));
    update public.orders
       set installments = least(greatest((select count(*) from public.order_installments where order_id = v_id and number > 0), 1), 24)
     where id = v_id;
  end if;

  if v_status not in ('orcamento', 'cancelado') then
    perform public._order_apply_stock(v_id);
  end if;
  perform public._order_check_serials(v_id, v_status);

  update public.orders set updated_at = now() where id = v_id returning * into v_row;

  -- O combinado tem de fechar com o total (a tela redistribui quando o pedido muda).
  select sum(amount) into v_plan from public.order_installments where order_id = v_id;
  if v_plan is not null and v_row.status not in ('orcamento', 'cancelado') and abs(v_plan - v_row.total) > 0.05 then
    raise exception 'As parcelas somam R$ %, mas o pedido é de R$ %. Ajuste as parcelas.',
      replace(to_char(v_plan, 'FM999999990.00'), '.', ','), replace(to_char(v_row.total, 'FM999999990.00'), '.', ',');
  end if;
  return v_row;
end;
$$;

revoke all on function public.save_order(jsonb) from public, anon;
grant execute on function public.save_order(jsonb) to authenticated;

/* Troca a situação do pedido mexendo no estoque (e conferindo os IMEIs). */
create or replace function public.set_order_status(p_id uuid, p_status text)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.orders;
begin
  perform public.require_member();
  if p_status not in ('orcamento','novo','aguardando','pago','preparo','enviado','entregue','cancelado') then
    raise exception 'Situação inválida: %', p_status;
  end if;

  select * into v_row from public.orders where id = p_id for update;
  if not found then raise exception 'Este pedido foi excluído em outro aparelho.'; end if;
  if v_row.status = p_status then return v_row; end if;
  -- "Finalizado" sem quitar = entregue no fiado: fica aguardando pagamento (o gatilho cuida).
  if p_status = 'pago' and v_row.total > 0 and v_row.paid_amount < v_row.total - 0.005 then
    raise exception 'Falta receber R$ % para marcar como pago. Registre o pagamento.',
      replace(to_char(v_row.total - v_row.paid_amount, 'FM999999990.00'), '.', ',');
  end if;

  if p_status in ('orcamento', 'cancelado') then
    if v_row.stock_applied then perform public._order_revert_stock(p_id); end if;
  elsif v_row.legacy_migrated and not v_row.stock_applied then
    perform public._order_apply_stock(p_id);
  end if;
  perform public._order_check_serials(p_id, p_status);

  update public.orders set status = p_status where id = p_id returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.set_order_status(uuid, text) from public, anon;
grant execute on function public.set_order_status(uuid, text) to authenticated;

/*
 * Cancelar um pedido JÁ PAGO. Com p_refund (o dinheiro voltou para o
 * cliente), lança um estorno - pagamento negativo, por forma - na data
 * p_date. Sem estorno, o que foi pago continua contando como recebido
 * (ex.: virou crédito na loja).
 */
create or replace function public.cancel_order(p_id uuid, p_refund boolean default false, p_date date default null)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.orders;
begin
  perform public.require_member();
  select * into v_row from public.orders where id = p_id for update;
  if not found then raise exception 'Este pedido foi excluído em outro aparelho.'; end if;
  if v_row.status = 'cancelado' then return v_row; end if;

  if v_row.stock_applied then perform public._order_revert_stock(p_id); end if;
  update public.orders set status = 'cancelado' where id = p_id;

  if p_refund then
    insert into public.payments (order_id, amount, method, paid_at, note)
    select p_id, -sum(amount), method, coalesce(p_date, current_date), 'Estorno: pedido cancelado'
      from public.payments where order_id = p_id
     group by method
    having sum(amount) > 0;
  end if;

  select * into v_row from public.orders where id = p_id;
  return v_row;
end;
$$;

revoke all on function public.cancel_order(uuid, boolean, date) from public, anon;
grant execute on function public.cancel_order(uuid, boolean, date) to authenticated;

create or replace function public.delete_order(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_member();
  perform 1 from public.orders where id = p_id for update;
  if not found then return; end if;
  perform public._order_revert_stock(p_id);
  delete from public.orders where id = p_id;
end;
$$;

revoke all on function public.delete_order(uuid) from public, anon;
grant execute on function public.delete_order(uuid) to authenticated;

-- =====================================================================
--  RPC: ENTRADAS
-- =====================================================================

/*
 * Lança uma entrada de mercadoria.
 *   p = { supplier_id?, supplier_name, purchase_date, invoice_ref, currency,
 *         exchange_rate, freight, other_costs, notes,
 *         items: [{ variant_id | product_id + storage/color/size/condition,
 *                   qty, unit_cost, sale_price?,
 *                   units?: [{ serial, cost?, origin?, battery_health?, notes? }] }] }
 * Custo real = custo digitado × câmbio + parte do frete/taxas (proporcional
 * ao valor da linha; nota sem valor: pelas unidades). Mesma fórmula de
 * core/calc.js (apportionCosts).
 *   - sem IMEI: estoque += qty, custo médio ponderado;
 *   - com IMEI: uma unidade por aparelho (o IMEI é obrigatório), custo
 *     médio = média das unidades em estoque.
 * sale_price > 0 vira o preço de venda da variação.
 */
create or replace function public.post_purchase(p jsonb)
returns public.purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id      uuid;
  v_number  int;
  v_item    jsonb;
  v_unit    jsonb;
  v_pos     int := 0;
  v_rate    numeric := greatest(coalesce((p ->> 'exchange_rate')::numeric, 1), 0.0001);
  v_cur     text := coalesce(nullif(p ->> 'currency', ''), 'BRL');
  v_extra   numeric(12,2) := greatest(coalesce((p ->> 'freight')::numeric, 0), 0)
                           + greatest(coalesce((p ->> 'other_costs')::numeric, 0), 0);
  v_items_total numeric := 0;
  v_total_units int := 0;
  v_qty     int;
  v_input   numeric;
  v_line    numeric;
  v_share   numeric;
  v_ucost   numeric(12,4);
  v_vid     uuid;
  v_var     public.product_variants;
  v_prod    public.products;
  v_newcost numeric(12,4);
  v_price   numeric(12,2);
  v_serials text[];
  v_serial  text;
  v_uid     uuid;
  v_row     public.purchases;
begin
  perform public.require_member();

  if v_cur not in ('BRL', 'USD') then raise exception 'Moeda inválida.'; end if;
  if v_cur = 'BRL' then v_rate := 1; end if;
  if jsonb_typeof(p -> 'items') is distinct from 'array' or jsonb_array_length(p -> 'items') = 0 then
    raise exception 'Adicione pelo menos um item à entrada.';
  end if;

  -- 1. resolve as variações e soma a nota (base do rateio)
  for v_item in select * from jsonb_array_elements(p -> 'items') loop
    v_input := greatest(coalesce((v_item ->> 'unit_cost')::numeric, 0), 0);
    if jsonb_typeof(v_item -> 'units') = 'array' and jsonb_array_length(v_item -> 'units') > 0 then
      -- cada aparelho pode ter custo próprio (senão, o da linha)
      v_qty := jsonb_array_length(v_item -> 'units');
      v_items_total := v_items_total + v_rate * (
        select coalesce(sum(greatest(coalesce(nullif(u ->> 'cost', '')::numeric, v_input), 0)), 0)
          from jsonb_array_elements(v_item -> 'units') u);
    else
      v_qty := greatest(coalesce((v_item ->> 'qty')::int, 1), 1);
      v_items_total := v_items_total + v_qty * v_input * v_rate;
    end if;
    v_total_units := v_total_units + v_qty;
    if nullif(v_item ->> 'variant_id', '') is null and nullif(v_item ->> 'product_id', '') is null then
      raise exception 'Todo item da entrada precisa estar ligado a um produto do cadastro.';
    end if;
  end loop;

  insert into public.purchases (supplier_id, supplier_name, purchase_date, invoice_ref, currency, exchange_rate,
                                freight, other_costs, items_total, total, notes)
  values (
    nullif(p ->> 'supplier_id', '')::uuid,
    nullif(left(btrim(coalesce(p ->> 'supplier_name', '')), 120), ''),
    coalesce(nullif(p ->> 'purchase_date', '')::date, current_date),
    nullif(left(btrim(coalesce(p ->> 'invoice_ref', '')), 60), ''),
    v_cur, v_rate,
    greatest(coalesce((p ->> 'freight')::numeric, 0), 0),
    greatest(coalesce((p ->> 'other_costs')::numeric, 0), 0),
    round(v_items_total, 2),
    round(v_items_total, 2) + v_extra,
    nullif(left(btrim(coalesce(p ->> 'notes', '')), 1000), '')
  )
  returning id, number into v_id, v_number;

  for v_item in select * from jsonb_array_elements(p -> 'items') loop
    v_pos := v_pos + 1;
    v_vid := nullif(v_item ->> 'variant_id', '')::uuid;
    if v_vid is null then
      if not exists (select 1 from public.products where id = (v_item ->> 'product_id')::uuid) then
        raise exception 'O produto da linha % não existe mais.', v_pos;
      end if;
      v_vid := public._variant_find_or_create((v_item ->> 'product_id')::uuid, v_item ->> 'storage', v_item ->> 'color',
                                              v_item ->> 'size', v_item ->> 'condition', null);
    end if;

    select * into v_var from public.product_variants where id = v_vid for update;
    if not found then raise exception 'A variação da linha % não existe mais.', v_pos; end if;
    select * into v_prod from public.products where id = v_var.product_id;

    v_input := greatest(coalesce((v_item ->> 'unit_cost')::numeric, 0), 0);
    v_price := nullif(greatest(coalesce((v_item ->> 'sale_price')::numeric, 0), 0), 0);

    if v_prod.tracks_serial then
      if jsonb_typeof(v_item -> 'units') is distinct from 'array' or jsonb_array_length(v_item -> 'units') = 0 then
        raise exception '"%" é controlado por IMEI: informe o IMEI de cada aparelho (linha %).',
          concat_ws(' · ', v_prod.name, nullif(public.variant_label(v_var), '')), v_pos;
      end if;
      v_qty := jsonb_array_length(v_item -> 'units');
      v_serials := '{}';
      for v_unit in select * from jsonb_array_elements(v_item -> 'units') loop
        v_serial := nullif(left(btrim(coalesce(v_unit ->> 'serial', '')), 40), '');
        if v_serial is null then
          raise exception 'Falta o IMEI de um aparelho de "%" (linha %).', v_prod.name, v_pos;
        end if;
        if exists (select 1 from public.units where upper(btrim(serial)) = upper(v_serial) and status = 'estoque') then
          raise exception 'O IMEI % já está no estoque.', v_serial;
        end if;
        v_line  := coalesce(nullif(v_unit ->> 'cost', '')::numeric, v_input) * v_rate;
        v_share := case when v_items_total > 0 then v_extra * (v_line / v_items_total)
                        when v_total_units > 0 then v_extra / v_total_units else 0 end;
        insert into public.units (variant_id, serial, cost, origin, battery_health, notes, purchase_id)
        values (v_vid, v_serial, round(v_line + v_share, 4),
                nullif(left(btrim(coalesce(v_unit ->> 'origin', '')), 40), ''),
                nullif(v_unit ->> 'battery_health', '')::smallint,
                nullif(left(btrim(coalesce(v_unit ->> 'notes', '')), 500), ''),
                v_id)
        returning id into v_uid;
        insert into public.stock_movements (variant_id, kind, qty, unit_cost, unit_id, purchase_id, note, prev_cost)
        values (v_vid, 'entrada', 1, round(v_line + v_share, 4), v_uid, v_id, format('Entrada #%s', v_number), v_var.cost);
        v_serials := v_serials || v_serial;
      end loop;
      perform public._variant_sync(v_vid);
      select cost into v_newcost from public.product_variants where id = v_vid;
      v_ucost := round(v_input * v_rate + case when v_items_total > 0 then v_extra * (v_input * v_rate / v_items_total)
                                              when v_total_units > 0 then v_extra / v_total_units else 0 end, 4);
      update public.product_variants set price = coalesce(v_price, price), active = true where id = v_vid;
      update public.stock_movements set new_cost = v_newcost where purchase_id = v_id and variant_id = v_vid;
    else
      v_qty   := greatest(coalesce((v_item ->> 'qty')::int, 1), 1);
      v_line  := v_qty * v_input * v_rate;
      v_ucost := round(v_input * v_rate
               + case when v_items_total > 0 then v_extra * (v_line / v_items_total) / v_qty
                      when v_total_units > 0 then v_extra / v_total_units else 0 end, 4);
      v_newcost := case when greatest(v_var.stock, 0) = 0 then v_ucost
                        else round((greatest(v_var.stock, 0) * v_var.cost + v_qty * v_ucost) / (greatest(v_var.stock, 0) + v_qty), 4) end;
      update public.product_variants
         set stock = stock + v_qty, cost = v_newcost, price = coalesce(v_price, price), active = true
       where id = v_vid;
      insert into public.stock_movements (variant_id, kind, qty, unit_cost, purchase_id, note, prev_cost, new_cost)
      values (v_vid, 'entrada', v_qty, v_ucost, v_id, format('Entrada #%s', v_number), v_var.cost, v_newcost);
      v_serials := '{}';
    end if;

    insert into public.purchase_items (purchase_id, position, variant_id, description, qty, unit_cost_input, unit_cost, sale_price, serials)
    values (v_id, v_pos, v_vid,
            left(concat_ws(' · ', v_prod.name, nullif(public.variant_label(v_var), '')), 200),
            v_qty, round(v_input, 2), v_ucost, v_price, v_serials);
  end loop;

  select * into v_row from public.purchases where id = v_id;
  return v_row;
end;
$$;

revoke all on function public.post_purchase(jsonb) from public, anon;
grant execute on function public.post_purchase(jsonb) to authenticated;

/*
 * Cancela uma entrada lançada errado. Recusa se parte do que entrou já foi
 * vendida (aparelho vendido, ou saldo menor do que a entrada pôs). O custo
 * médio volta ao de antes quando nenhuma entrada mais nova mexeu nele.
 */
create or replace function public.cancel_purchase(p_id uuid)
returns public.purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row     public.purchases;
  v_allow   boolean;
  r         record;
  v_missing text := '';
begin
  perform public.require_member();
  select * into v_row from public.purchases where id = p_id for update;
  if not found then raise exception 'Entrada não encontrada.'; end if;
  if v_row.status = 'cancelada' then return v_row; end if;
  select allow_negative_stock into v_allow from public.store_settings where id = 1;

  perform 1 from public.product_variants
   where id in (select variant_id from public.stock_movements where purchase_id = p_id)
   order by id for update;

  for r in select serial, status from public.units where purchase_id = p_id and status <> 'estoque' loop
    v_missing := v_missing || format(E'\n• IMEI %s já foi %s', coalesce(r.serial, '?'),
      case when r.status = 'vendido' then 'vendido' else 'baixado' end);
  end loop;
  if not coalesce(v_allow, false) then
    for r in
      select concat_ws(' · ', p.name, nullif(public._vlabel(v.size, v.storage, v.color, v.condition), '')) as label,
             v.stock, sum(m.qty)::int as qty
        from public.stock_movements m
        join public.product_variants v on v.id = m.variant_id
        join public.products p on p.id = v.product_id and not p.tracks_serial
       where m.purchase_id = p_id
       group by v.id, p.name, v.stock, v.size, v.storage, v.color, v.condition
    loop
      if r.stock < r.qty then
        v_missing := v_missing || format(E'\n• %s: tem %s, a entrada pôs %s', r.label, r.stock, r.qty);
      end if;
    end loop;
  end if;
  if v_missing <> '' then
    raise exception 'Não dá para cancelar: parte do que entrou já saiu do estoque.%', v_missing;
  end if;

  for r in
    select m.variant_id, sum(m.qty)::int as qty,
           (array_agg(m.prev_cost order by m.id))[1] as prev_cost,
           (array_agg(m.new_cost order by m.id desc))[1] as new_cost
      from public.stock_movements m
      join public.product_variants v on v.id = m.variant_id
      join public.products p on p.id = v.product_id and not p.tracks_serial
     where m.purchase_id = p_id
     group by m.variant_id
     order by m.variant_id
  loop
    update public.product_variants
       set stock = stock - r.qty,
           cost = case when r.prev_cost is not null and cost = r.new_cost then r.prev_cost else cost end
     where id = r.variant_id;
  end loop;

  delete from public.stock_movements where purchase_id = p_id;
  for r in select distinct variant_id from public.units where purchase_id = p_id loop
    delete from public.units where purchase_id = p_id and variant_id = r.variant_id;
    perform public._variant_sync(r.variant_id);
  end loop;
  update public.purchases set status = 'cancelada' where id = p_id;

  select * into v_row from public.purchases where id = p_id;
  return v_row;
end;
$$;

revoke all on function public.cancel_purchase(uuid) from public, anon;
grant execute on function public.cancel_purchase(uuid) to authenticated;

-- =====================================================================
--  RPC: ESTOQUE (ajuste, unidades, preços, exclusão)
-- =====================================================================

/* Produto SEM IMEI: o que tem na prateleira (contagem, perda, quebra, uso próprio). */
create or replace function public.adjust_stock(p_variant uuid, p_new_stock int, p_note text default null)
returns public.product_variants
language plpgsql
security definer
set search_path = public
as $$
declare
  v_var   public.product_variants;
  v_delta int;
begin
  perform public.require_member();
  select * into v_var from public.product_variants where id = p_variant for update;
  if not found then raise exception 'Variação não encontrada.'; end if;
  if exists (select 1 from public.products where id = v_var.product_id and tracks_serial) then
    raise exception 'Este produto é controlado por IMEI: o estoque muda pelas unidades (entrada ou baixa).';
  end if;
  if p_new_stock is null or p_new_stock < 0 then
    raise exception 'Informe a quantidade contada (zero ou mais).';
  end if;

  v_delta := p_new_stock - v_var.stock;
  if v_delta = 0 then return v_var; end if;

  update public.product_variants set stock = p_new_stock where id = p_variant returning * into v_var;
  insert into public.stock_movements (variant_id, kind, qty, unit_cost, note)
  values (p_variant, 'ajuste', v_delta, v_var.cost, nullif(left(btrim(coalesce(p_note, '')), 240), ''));
  return v_var;
end;
$$;

revoke all on function public.adjust_stock(uuid, int, text) from public, anon;
grant execute on function public.adjust_stock(uuid, int, text) to authenticated;

/*
 * Aparelhos que já estão na loja (estoque inicial, troca, compra sem nota):
 * entram aqui sem virar entrada de fornecedor.
 *   p_units = [{ serial, cost, origin?, battery_health?, notes? }]
 */
create or replace function public.add_units(p_variant uuid, p_units jsonb, p_note text default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_var    public.product_variants;
  v_unit   jsonb;
  v_serial text;
  v_uid    uuid;
  v_n      int := 0;
begin
  perform public.require_member();
  select * into v_var from public.product_variants where id = p_variant for update;
  if not found then raise exception 'Variação não encontrada.'; end if;
  if not exists (select 1 from public.products where id = v_var.product_id and tracks_serial) then
    raise exception 'Este produto não é controlado por IMEI: use o ajuste de estoque.';
  end if;
  if jsonb_typeof(p_units) is distinct from 'array' or jsonb_array_length(p_units) = 0 then
    raise exception 'Informe pelo menos um aparelho.';
  end if;

  for v_unit in select * from jsonb_array_elements(p_units) loop
    v_serial := nullif(left(btrim(coalesce(v_unit ->> 'serial', '')), 40), '');
    if v_serial is null then raise exception 'Informe o IMEI / número de série de cada aparelho.'; end if;
    if exists (select 1 from public.units where upper(btrim(serial)) = upper(v_serial) and status = 'estoque') then
      raise exception 'O IMEI % já está no estoque.', v_serial;
    end if;
    insert into public.units (variant_id, serial, cost, origin, battery_health, notes)
    values (p_variant, v_serial, greatest(round(coalesce((v_unit ->> 'cost')::numeric, 0), 4), 0),
            nullif(left(btrim(coalesce(v_unit ->> 'origin', '')), 40), ''),
            nullif(v_unit ->> 'battery_health', '')::smallint,
            nullif(left(btrim(coalesce(v_unit ->> 'notes', '')), 500), ''))
    returning id into v_uid;
    insert into public.stock_movements (variant_id, kind, qty, unit_cost, unit_id, note)
    values (p_variant, 'inicial', 1, greatest(round(coalesce((v_unit ->> 'cost')::numeric, 0), 4), 0), v_uid,
            coalesce(nullif(left(btrim(coalesce(p_note, '')), 240), ''), 'Aparelho cadastrado'));
    v_n := v_n + 1;
  end loop;

  perform public._variant_sync(p_variant);
  return v_n;
end;
$$;

revoke all on function public.add_units(uuid, jsonb, text) from public, anon;
grant execute on function public.add_units(uuid, jsonb, text) to authenticated;

/* Corrige os dados de um aparelho (IMEI digitado errado, custo, bateria...). */
create or replace function public.save_unit(p jsonb)
returns public.units
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit   public.units;
  v_serial text := nullif(left(btrim(coalesce(p ->> 'serial', '')), 40), '');
begin
  perform public.require_member();
  select * into v_unit from public.units where id = (p ->> 'id')::uuid for update;
  if not found then raise exception 'Aparelho não encontrado.'; end if;
  if v_serial is null then raise exception 'O IMEI / número de série não pode ficar vazio.'; end if;
  if v_unit.status = 'estoque' and exists (
       select 1 from public.units where upper(btrim(serial)) = upper(v_serial) and status = 'estoque' and id <> v_unit.id) then
    raise exception 'O IMEI % já está no estoque em outro aparelho.', v_serial;
  end if;

  update public.units set
    serial = v_serial,
    cost = case when p ? 'cost' then greatest(round(coalesce((p ->> 'cost')::numeric, 0), 4), 0) else cost end,
    origin = nullif(left(btrim(coalesce(p ->> 'origin', '')), 40), ''),
    battery_health = nullif(p ->> 'battery_health', '')::smallint,
    notes = nullif(left(btrim(coalesce(p ->> 'notes', '')), 500), '')
  where id = v_unit.id
  returning * into v_unit;

  -- O IMEI aparece no item do pedido: mantém o texto em dia.
  if v_unit.order_id is not null then
    update public.order_items oi
       set serial = (select string_agg(serial, ', ' order by serial) from public.units where id = any(oi.unit_ids) and serial is not null)
     where oi.order_id = v_unit.order_id and v_unit.id = any(oi.unit_ids);
  end if;

  perform public._variant_sync(v_unit.variant_id);
  return v_unit;
end;
$$;

revoke all on function public.save_unit(jsonb) from public, anon;
grant execute on function public.save_unit(jsonb) to authenticated;

/*
 * Tira um aparelho do estoque sem venda (defeito, devolvido ao fornecedor,
 * uso próprio). Ele continua no histórico como "baixa".
 */
create or replace function public.discard_unit(p_id uuid, p_note text default null)
returns public.units
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.units;
begin
  perform public.require_member();
  select * into v_unit from public.units where id = p_id for update;
  if not found then raise exception 'Aparelho não encontrado.'; end if;
  if v_unit.status <> 'estoque' then
    raise exception 'Só dá para dar baixa num aparelho que está no estoque.';
  end if;
  perform 1 from public.product_variants where id = v_unit.variant_id for update;
  update public.units set status = 'baixa', notes = coalesce(nullif(left(btrim(coalesce(p_note, '')), 500), ''), notes)
   where id = p_id returning * into v_unit;
  insert into public.stock_movements (variant_id, kind, qty, unit_cost, unit_id, note)
  values (v_unit.variant_id, 'baixa', -1, v_unit.cost, v_unit.id,
          coalesce(nullif(left(btrim(coalesce(p_note, '')), 240), ''), 'Baixa do estoque'));
  perform public._variant_sync(v_unit.variant_id);
  return v_unit;
end;
$$;

revoke all on function public.discard_unit(uuid, text) from public, anon;
grant execute on function public.discard_unit(uuid, text) to authenticated;

/* Desfaz uma baixa lançada por engano (o aparelho volta ao estoque). */
create or replace function public.restore_unit(p_id uuid)
returns public.units
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.units;
begin
  perform public.require_member();
  select * into v_unit from public.units where id = p_id for update;
  if not found then raise exception 'Aparelho não encontrado.'; end if;
  if v_unit.status <> 'baixa' then raise exception 'Este aparelho não está baixado.'; end if;
  if v_unit.serial is not null and exists (
       select 1 from public.units where upper(btrim(serial)) = upper(btrim(v_unit.serial)) and status = 'estoque') then
    raise exception 'O IMEI % já está no estoque em outro aparelho.', v_unit.serial;
  end if;
  update public.units set status = 'estoque' where id = p_id returning * into v_unit;
  delete from public.stock_movements where unit_id = p_id and kind = 'baixa';
  perform public._variant_sync(v_unit.variant_id);
  return v_unit;
end;
$$;

revoke all on function public.restore_unit(uuid) from public, anon;
grant execute on function public.restore_unit(uuid) to authenticated;

/*
 * Reajuste de preços numa transação ("o iPhone baixou R$ 200"):
 * p_items = [{ variant_id, price }]. Devolve quantos mudaram.
 */
create or replace function public.set_prices(p_items jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  perform public.require_member();
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Nada para gravar.'; end if;
  if exists (select 1 from jsonb_array_elements(p_items) x where coalesce((x ->> 'price')::numeric, -1) < 0) then
    raise exception 'Preço inválido na lista (precisa ser zero ou mais).';
  end if;
  update public.product_variants v
     set price = round((x ->> 'price')::numeric, 2)
    from jsonb_array_elements(p_items) x
   where v.id = (x ->> 'variant_id')::uuid
     and v.price is distinct from round((x ->> 'price')::numeric, 2);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.set_prices(jsonb) from public, anon;
grant execute on function public.set_prices(jsonb) to authenticated;

/*
 * Excluir variação/modelo só se NUNCA teve movimento, venda, entrada nem
 * aparelho. Com histórico, o certo é desativar: some do pedido e do
 * catálogo, e os relatórios continuam certos.
 */
create or replace function public.delete_variant(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label text;
begin
  perform public.require_member();
  select concat_ws(' · ', p.name, nullif(public.variant_label(v), '')) into v_label
    from public.product_variants v join public.products p on p.id = v.product_id
   where v.id = p_id;
  if v_label is null then return; end if;
  if exists (select 1 from public.order_items where variant_id = p_id)
     or exists (select 1 from public.purchase_items where variant_id = p_id)
     or exists (select 1 from public.units where variant_id = p_id)
     or exists (select 1 from public.stock_movements where variant_id = p_id and kind <> 'inicial') then
    raise exception 'EM_USO: "%" já tem vendas, entradas ou aparelhos no histórico. Desative em vez de excluir.', v_label;
  end if;
  delete from public.stock_movements where variant_id = p_id;
  delete from public.product_variants where id = p_id;
end;
$$;

revoke all on function public.delete_variant(uuid) from public, anon;
grant execute on function public.delete_variant(uuid) to authenticated;

create or replace function public.delete_product(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  r      record;
begin
  perform public.require_member();
  select name into v_name from public.products where id = p_id for update;
  if not found then return; end if;
  if exists (select 1 from public.order_items where product_id = p_id) then
    raise exception 'EM_USO: "%" já aparece em pedidos. Desative em vez de excluir: ele some do pedido e do catálogo e o histórico continua.', v_name;
  end if;
  for r in select id from public.product_variants where product_id = p_id loop
    perform public.delete_variant(r.id);
  end loop;
  delete from public.products where id = p_id;
end;
$$;

revoke all on function public.delete_product(uuid) from public, anon;
grant execute on function public.delete_product(uuid) to authenticated;

/* Excluir categoria levando os produtos para outra, numa transação só. */
create or replace function public.delete_category(p_id uuid, p_move_to uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  perform public.require_member();
  if p_move_to = p_id then raise exception 'Escolha outra categoria para os produtos.'; end if;
  if p_move_to is not null and not exists (select 1 from public.categories where id = p_move_to) then
    raise exception 'A categoria de destino não existe mais.';
  end if;
  update public.products set category_id = p_move_to where category_id = p_id;
  get diagnostics v_n = row_count;
  delete from public.categories where id = p_id;
  return v_n;
end;
$$;

revoke all on function public.delete_category(uuid, uuid) from public, anon;
grant execute on function public.delete_category(uuid, uuid) to authenticated;

-- =====================================================================
--  ERROS DOS APARELHOS (diagnóstico)
-- =====================================================================

create table if not exists public.client_errors (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  message     text not null check (length(message) <= 500),
  stack       text check (stack is null or length(stack) <= 4000),
  url         text check (url is null or length(url) <= 300),
  user_agent  text check (user_agent is null or length(user_agent) <= 300),
  app_version text check (app_version is null or length(app_version) <= 20),
  context     jsonb check (context is null or pg_column_size(context) <= 4000)
);

create index if not exists client_errors_created_idx on public.client_errors (created_at desc);

create or replace function public.client_errors_prune()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.client_errors where created_at < now() - interval '90 days';
  return null;
end;
$$;

drop trigger if exists client_errors_prune_trg on public.client_errors;
create trigger client_errors_prune_trg after insert on public.client_errors
  for each statement execute function public.client_errors_prune();

/*
 * Erros do CATÁLOGO (celular do cliente, sem login). Só por esta função,
 * com teto: 100 por dia e 10 por chamada. Passou, descarta em silêncio.
 */
create or replace function public.log_client_error(p jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.client_errors
       where created_at > now() - interval '1 day' and context ->> 'source' = 'catalogo') >= 100 then
    return;
  end if;
  insert into public.client_errors (message, stack, url, user_agent, app_version, context)
  select left(btrim(x ->> 'message'), 500), left(x ->> 'stack', 1500), left(x ->> 'url', 300),
         left(x ->> 'user_agent', 300), left(x ->> 'app_version', 20),
         case when jsonb_typeof(x -> 'context') = 'object' and pg_column_size(x -> 'context') < 2000
              then x -> 'context' else '{}'::jsonb end || jsonb_build_object('source', 'catalogo')
    from (select e from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else jsonb_build_array(p) end) e limit 10) t(x)
   where length(btrim(coalesce(x ->> 'message', ''))) > 0;
end;
$$;

revoke all on function public.log_client_error(jsonb) from public;
grant execute on function public.log_client_error(jsonb) to anon, authenticated;

-- =====================================================================
--  CATÁLOGO PÚBLICO (link para mandar no WhatsApp / bio do Instagram)
-- =====================================================================
--
--  catalogo.html é aberto por qualquer pessoa, sem login. Ele NUNCA lê
--  tabela: só chama as duas funções abaixo, que devolvem o mínimo - modelo,
--  foto, variações com preço e "tem / não tem". Custo, saldo exato, IMEI,
--  clientes e pedidos nunca saem daqui. Desligado em Ajustes = só o WhatsApp.

/*
 * Oferta de cada variação no catálogo:
 *   pronta entrega  tem estoque e preço;
 *   sob encomenda   marcada como encomenda (lista do fornecedor) com preço
 *                   próprio - ou, com "mostrar sem estoque" ligado, a
 *                   variação zerada pelo preço normal.
 */
create or replace function public._order_offer_price(v public.product_variants, p_show_oos boolean)
returns numeric
language sql
stable
as $$
  select case
    when v.on_order and coalesce(v.order_price, 0) > 0 then v.order_price
    when p_show_oos and v.stock <= 0 and v.price > 0 then v.price
  end;
$$;

create or replace function public.public_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s          public.store_settings;
  v_products jsonb;
begin
  select * into s from public.store_settings where id = 1;
  if not coalesce(s.catalog_enabled, false) then
    return jsonb_build_object('enabled', false,
      'store', jsonb_build_object('name', s.store_name, 'phone', s.phone, 'instagram', s.instagram));
  end if;

  with base as (
    select v.*,
           (v.stock > 0 and v.price > 0) as ready,
           public._order_offer_price(v, s.catalog_show_out_of_stock) as enc_price,
           -- seminovo: a faixa de saúde da bateria dos aparelhos na loja (nunca o IMEI)
           (select min(u.battery_health) from public.units u where u.variant_id = v.id and u.status = 'estoque') as bat_min,
           (select max(u.battery_health) from public.units u where u.variant_id = v.id and u.status = 'estoque') as bat_max
      from public.product_variants v
      join public.products p on p.id = v.product_id
     where v.active and v.show_in_catalog
       and p.active and p.show_in_catalog
       and (p.category_id is null or exists (select 1 from public.categories c where c.id = p.category_id and c.active))
  ),
  vis as (
    select * from base where ready or enc_price is not null
  ),
  prods as (
    select p.id, p.code, p.name, p.brand, p.year, p.description, p.image_url, p.gallery, p.category_id, p.featured,
           p.storages, p.colors, p.sizes,
           jsonb_agg(jsonb_build_object(
             'id', vis.id,
             'storage', nullif(vis.storage, ''),
             'color', nullif(vis.color, ''),
             'size', nullif(vis.size, ''),
             'condition', vis.condition,
             'price', case when vis.ready then vis.price else vis.enc_price end,
             'ready_price', case when vis.ready then vis.price end,
             'order_price', vis.enc_price,
             'order_lead', case when vis.enc_price is not null then nullif(vis.order_lead, '') end,
             'image', vis.image_url,
             'available', vis.ready,
             'on_order', vis.enc_price is not null,
             'last_units', vis.ready and vis.stock between 1 and 2,
             'battery_min', vis.bat_min,
             'battery_max', vis.bat_max
           ) order by case when vis.ready then vis.price else vis.enc_price end, vis.storage, vis.color) as variants,
           min(case when vis.ready then vis.price else vis.enc_price end) as min_price,
           bool_or(vis.ready) as available,
           bool_or(vis.enc_price is not null) as on_order
      from vis join public.products p on p.id = vis.product_id
     group by p.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'code', x.code, 'name', x.name, 'brand', x.brand, 'year', x.year,
           'description', x.description, 'image', x.image_url, 'gallery', to_jsonb(x.gallery), 'category_id', x.category_id,
           'featured', x.featured, 'storages', to_jsonb(x.storages), 'colors', to_jsonb(x.colors),
           'sizes', to_jsonb(x.sizes), 'variants', x.variants,
           'min_price', x.min_price, 'available', x.available, 'on_order', x.on_order
         ) order by x.available desc, x.featured desc, x.year desc nulls last, x.name), '[]'::jsonb)
    into v_products
    from prods x;

  return jsonb_build_object(
    'enabled', true,
    'generated_at', now(),
    'store', jsonb_build_object(
      'name', s.store_name, 'phone', s.phone, 'instagram', s.instagram,
      'address', s.address, 'message', s.catalog_message),
    'categories', (
      select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'emoji', c.emoji, 'image', c.image,
                                                   'description', c.description, 'variant_label', c.variant_label,
                                                   'color_label', c.color_label, 'size_label', c.size_label)
                                order by c.sort, c.name), '[]'::jsonb)
        from public.categories c
       where c.active and exists (
         select 1 from jsonb_array_elements(v_products) x where x ->> 'category_id' = c.id::text)),
    'products', v_products
  );
end;
$$;

revoke all on function public.public_catalog() from public;
grant execute on function public.public_catalog() to anon, authenticated;

/* Pedido feito pelo catálogo: fica registrado para a loja transformar em pedido com um toque. */
create table if not exists public.catalog_requests (
  id             uuid primary key default gen_random_uuid(),
  number         int generated by default as identity unique,
  created_at     timestamptz not null default now(),
  customer_name  text not null check (length(btrim(customer_name)) between 1 and 80),
  customer_phone text check (customer_phone is null or length(customer_phone) <= 30),
  notes          text check (notes is null or length(notes) <= 500),
  items          jsonb not null check (jsonb_typeof(items) = 'array' and pg_column_size(items) <= 20000),
  total          numeric(12,2) not null default 0,
  status         text not null default 'novo' check (status in ('novo', 'convertido', 'descartado')),
  order_id       uuid references public.orders (id) on delete set null,
  client_key     text check (client_key is null or length(client_key) <= 40)
);

create index if not exists catalog_requests_created_idx on public.catalog_requests (created_at desc);
create index if not exists catalog_requests_status_idx on public.catalog_requests (status) where status = 'novo';
create index if not exists catalog_requests_key_idx on public.catalog_requests (client_key, created_at);
create index if not exists catalog_requests_phone_idx on public.catalog_requests (customer_phone, created_at);

/*
 * Chamada pelo catálogo (sem login). Defesas: só aceita variação visível no
 * catálogo, o PREÇO vem do banco (nunca do navegador), no máximo 30 itens,
 * e freios contra robô:
 *   - por aparelho (hash do IP que o Supabase repassa; o IP não fica
 *     guardado) e por telefone: 8 pedidos por hora;
 *   - na loja toda: 120 a cada 10 min e 1000 por dia (último recurso).
 * Cada item vem como "pronta" (pronta entrega) ou "encomenda" - cada um com
 * o seu preço. Pronta entrega que esgotou com a página aberta vira
 * encomenda (se houver a oferta) ou entra marcada para a loja confirmar.
 */
create or replace function public.catalog_request(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  s        public.store_settings;
  v_name   text := left(btrim(coalesce(p ->> 'customer_name', '')), 80);
  v_phone  text := nullif(left(regexp_replace(coalesce(p ->> 'customer_phone', ''), '\D', '', 'g'), 30), '');
  v_items  jsonb := '[]'::jsonb;
  v_total  numeric(12,2) := 0;
  v_it     jsonb;
  r        record;
  v_qty    int;
  v_mode   text;
  v_price  numeric(12,2);
  v_row    public.catalog_requests;
  v_hdr    jsonb;
  v_ip     text;
  v_key    text;
begin
  begin
    v_hdr := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_hdr := null;
  end;
  v_ip := coalesce(nullif(v_hdr ->> 'cf-connecting-ip', ''), nullif(btrim(split_part(v_hdr ->> 'x-forwarded-for', ',', 1)), ''),
                   nullif(v_hdr ->> 'x-real-ip', ''));
  v_key := case when v_ip is not null then md5('i7even:' || v_ip) end;

  select * into s from public.store_settings where id = 1;
  if not coalesce(s.catalog_enabled, false) then
    raise exception 'O catálogo está fechado no momento.';
  end if;
  if length(v_name) = 0 then
    raise exception 'Informe seu nome.';
  end if;
  if jsonb_typeof(p -> 'items') is distinct from 'array'
     or jsonb_array_length(p -> 'items') = 0 or jsonb_array_length(p -> 'items') > 30 then
    raise exception 'A sacola precisa ter de 1 a 30 itens.';
  end if;
  if (v_key is not null and (select count(*) from public.catalog_requests
                              where client_key = v_key and created_at > now() - interval '1 hour') >= 8)
     or (v_phone is not null and (select count(*) from public.catalog_requests
                                   where customer_phone = v_phone and created_at > now() - interval '1 hour') >= 8)
     or (select count(*) from public.catalog_requests where created_at > now() - interval '10 minutes') >= 120
     or (select count(*) from public.catalog_requests where created_at > now() - interval '1 day') >= 1000 then
    raise exception 'Muitos pedidos agora. Mande a mensagem direto no WhatsApp da loja.';
  end if;

  for v_it in select * from jsonb_array_elements(p -> 'items') loop
    v_qty := least(greatest(coalesce((v_it ->> 'qty')::int, 1), 1), 20);
    select v.id, v.price, v.stock, v.order_lead, p2.name, public.variant_label(v) as label,
           public._order_offer_price(v, s.catalog_show_out_of_stock) as enc_price
      into r
      from public.product_variants v
      join public.products p2 on p2.id = v.product_id
     where v.id = nullif(v_it ->> 'variant_id', '')::uuid
       and v.active and v.show_in_catalog and p2.active and p2.show_in_catalog
       and (p2.category_id is null or exists (select 1 from public.categories c where c.id = p2.category_id and c.active));
    continue when not found;

    v_mode := case when v_it ->> 'mode' = 'encomenda' then 'encomenda' else 'pronta' end;
    -- pronta entrega que acabou enquanto a página estava aberta: vira encomenda, se houver
    if v_mode = 'pronta' and (r.stock < v_qty or r.price <= 0) and r.enc_price is not null then
      v_mode := 'encomenda';
    end if;
    if v_mode = 'encomenda' and r.enc_price is null then
      v_mode := 'pronta';
    end if;
    v_price := case when v_mode = 'encomenda' then r.enc_price else r.price end;
    continue when coalesce(v_price, 0) <= 0;

    v_items := v_items || jsonb_build_object(
      'variant_id', r.id,
      'name', concat_ws(' · ', r.name, nullif(r.label, '')),
      'qty', v_qty,
      'unit_price', v_price,
      'mode', v_mode,
      'lead', case when v_mode = 'encomenda' then nullif(r.order_lead, '') end,
      -- "available": pronta entrega com estoque para a quantidade pedida
      'available', v_mode = 'encomenda' or r.stock >= v_qty);
    v_total := v_total + v_qty * v_price;
  end loop;

  if jsonb_array_length(v_items) = 0 then
    raise exception 'Os produtos da sacola não estão mais disponíveis.';
  end if;

  insert into public.catalog_requests (customer_name, customer_phone, notes, items, total, client_key)
  values (v_name, v_phone, nullif(left(btrim(coalesce(p ->> 'notes', '')), 500), ''), v_items, v_total, v_key)
  returning * into v_row;

  return jsonb_build_object('number', v_row.number, 'total', v_row.total, 'items', v_row.items);
end;
$$;

revoke all on function public.catalog_request(jsonb) from public;
grant execute on function public.catalog_request(jsonb) to anon, authenticated;

/*
 * Lista de encomenda do fornecedor (colada do WhatsApp e conferida na tela):
 * publica tudo numa transação só.
 *   p = { supplier, lead, replace,
 *         items: [{ product_id, storage, color, size, condition, cost, price }] }
 * Cada item acha (ou cria) a variação e liga a oferta de encomenda com o
 * preço de venda e o custo do fornecedor. `replace`: o que estava na lista
 * anterior DESTE fornecedor e não veio agora sai da encomenda.
 * Devolve { created, updated, removed }.
 */
create or replace function public.import_order_list(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_supplier text := nullif(left(btrim(coalesce(p ->> 'supplier', '')), 120), '');
  v_lead     text := nullif(left(btrim(coalesce(p ->> 'lead', '')), 40), '');
  v_it       jsonb;
  v_pid      uuid;
  v_vid      uuid;
  v_ids      uuid[] := '{}';
  v_existed  boolean;
  v_created  int := 0;
  v_updated  int := 0;
  v_removed  int := 0;
  v_price    numeric;
begin
  perform public.require_member();
  if jsonb_typeof(p -> 'items') is distinct from 'array' or jsonb_array_length(p -> 'items') = 0 then
    raise exception 'A lista não tem nenhum item para publicar.';
  end if;
  if jsonb_array_length(p -> 'items') > 500 then
    raise exception 'Lista grande demais (máximo 500 itens por vez).';
  end if;

  for v_it in select * from jsonb_array_elements(p -> 'items') loop
    v_pid := nullif(v_it ->> 'product_id', '')::uuid;
    if v_pid is null or not exists (select 1 from public.products where id = v_pid) then
      raise exception 'Um item da lista aponta para um modelo que não existe mais. Leia a lista de novo.';
    end if;
    v_price := round(coalesce((v_it ->> 'price')::numeric, 0), 2);
    if v_price <= 0 then
      raise exception 'Todo item precisa de valor de venda maior que zero (%).', coalesce(v_it ->> 'storage', '');
    end if;
    v_existed := exists (
      select 1 from public.product_variants
       where product_id = v_pid
         and lower(btrim(storage)) = lower(btrim(coalesce(v_it ->> 'storage', '')))
         and lower(btrim(color)) = lower(btrim(coalesce(v_it ->> 'color', '')))
         and lower(btrim(size)) = lower(btrim(coalesce(v_it ->> 'size', '')))
         and lower(btrim(condition)) = lower(coalesce(nullif(btrim(v_it ->> 'condition'), ''), 'Lacrado')));
    -- variação nova nasce com preço de pronta entrega 0 (sem estoque) e só a oferta de encomenda
    v_vid := public._variant_find_or_create(v_pid, v_it ->> 'storage', v_it ->> 'color', v_it ->> 'size',
                                            v_it ->> 'condition', 0);
    update public.product_variants set
      on_order = true,
      order_price = v_price,
      order_cost = greatest(round(coalesce((v_it ->> 'cost')::numeric, 0), 4), 0),
      order_lead = coalesce(v_lead, order_lead),
      order_supplier = coalesce(v_supplier, order_supplier),
      order_updated_at = now(),
      active = true,
      show_in_catalog = true
    where id = v_vid;
    v_ids := v_ids || v_vid;
    if v_existed then v_updated := v_updated + 1; else v_created := v_created + 1; end if;
  end loop;

  if coalesce((p ->> 'replace')::boolean, false) then
    update public.product_variants set on_order = false, order_updated_at = now()
     where on_order and not (id = any(v_ids))
       and coalesce(order_supplier, '') = coalesce(v_supplier, '');
    get diagnostics v_removed = row_count;
  end if;

  return jsonb_build_object('created', v_created, 'updated', v_updated, 'removed', v_removed);
end;
$$;

revoke all on function public.import_order_list(jsonb) from public, anon;
grant execute on function public.import_order_list(jsonb) to authenticated;

-- =====================================================================
--  MIGRAÇÃO DOS PEDIDOS DA v1 (idempotente)
-- =====================================================================
--
--  Na v1, itens e pagamentos moravam em JSON dentro do pedido. Aqui cada
--  pedido ainda não migrado ganha as linhas em order_items/payments e o
--  cliente cadastrado. O JSON original NÃO é apagado. Pedidos antigos não
--  mexem no estoque (o estoque não existia quando foram vendidos).
--  Os totais têm que bater: o teste tests/db confere pedido a pedido.

create or replace function public._migrate_legacy_orders()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  o     public.orders;
  it    jsonb;
  pay   jsonb;
  v_pos int;
  v_n   int := 0;
  v_pid uuid;
  v_cat uuid;
  v_cust uuid;
begin
  -- A migração copia como era: sem as regras novas do fiado (ver orders_compute_totals).
  perform set_config('i7even.migrating', 'on', true);
  for o in select * from public.orders where not legacy_migrated order by created_at, id for update loop
    v_pos := 0;
    for it in select value from jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) loop
      v_pos := v_pos + 1;
      select id, category_id into v_pid, v_cat from public.products where slug = nullif(it ->> 'productId', '');
      if v_cat is null then
        select id into v_cat from public.categories where slug = nullif(it ->> 'categoryId', '');
      end if;
      insert into public.order_items (order_id, position, product_id, category_id, product_name, storage, color, size,
                                      band, condition, origin, qty, unit_price, unit_cost, serial, warranty_days, note,
                                      legacy_product, legacy_category)
      values (
        o.id, v_pos, v_pid, v_cat,
        left(coalesce(nullif(btrim(it ->> 'productName'), ''), 'Item'), 120),
        nullif(left(btrim(coalesce(it ->> 'variant', '')), 60), ''),
        nullif(left(btrim(coalesce(it ->> 'color', '')), 60), ''),
        nullif(left(btrim(coalesce(it ->> 'size', '')), 30), ''),
        nullif(left(btrim(coalesce(it ->> 'band', '')), 60), ''),
        nullif(left(btrim(coalesce(it ->> 'condition', '')), 40), ''),
        nullif(left(btrim(coalesce(it ->> 'origin', '')), 40), ''),
        least(greatest(coalesce((it ->> 'qty')::numeric, 1)::int, 1), 999),
        greatest(coalesce((it ->> 'unitPrice')::numeric, 0), 0),
        greatest(coalesce((it ->> 'unitCost')::numeric, 0), 0),
        nullif(left(btrim(coalesce(it ->> 'serial', '')), 400), ''),
        least(greatest(coalesce((it ->> 'warrantyDays')::numeric, 0)::int, 0), 3650),
        nullif(left(btrim(coalesce(it ->> 'note', '')), 240), ''),
        nullif(left(it ->> 'productId', 60), ''),
        nullif(left(it ->> 'categoryId', 40), '')
      );
      v_pid := null; v_cat := null;
    end loop;

    for pay in select value from jsonb_array_elements(coalesce(o.payments, '[]'::jsonb)) loop
      continue when coalesce((pay ->> 'amount')::numeric, 0) = 0;
      insert into public.payments (id, order_id, paid_at, amount, method, note)
      values (
        case when (pay ->> 'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then (pay ->> 'id')::uuid else gen_random_uuid() end,
        o.id,
        case when (pay ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$' then (pay ->> 'date')::date else o.order_date end,
        round((pay ->> 'amount')::numeric, 2),
        nullif(left(btrim(coalesce(pay ->> 'method', '')), 40), ''),
        nullif(left(btrim(coalesce(pay ->> 'note', '')), 160), '')
      )
      on conflict (id) do nothing;
    end loop;

    v_cust := public._customer_resolve(jsonb_build_object(
      'customer_name', o.customer_name, 'customer_phone', o.customer_phone, 'customer_email', o.customer_email,
      'customer_doc', o.customer_doc, 'ship_cep', o.ship_cep, 'ship_street', o.ship_street, 'ship_number', o.ship_number,
      'ship_complement', o.ship_complement, 'ship_district', o.ship_district, 'ship_city', o.ship_city, 'ship_uf', o.ship_uf));

    -- updated_at muda aqui (o gatilho recalcula): quem estiver com o pedido
    -- aberto na versão antiga recebe o aviso de "alterado em outro aparelho".
    update public.orders set legacy_migrated = true, customer_id = coalesce(customer_id, v_cust) where id = o.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke all on function public._migrate_legacy_orders() from public, anon, authenticated;

/*
 * Itens da v1 guardavam o id do catálogo antigo ('iphone-15'). Quando o
 * modelo com esse slug existe (seed_catalogo.sql), o item passa a apontar
 * para ele - é o que põe as vendas antigas nos relatórios por modelo.
 */
create or replace function public._relink_legacy_items()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  update public.order_items oi
     set product_id = p.id, category_id = coalesce(oi.category_id, p.category_id)
    from public.products p
   where oi.product_id is null and oi.legacy_product is not null and p.slug = oi.legacy_product;
  get diagnostics v_n = row_count;
  update public.order_items oi
     set category_id = c.id
    from public.categories c
   where oi.category_id is null and oi.legacy_category is not null and c.slug = oi.legacy_category;
  return v_n;
end;
$$;

revoke all on function public._relink_legacy_items() from public, anon, authenticated;

-- =====================================================================
--  SEGURANÇA DAS TABELAS (RLS + permissões)
-- =====================================================================
--
--  Toda tabela: RLS ligado, uma política "só quem é da loja".
--  Tabelas mantidas por RPC (pedidos, itens, entradas, movimentos,
--  unidades) são só leitura para o navegador. Na variação, o saldo
--  (stock) não está na lista de colunas que o navegador pode alterar.

-- Nomes antigos (modelo "cada um vê o seu"), removidos na v1.
drop policy if exists "orders_select_own" on public.orders;
drop policy if exists "orders_insert_own" on public.orders;
drop policy if exists "orders_update_own" on public.orders;
drop policy if exists "orders_delete_own" on public.orders;

alter table public.orders enable row level security;
alter table public.orders force row level security;

drop policy if exists "orders_select_loja" on public.orders;
create policy "orders_select_loja" on public.orders
  for select to authenticated using (public.eh_membro());

drop policy if exists "orders_insert_loja" on public.orders;
create policy "orders_insert_loja" on public.orders
  for insert to authenticated with check (public.eh_membro() and user_id = (select auth.uid()));

drop policy if exists "orders_update_loja" on public.orders;
create policy "orders_update_loja" on public.orders
  for update to authenticated using (public.eh_membro()) with check (public.eh_membro());

drop policy if exists "orders_delete_loja" on public.orders;
create policy "orders_delete_loja" on public.orders
  for delete to authenticated using (public.eh_membro());

do $$
declare
  t text;
begin
  foreach t in array array[
    'store_settings', 'categories', 'suppliers', 'customers', 'products', 'product_variants', 'units',
    'stock_movements', 'order_items', 'payments', 'order_installments', 'purchases', 'purchase_items', 'client_errors',
    'catalog_requests'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists member_all on public.%I', t);
    execute format(
      'create policy member_all on public.%I for all to authenticated using ((select public.eh_membro())) with check ((select public.eh_membro()))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end;
$$;

-- Pedidos: desde a v2 só por RPC. O navegador lê e muda só a urgência.
revoke all on public.orders from anon;
revoke insert, update, delete, truncate, references, trigger on public.orders from authenticated;
grant select on public.orders to authenticated;
grant update (priority) on public.orders to authenticated;

-- leitura e escrita direta (cadastros simples)
grant select, insert, update, delete on public.categories, public.suppliers, public.customers, public.payments
  to authenticated;
grant select, update on public.store_settings to authenticated;

-- erros do aparelho: grava e lê; pedidos do catálogo: só nascem pela função catalog_request()
grant select, insert, delete on public.client_errors to authenticated;
grant select, update, delete on public.catalog_requests to authenticated;

-- modelos e variações: cadastra; o saldo só muda por entrada/venda/ajuste;
-- excluir só pelas funções (conferem o histórico)
grant select, insert on public.products, public.product_variants to authenticated;
grant update (category_id, name, brand, year, description, image_url, gallery, storages, colors, sizes, tracks_serial,
              show_in_catalog, featured, needs_review, notes, active)
  on public.products to authenticated;
grant update (storage, color, size, condition, price, cost, min_stock, barcode, image_url, show_in_catalog, active,
              on_order, order_price, order_cost, order_lead, order_supplier, order_updated_at)
  on public.product_variants to authenticated;

-- parcelas do fiado: nascem e mudam pelo save_order; a tela só marca "cobrei hoje"
grant select on public.order_installments to authenticated;
grant update (reminded_at) on public.order_installments to authenticated;

-- mantidas pelas funções: só leitura
grant select on public.units, public.stock_movements, public.order_items, public.purchases, public.purchase_items
  to authenticated;

-- ------------------------------------------- funções: tranca geral ------
-- O Supabase dá EXECUTE de toda função nova para "anon" e "public". Aqui a
-- porta fecha para todas e só reabre para as quatro que o mundo pode chamar
-- (o teste tests/db confere a lista exata - função nova aberta por engano
-- faz o teste falhar):
--   keepalive          sinal de vida (GitHub Actions), não devolve dado
--   public_catalog     o catálogo (só campos públicos)
--   catalog_request    o pedido do catálogo (preço do banco, freio anti-robô)
--   log_client_error   erros do celular do cliente (com teto)
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end;
$$;

grant execute on function public.keepalive() to anon, authenticated;
grant execute on function public.public_catalog() to anon, authenticated;
grant execute on function public.catalog_request(jsonb) to anon, authenticated;
grant execute on function public.log_client_error(jsonb) to anon, authenticated;

-- =====================================================================
--  VIEWS DE RELATÓRIO (a partir das tabelas novas)
-- =====================================================================

drop view if exists public.order_items_view;
create view public.order_items_view
with (security_invoker = true) as
select
  o.id as order_id, o.code, o.status, o.order_date, o.customer_name,
  oi.category_id, c.name as category_name, oi.product_id, oi.variant_id, oi.product_name,
  oi.storage, oi.color, oi.condition, oi.qty, oi.unit_price, oi.unit_cost,
  oi.qty * oi.unit_price as line_total
from public.orders o
join public.order_items oi on oi.order_id = o.id
left join public.categories c on c.id = oi.category_id;

grant select on public.order_items_view to authenticated;

drop view if exists public.order_payments_view;
create view public.order_payments_view
with (security_invoker = true) as
select
  o.id as order_id, o.code, o.customer_name, o.status, o.total as total_do_pedido,
  p.id as payment_id, p.paid_at as recebido_em, p.amount as valor, p.method as forma, p.note as observacao
from public.orders o
join public.payments p on p.order_id = o.id;

grant select on public.order_payments_view to authenticated;

-- Views nascem com a permissão padrão do Supabase para anon: fecha (o teste confere).
revoke all on public.order_items_view, public.order_payments_view from anon, public;

-- =====================================================================
--  FOTOS DOS PRODUTOS (Supabase Storage)
-- =====================================================================
--  Bucket público para LEITURA (a foto aparece no app e no catálogo sem
--  login); só quem é da loja envia, troca ou apaga. As fotos são reduzidas
--  no aparelho (~100 KB) antes de subir - o plano grátis tem 1 GB.

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('produtos', 'produtos', true, 1048576, array['image/webp', 'image/jpeg', 'image/png'])
    on conflict (id) do update set public = true, file_size_limit = 1048576,
      allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png'];

    -- Apagar uma foto pela API exige poder "enxergar" o arquivo (select) além do delete.
    execute 'drop policy if exists produtos_membro_select on storage.objects';
    execute 'create policy produtos_membro_select on storage.objects for select to authenticated
             using (bucket_id = ''produtos'' and public.eh_membro())';
    execute 'drop policy if exists produtos_membro_insert on storage.objects';
    execute 'create policy produtos_membro_insert on storage.objects for insert to authenticated
             with check (bucket_id = ''produtos'' and public.eh_membro())';
    execute 'drop policy if exists produtos_membro_update on storage.objects';
    execute 'create policy produtos_membro_update on storage.objects for update to authenticated
             using (bucket_id = ''produtos'' and public.eh_membro())';
    execute 'drop policy if exists produtos_membro_delete on storage.objects';
    execute 'create policy produtos_membro_delete on storage.objects for delete to authenticated
             using (bucket_id = ''produtos'' and public.eh_membro())';
  end if;
end;
$$;

-- =====================================================================
--  TEMPO REAL (celulares e computador sincronizados)
-- =====================================================================

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['orders', 'payments', 'order_installments', 'products', 'product_variants', 'units',
                             'categories', 'customers', 'suppliers', 'purchases', 'store_settings', 'catalog_requests'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;

-- =====================================================================
--  AUTORIZA OS DONOS E MIGRA OS PEDIDOS DA v1
-- =====================================================================
--  Roda depois de criar os usuários em Authentication → Users.
--  Rodar de novo não duplica nada.

insert into public.store_members (user_id, nome)
select u.id, d.nome
from auth.users u
join (values
  ('eder.pontes2014@gmail.com', 'Eder'),
  ('juluccas1609@gmail.com',    'Julie')
) as d(email, nome) on lower(d.email) = lower(u.email)
on conflict (user_id) do update set nome = excluded.nome;

select public._migrate_legacy_orders() as pedidos_migrados_agora, public._relink_legacy_items() as itens_ligados_ao_cadastro;

-- Conferência rápida - deve devolver as duas linhas, Eder e Julie:
--   select m.nome, u.email from public.store_members m join auth.users u on u.id = m.user_id;
