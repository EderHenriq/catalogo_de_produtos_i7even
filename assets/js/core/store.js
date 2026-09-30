/**
 * Repositório de pedidos.
 *
 * Mantém uma cópia em memória de todos os pedidos do usuário (o volume de uma
 * loja cabe tranquilamente), o que deixa busca, filtro e relatório instantâneos.
 * Toda escrita vai ao Supabase primeiro e só depois atualiza o cache.
 */

import { getClient } from './supabase.js';
import { uid } from './utils.js';

const listeners = new Set();
let orders = [];
let loaded = false;
let realtimeChannel = null;
let inflight = null;       // carga em andamento — cliques repetidos reaproveitam
let lastLoadAt = 0;        // quando a última carga completa terminou (ms)
let realtimeUp = false;    // canal de realtime conectado agora?

/** E-mail de quem está logado — carimbado no pedido na hora de criar. */
let currentEmail = '';

export function setCurrentUser(email) {
  currentEmail = String(email || '');
}

/* ---------------------------------------------------------- mapeamento -- */

/** Linha do banco (snake_case) → objeto do app (camelCase). */
function fromRow(row) {
  return {
    id: row.id,
    code: row.code,
    customerName: row.customer_name ?? '',
    customerPhone: row.customer_phone ?? '',
    customerEmail: row.customer_email ?? '',
    customerDoc: row.customer_doc ?? '',
    channel: row.channel ?? '',
    status: row.status,
    priority: !!row.priority,
    items: Array.isArray(row.items) ? row.items : [],
    payments: Array.isArray(row.payments) ? row.payments : [],
    notes: row.notes ?? '',
    orderDate: row.order_date,
    dueDate: row.due_date,
    deliveredAt: row.delivered_at,
    paymentMethod: row.payment_method ?? '',
    paymentStatus: row.payment_status ?? 'pendente',
    installments: row.installments ?? 1,
    paidAmount: Number(row.paid_amount) || 0,
    discount: Number(row.discount) || 0,
    shippingMethod: row.shipping_method ?? '',
    shippingCost: Number(row.shipping_cost) || 0,
    shippingExpense: Number(row.shipping_expense) || 0,
    trackingCode: row.tracking_code ?? '',
    shipCep: row.ship_cep ?? '',
    shipStreet: row.ship_street ?? '',
    shipNumber: row.ship_number ?? '',
    shipComplement: row.ship_complement ?? '',
    shipDistrict: row.ship_district ?? '',
    shipCity: row.ship_city ?? '',
    shipUf: row.ship_uf ?? '',
    subtotal: Number(row.subtotal) || 0,
    costTotal: Number(row.cost_total) || 0,
    total: Number(row.total) || 0,
    profit: Number(row.profit) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdByEmail: row.created_by_email ?? '',
  };
}

/** Objeto do app → linha do banco. Campos calculados ficam de fora de propósito. */
function toRow(o) {
  const nullable = (v) => {
    const s = typeof v === 'string' ? v.trim() : v;
    return s === '' || s === undefined ? null : s;
  };
  return {
    customer_name: String(o.customerName || '').trim().slice(0, 120),
    customer_phone: nullable(o.customerPhone),
    customer_email: nullable(o.customerEmail),
    customer_doc: nullable(o.customerDoc),
    channel: nullable(o.channel),
    status: o.status || 'novo',
    priority: !!o.priority,
    items: (o.items || []).map(cleanItem),
    payments: (o.payments || []).map(cleanPayment),
    notes: nullable(o.notes),
    order_date: o.orderDate || null,
    due_date: nullable(o.dueDate),
    payment_method: nullable(o.paymentMethod),
    installments: Math.min(Math.max(Number(o.installments) || 1, 1), 24),
    // paid_amount e payment_status NÃO são enviados: o banco os calcula a
    // partir de `payments`. Mandar daqui só criaria divergência.
    discount: num(o.discount),
    shipping_method: nullable(o.shippingMethod),
    shipping_cost: num(o.shippingCost),
    shipping_expense: num(o.shippingExpense),
    tracking_code: nullable(o.trackingCode),
    ship_cep: nullable(o.shipCep),
    ship_street: nullable(o.shipStreet),
    ship_number: nullable(o.shipNumber),
    ship_complement: nullable(o.shipComplement),
    ship_district: nullable(o.shipDistrict),
    ship_city: nullable(o.shipCity),
    ship_uf: nullable(o.shipUf ? String(o.shipUf).toUpperCase().slice(0, 2) : ''),
  };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
}

/** Normaliza um item antes de gravar — evita lixo e campos inesperados no JSONB. */
function cleanItem(item) {
  const str = (v, max = 120) => (v ? String(v).slice(0, max) : '');
  return {
    id: item.id || uid(),
    categoryId: str(item.categoryId, 40),
    productId: str(item.productId, 60),
    productName: str(item.productName, 120),
    variant: str(item.variant, 60),
    color: str(item.color, 60),
    size: str(item.size, 30),
    band: str(item.band, 60),
    condition: str(item.condition, 40),
    origin: str(item.origin, 40),
    serial: str(item.serial, 40),
    qty: Math.min(Math.max(Number(item.qty) || 1, 1), 999),
    unitPrice: num(item.unitPrice),
    unitCost: num(item.unitCost),
    warrantyDays: Math.min(Math.max(Number(item.warrantyDays) || 0, 0), 3650),
    note: str(item.note, 240),
  };
}

/** Normaliza um lançamento de pagamento antes de gravar. */
function cleanPayment(p) {
  const str = (v, max = 60) => (v ? String(v).slice(0, max) : '');
  const data = String(p.date || '').slice(0, 10);
  return {
    id: p.id || uid(),
    // guarda só AAAA-MM-DD; se vier lixo, cai para hoje
    date: /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : new Date().toISOString().slice(0, 10),
    amount: num(p.amount),
    method: str(p.method, 40),
    note: str(p.note, 160),
  };
}

export function newPaymentDraft(partial = {}) {
  return {
    id: uid(),
    date: new Date().toISOString().slice(0, 10),
    amount: 0,
    method: '',
    note: '',
    ...partial,
  };
}

export function newOrderDraft() {
  return {
    id: null,
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    customerDoc: '',
    channel: 'Instagram',
    status: 'novo',
    priority: false,
    items: [],
    payments: [],
    notes: '',
    orderDate: new Date().toISOString().slice(0, 10),
    dueDate: '',
    paymentMethod: 'PIX',
    paymentStatus: 'pendente',
    installments: 1,
    paidAmount: 0,
    discount: 0,
    shippingMethod: 'Retirada na loja',
    shippingCost: 0,
    shippingExpense: 0,
    trackingCode: '',
    shipCep: '',
    shipStreet: '',
    shipNumber: '',
    shipComplement: '',
    shipDistrict: '',
    shipCity: '',
    shipUf: '',
  };
}

export function newItemDraft(partial = {}) {
  return {
    id: uid(),
    categoryId: '',
    productId: '',
    productName: '',
    variant: '',
    color: '',
    size: '',
    band: '',
    condition: 'Lacrado',
    origin: '',
    serial: '',
    qty: 1,
    unitPrice: 0,
    unitCost: 0,
    warrantyDays: 90,
    note: '',
    ...partial,
  };
}

/* ----------------------------------------------------------- assinaturas */

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) {
    try { fn(orders); } catch (err) { console.error('listener do store falhou', err); }
  }
}

/* -------------------------------------------------------------- leitura */

export async function load({ force = false } = {}) {
  if (loaded && !force) return orders;
  if (inflight) return inflight;
  inflight = (async () => {
    const { data, error } = await getClient()
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    const next = (data || []).map(fromRow);
    const changed = !loaded || signature(next) !== signature(orders);
    orders = next;
    loaded = true;
    lastLoadAt = Date.now();
    // Só redesenha se algo mudou: a sincronização automática roda com
    // frequência e não deve piscar a tela (nem fechar menus abertos) à toa.
    if (changed) emit();
    return orders;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** Impressão digital barata da lista: id + última alteração de cada pedido. */
function signature(list) {
  let s = '';
  for (const o of list) s += `${o.id}:${o.updatedAt}|`;
  return s;
}

/** Milissegundos desde a última carga completa. */
export function msSinceLoad() {
  return lastLoadAt ? Date.now() - lastLoadAt : Infinity;
}

export function isRealtimeUp() {
  return realtimeUp;
}

export function all() {
  return orders;
}

export function isLoaded() {
  return loaded;
}

export function byId(id) {
  return orders.find((o) => o.id === id) || null;
}

export function reset() {
  orders = [];
  loaded = false;
  stopRealtime();
  emit();
}

/* --------------------------------------------------------------- escrita */

export async function create(order) {
  const row = toRow(order);
  // Só na criação: depois o carimbo não muda, mesmo se o outro dono editar.
  if (currentEmail) row.created_by_email = currentEmail;
  const { data, error } = await getClient()
    .from('orders')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  const saved = fromRow(data);
  orders = [saved, ...orders];
  emit();
  return saved;
}

export async function update(id, order) {
  let query = getClient().from('orders').update(toRow(order)).eq('id', id);
  // Trava contra edição simultânea: só grava se o pedido ainda estiver na
  // versão que foi aberta. Sem isto, a última pessoa a salvar apagaria em
  // silêncio o que a outra lançou (ex.: um pagamento) no mesmo pedido.
  if (order.updatedAt) query = query.eq('updated_at', order.updatedAt);
  const { data, error } = await query.select().maybeSingle();
  if (error) throw error;
  if (!data) {
    await load({ force: true }).catch(() => {});
    throw new Error(byId(id)
      ? 'Este pedido foi alterado em outro aparelho enquanto você editava. A tela já foi atualizada: abra o pedido de novo e refaça a alteração.'
      : 'Este pedido foi excluído em outro aparelho.');
  }
  const saved = fromRow(data);
  orders = orders.map((o) => (o.id === id ? saved : o));
  emit();
  return saved;
}

export async function save(order) {
  return order.id ? update(order.id, order) : create(order);
}

/** Atualização pontual de campos soltos (mudar status, marcar prioridade…). */
export async function patch(id, fields) {
  const current = byId(id);
  if (!current) throw new Error('Pedido não encontrado.');
  return update(id, { ...current, ...fields });
}

export async function remove(id) {
  const { error } = await getClient().from('orders').delete().eq('id', id);
  if (error) throw error;
  orders = orders.filter((o) => o.id !== id);
  emit();
}

export async function removeMany(ids) {
  const { error } = await getClient().from('orders').delete().in('id', ids);
  if (error) throw error;
  const set = new Set(ids);
  orders = orders.filter((o) => !set.has(o.id));
  emit();
}

export async function setStatus(id, status) {
  return patch(id, { status });
}

/* -------------------------------------------------------------- realtime */
/* Mantém a aba sincronizada se você mexer no pedido pelo celular. */

let reconnectTimer = null;

export function startRealtime() {
  if (realtimeChannel) return;
  const channel = getClient().channel('orders-sync');
  realtimeChannel = channel;
  channel
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
      if (payload.eventType === 'DELETE') {
        orders = orders.filter((o) => o.id !== payload.old.id);
      } else {
        const row = fromRow(payload.new);
        const exists = orders.some((o) => o.id === row.id);
        orders = exists ? orders.map((o) => (o.id === row.id ? row : o)) : [row, ...orders];
      }
      emit();
    })
    .subscribe((status) => {
      if (realtimeChannel !== channel) return; // aviso de um canal já descartado
      if (status === 'SUBSCRIBED') {
        const wasDown = !realtimeUp;
        realtimeUp = true;
        // Voltou depois de cair (celular bloqueado, troca de rede…): o que
        // mudou nesse meio-tempo não chega pelo canal, então busca tudo.
        if (wasDown && loaded) load({ force: true }).catch(() => {});
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        realtimeUp = false;
        scheduleReconnect();
      }
    });
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    stopRealtime();
    if (loaded) startRealtime();
  }, 5000);
}

export function stopRealtime() {
  clearTimeout(reconnectTimer);
  realtimeUp = false;
  if (!realtimeChannel) return;
  try { getClient().removeChannel(realtimeChannel); } catch { /* client já derrubado */ }
  realtimeChannel = null;
}

/* ---------------------------------------------------------------- extras */

/** Clientes distintos, para autocompletar no formulário. */
export function customers() {
  const map = new Map();
  for (const o of orders) {
    const key = o.customerName.trim().toLowerCase();
    if (!key) continue;
    const entry = map.get(key);
    if (!entry) {
      map.set(key, {
        name: o.customerName.trim(),
        phone: o.customerPhone,
        email: o.customerEmail,
        doc: o.customerDoc,
        cep: o.shipCep,
        street: o.shipStreet,
        number: o.shipNumber,
        complement: o.shipComplement,
        district: o.shipDistrict,
        city: o.shipCity,
        uf: o.shipUf,
        orders: 1,
        spent: o.status === 'cancelado' ? 0 : o.total,
        lastAt: o.createdAt,
      });
    } else {
      entry.orders += 1;
      if (o.status !== 'cancelado') entry.spent += o.total;
      if (new Date(o.createdAt) > new Date(entry.lastAt)) {
        entry.lastAt = o.createdAt;
        entry.phone = o.customerPhone || entry.phone;
      }
    }
  }
  return [...map.values()].sort((a, b) => b.spent - a.spent);
}

/** Substitui a base inteira (usado ao importar backup). */
export async function importOrders(list, { replace = false } = {}) {
  const supabase = getClient();
  if (replace && orders.length) {
    const { error } = await supabase.from('orders').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) throw error;
    orders = [];
  }
  const rows = list.map(toRow);
  const chunkSize = 200;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const { error } = await supabase.from('orders').insert(rows.slice(i, i + chunkSize));
    if (error) throw error;
  }
  await load({ force: true });
  return list.length;
}
