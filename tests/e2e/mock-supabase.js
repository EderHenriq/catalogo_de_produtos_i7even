/**
 * Substituto de assets/js/core/supabase.js nos testes de navegador.
 *
 * Imita o pedaço do supabase-js que o app usa e traduz cada chamada em SQL,
 * executado no PGlite do Node (window.__sql, exposto pelo Playwright) com o
 * papel "authenticated" de um membro da loja - ou seja: as telas rodam contra
 * o supabase/schema.sql DE VERDADE (RLS, gatilhos, funções, permissões).
 */

const ident = (s) => `"${String(s).replace(/"/g, '""')}"`;
const EMBED_FK = { order_items: 'order_id', payments: 'order_id', order_installments: 'order_id', purchase_items: 'purchase_id' };

function lit(v) {
  // Parâmetros: arrays viram literal de array do Postgres; objetos, JSON.
  if (Array.isArray(v)) return `{${v.map((x) => `"${String(x).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;
  if (v && typeof v === 'object') return JSON.stringify(v);
  return v;
}

async function run(sql, params = []) {
  const res = await window.__sql(sql, params.map(lit));
  if (res.error) return { data: null, error: res.error };
  return { data: res.rows, error: null };
}

class Query {
  constructor(table) {
    this.table = table;
    this.op = 'select';
    this.cols = '*';
    this.where = [];
    this.params = [];
    this.orders = [];
    this.limitN = null;
    this.offsetN = null;
    this.mode = 'many';
    this.returning = false;
  }
  p(v) { this.params.push(v); return `$${this.params.length}`; }
  select(cols = '*') { if (this.op === 'select') this.cols = cols; else this.returning = cols || '*'; return this; }
  insert(rows) { this.op = 'insert'; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
  upsert(rows, opts = {}) { this.op = 'upsert'; this.rows = Array.isArray(rows) ? rows : [rows]; this.conflict = opts.onConflict || 'id'; return this; }
  update(row) { this.op = 'update'; this.row = row; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c, v) { this.where.push(`${ident(c)} = ${this.p(v)}`); return this; }
  neq(c, v) { this.where.push(`${ident(c)} <> ${this.p(v)}`); return this; }
  gt(c, v) { this.where.push(`${ident(c)} > ${this.p(v)}`); return this; }
  gte(c, v) { this.where.push(`${ident(c)} >= ${this.p(v)}`); return this; }
  lt(c, v) { this.where.push(`${ident(c)} < ${this.p(v)}`); return this; }
  in(c, list) { this.where.push(`${ident(c)} = any(${this.p(list)})`); return this; }
  /** "a.gte.X,b.gt.0,c.in.(x,y)" → (a >= X or b > 0 or c = any(...)) */
  or(expr) {
    const parts = [];
    const re = /([a-z_]+)\.(eq|gte|gt|lt|lte|in)\.(\([^)]*\)|[^,]+)/g;
    let m;
    while ((m = re.exec(expr))) {
      const [, col, op, raw] = m;
      if (op === 'in') parts.push(`${ident(col)}::text = any(${this.p(raw.slice(1, -1).split(','))})`);
      else parts.push(`${ident(col)} ${{ eq: '=', gte: '>=', gt: '>', lt: '<', lte: '<=' }[op]} ${this.p(raw)}`);
    }
    this.where.push(`(${parts.join(' or ')})`);
    return this;
  }
  order(col, { ascending = true } = {}) { this.orders.push(`${ident(col)} ${ascending ? 'asc' : 'desc'}`); return this; }
  range(from, to) { this.offsetN = from; this.limitN = to - from + 1; return this; }
  limit(n) { this.limitN = n; return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }

  selectList(cols) {
    const parts = String(cols).split(',').map((s) => s.trim()).filter(Boolean);
    return parts.map((c) => {
      const m = /^([a-z_]+)\(\*\)$/.exec(c);
      if (m) {
        const fk = EMBED_FK[m[1]];
        return `(select coalesce(json_agg(e), '[]') from public.${ident(m[1])} e where e.${ident(fk)} = t.id) as ${ident(m[1])}`;
      }
      return c === '*' ? 't.*' : `t.${ident(c)}`;
    }).join(', ');
  }

  build() {
    const T = `public.${ident(this.table)}`;
    const W = this.where.length ? ` where ${this.where.join(' and ')}` : '';
    const ret = this.returning ? ` returning ${this.returning === '*' ? '*' : this.returning}` : '';
    if (this.op === 'select') {
      return `select ${this.selectList(this.cols)} from ${T} t${W}${this.orders.length ? ` order by ${this.orders.join(', ')}` : ''}`
        + `${this.limitN != null ? ` limit ${this.limitN}` : ''}${this.offsetN != null ? ` offset ${this.offsetN}` : ''}`;
    }
    if (this.op === 'insert' || this.op === 'upsert') {
      const cols = [...new Set(this.rows.flatMap((r) => Object.keys(r)))];
      const values = this.rows.map((r) => `(${cols.map((c) => (c in r ? this.p(r[c]) : 'default')).join(', ')})`).join(', ');
      const conflict = this.op === 'upsert'
        ? ` on conflict (${this.conflict}) do update set ${cols.filter((c) => c !== this.conflict).map((c) => `${ident(c)} = excluded.${ident(c)}`).join(', ')}` : '';
      return `insert into ${T} (${cols.map(ident).join(', ')}) values ${values}${conflict}${ret}`;
    }
    if (this.op === 'update') {
      const set = Object.entries(this.row).map(([c, v]) => `${ident(c)} = ${this.p(v)}`).join(', ');
      return `update ${T} set ${set}${W}${ret}`;
    }
    return `delete from ${T}${W}${ret}`;
  }

  then(resolve, reject) {
    return (async () => {
      const r = await run(this.build(), this.params);
      if (r.error) return r;
      const rows = r.data || [];
      if (this.mode === 'single') return rows.length ? { data: rows[0], error: null } : { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } };
      if (this.mode === 'maybe') return { data: rows[0] ?? null, error: null };
      return { data: rows, error: null };
    })().then(resolve, reject);
  }
}

const returnTypes = new Map();
async function rpc(fn, args = {}) {
  if (!returnTypes.has(fn)) {
    const r = await run(`select pg_get_function_result(p.oid) as t from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = $1 limit 1`, [fn]);
    returnTypes.set(fn, r.data?.[0]?.t || 'void');
  }
  const names = Object.keys(args);
  // jsonb (objeto ou lista de objetos) vai como JSON; lista simples (uuid[]) como array do Postgres.
  const params = names.map((k) => (Array.isArray(args[k]) && args[k].some((x) => x && typeof x === 'object') ? JSON.stringify(args[k]) : args[k]));
  const call = `public.${ident(fn)}(${names.map((k, i) => `${ident(k)} => $${i + 1}`).join(', ')})`;
  const t = returnTypes.get(fn);
  const sql = t === 'void' ? `select ${call}::text as v` : `select to_jsonb(${call}) as v`;
  const r = await run(sql, params);
  if (r.error) return r;
  return { data: t === 'void' ? null : r.data[0]?.v ?? null, error: null };
}

const listeners = [];
// teste: simula um evento de login/logout do Supabase (ex.: sessão encerrada)
window.__emitAuth = (event) => listeners.forEach((cb) => cb(event, event === 'SIGNED_OUT' ? null : session));
const session = { user: { email: window.__TEST_EMAIL || 'eder.pontes2014@gmail.com', last_sign_in_at: new Date().toISOString() } };

const client = {
  from: (t) => new Query(t),
  rpc,
  channel: () => ({ on() { return this; }, subscribe(cb) { setTimeout(() => cb('SUBSCRIBED'), 0); return this; } }),
  removeChannel() {},
  storage: {
    from: () => ({
      async upload(path, blob) {
        const buf = new Uint8Array(await blob.arrayBuffer());
        let bin = '';
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        await window.__upload(path, blob.type, btoa(bin));
        return { data: { path }, error: null };
      },
      async remove(paths) { await window.__removeUploads(paths); return { data: null, error: null }; },
      getPublicUrl: (path) => ({ data: { publicUrl: `https://teste.supabase.co/storage/v1/object/public/produtos/${path}` } }),
    }),
  },
  auth: {
    async getSession() { return { data: { session }, error: null }; },
    async getUser() { return { data: { user: session.user } }; },
    onAuthStateChange(cb) { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
    async signOut() { return { error: null }; },
    async updateUser() { return { error: null }; },
  },
};

export function fetchWithTimeout(...a) { return fetch(...a); }
export function getClient() { return client; }
export function resetClient() {}
export async function getSession() { return session; }
export async function getUser() { return session.user; }
export function onAuthChange(cb) { listeners.push(cb); return () => {}; }
export async function signIn() { return session; }
export async function signOut() {}
export async function signOutEverywhere() {}
export async function sendPasswordReset() {}
export async function updatePassword() {}
export function friendlyAuthError(e) { return String(e?.message || e); }
