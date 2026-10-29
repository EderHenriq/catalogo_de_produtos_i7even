/**
 * Repositório do sistema: uma cópia em memória do que a loja usa no dia a
 * dia, o que deixa busca, filtro, painel e relatório instantâneos no 4G.
 *
 * Regras:
 *   - este é o ÚNICO arquivo que fala com as tabelas do Supabase;
 *   - toda escrita vai ao banco primeiro; o cache só muda com a resposta;
 *   - estoque, pedidos e entradas só por RPC (o banco trava as linhas e
 *     confere o saldo - ver supabase/schema.sql);
 *   - banco em snake_case, app em camelCase: conversão só aqui;
 *   - PEDIDOS: carrega os últimos 12 meses + tudo que ainda está em aberto
 *     (funil ou saldo a receber). Período mais antigo (relatório "Tudo",
 *     ficha do cliente) é buscado na hora com ensureOrdersFrom(). Um pedido
 *     alterado é buscado sozinho (refreshOrder), nunca a lista inteira;
 *   - celulares e computador ficam em dia pelo realtime. O aviso de uma
 *     alteração feita AQUI é ignorado (já temos o dado);
 *   - REENVIO SEGURO: pedido novo nasce com um código do aparelho
 *     (clientRef) e pagamento com id do aparelho. Se a internet cai depois
 *     de o banco gravar, tocar "Salvar" de novo não duplica nada.
 */

import { getClient } from './supabase.js';
import { round2, variantLabel, stockLevel, planState } from './calc.js';
import { todayISO, addDays, uid, thumbPath, THUMB_PX } from './utils.js';
import { APP } from '../config.js';

const PAGE = 1000;         // limite padrão de linhas por resposta do PostgREST
const WINDOW_MONTHS = 12;  // pedidos carregados ao abrir
const OPEN_STATUSES = ['novo', 'aguardando', 'pago', 'preparo', 'enviado'];

const state = {
  loaded: false,
  loadedAt: 0,
  userEmail: '',
  memberName: '',
  settings: null,
  categories: [],
  products: [],
  variants: [],
  units: [],
  customers: [],
  suppliers: [],
  orders: [],
  ordersFrom: '',          // pedidos carregados a partir desta data (AAAA-MM-DD)
  purchases: [],
  catalogRequests: [],
};

let productIndex = new Map();
let variantIndex = new Map();
let categoryIndex = new Map();
let customerIndex = new Map();
let variantsByProduct = new Map();
let unitsByVariant = new Map();

/* ------------------------------------------------------------ eventos -- */

const listeners = new Set();

/** fn(changed: Set<string>) - nomes das coleções que mudaram. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(...names) {
  const set = new Set(names);
  for (const fn of listeners) {
    try { fn(set); } catch (err) { console.error('listener de dados falhou', err); }
  }
}

const requestListeners = new Set();
/** Avisa quando chega um pedido novo pelo catálogo (para o toast/aviso). */
export function onNewCatalogRequest(fn) {
  requestListeners.add(fn);
  return () => requestListeners.delete(fn);
}

/* ------------------------------------------------------- mapeamentos -- */

const num = (v) => Number(v) || 0;
const nul = (v) => {
  const s = typeof v === 'string' ? v.trim() : v;
  return s === '' || s === undefined ? null : s;
};
const str = (v) => (v == null ? '' : String(v));
const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
/** Data/hora do REST e do realtime chegam em formatos diferentes: compara pelo instante. */
const ts = (s) => (s ? Date.parse(String(s).replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')) : 0);

export const DEFAULT_WARRANTY = {
  Lacrado: 365, 'Novo (caixa aberta)': 180, Vitrine: 180, Seminovo: 90, 'CPO / Recondicionado': 180,
};

function settingsFromRow(r = {}) {
  return {
    storeName: r.store_name || APP.name,
    phone: r.phone || '',
    instagram: r.instagram || '',
    email: r.email || '',
    address: r.address || '',
    pixKey: r.pix_key || '',
    footerText: r.footer_text || '',
    defaultMarkupPct: r.default_markup_pct == null ? 20 : num(r.default_markup_pct),
    allowNegativeStock: !!r.allow_negative_stock,
    warrantyDays: r.warranty_days && typeof r.warranty_days === 'object' ? r.warranty_days : { ...DEFAULT_WARRANTY },
    catalogEnabled: !!r.catalog_enabled,
    catalogShowOutOfStock: r.catalog_show_out_of_stock !== false,
    catalogMessage: r.catalog_message || '',
    catalogInstallments: Number(r.catalog_installments) || 0,
    catalogCardFee: r.catalog_card_fee == null ? 0 : num(r.catalog_card_fee),
    updatedAt: r.updated_at,
  };
}

function colorPhotosFromRow(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw)
    .map(([k, v]) => [k, (Array.isArray(v) ? v : [v]).filter((u) => typeof u === 'string' && u)])
    .filter(([, v]) => v.length));
}

const SETTINGS_COLS = {
  storeName: 'store_name', phone: 'phone', instagram: 'instagram', email: 'email', address: 'address',
  pixKey: 'pix_key', footerText: 'footer_text', defaultMarkupPct: 'default_markup_pct',
  allowNegativeStock: 'allow_negative_stock', warrantyDays: 'warranty_days', catalogEnabled: 'catalog_enabled',
  catalogShowOutOfStock: 'catalog_show_out_of_stock', catalogMessage: 'catalog_message',
  catalogInstallments: 'catalog_installments', catalogCardFee: 'catalog_card_fee',
};

const categoryFromRow = (r) => ({
  id: r.id, slug: r.slug || '', name: r.name, emoji: r.emoji || '', image: r.image || '',
  description: r.description || '', variantLabel: r.variant_label || 'Variação', colorLabel: r.color_label || 'Cor',
  sizeLabel: r.size_label || 'Tamanho', tracksSerial: !!r.tracks_serial, bands: Array.isArray(r.bands) ? r.bands : [],
  sort: r.sort ?? 100, active: r.active !== false,
});

const productFromRow = (r) => ({
  id: r.id, code: r.code, slug: r.slug || '', categoryId: r.category_id || null, name: r.name, brand: r.brand || '',
  year: r.year || null, description: r.description || '', imageUrl: r.image_url || '',
  gallery: Array.isArray(r.gallery) ? r.gallery.filter(Boolean) : [],
  // { cor: [url, ...] } - a primeira é a foto da cor; as outras, o carrossel daquela cor
  colorPhotos: colorPhotosFromRow(r.color_photos),
  storages: r.storages || [], colors: r.colors || [], sizes: r.sizes || [],
  tracksSerial: !!r.tracks_serial, showInCatalog: r.show_in_catalog !== false, featured: !!r.featured,
  needsReview: !!r.needs_review, notes: r.notes || '', active: r.active !== false,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

const variantFromRow = (r) => ({
  id: r.id, code: r.code, productId: r.product_id, storage: r.storage || '', color: r.color || '', size: r.size || '',
  condition: r.condition || 'Lacrado', price: num(r.price), cost: num(r.cost), stock: Number(r.stock) || 0,
  minStock: Number(r.min_stock) || 0, barcode: r.barcode || '', imageUrl: r.image_url || '',
  showInCatalog: r.show_in_catalog !== false, active: r.active !== false, createdAt: r.created_at, updatedAt: r.updated_at,
  onOrder: !!r.on_order, orderPrice: r.order_price == null ? 0 : num(r.order_price), orderCost: r.order_cost == null ? 0 : num(r.order_cost),
  orderLead: r.order_lead || '', orderSupplier: r.order_supplier || '', orderUpdatedAt: r.order_updated_at || null,
  orderQty: r.order_qty == null ? null : Number(r.order_qty),
});

const unitFromRow = (r) => ({
  id: r.id, variantId: r.variant_id, serial: r.serial || '', status: r.status, cost: num(r.cost), origin: r.origin || '',
  batteryHealth: r.battery_health ?? null, notes: r.notes || '', purchaseId: r.purchase_id || null,
  orderId: r.order_id || null, soldAt: r.sold_at, createdAt: r.created_at, updatedAt: r.updated_at,
});

const customerFromRow = (r) => ({
  id: r.id, name: r.name, phone: r.phone || '', email: r.email || '', doc: r.doc || '', instagram: r.instagram || '',
  cep: r.cep || '', street: r.street || '', number: r.number || '', complement: r.complement || '',
  district: r.district || '', city: r.city || '', uf: r.uf || '', birthday: r.birthday || '', notes: r.notes || '',
  active: r.active !== false, createdAt: r.created_at, updatedAt: r.updated_at,
});

const supplierFromRow = (r) => ({
  id: r.id, name: r.name, contactName: r.contact_name || '', phone: r.phone || '', city: r.city || '',
  notes: r.notes || '', active: r.active !== false,
});

/** Item do pedido no formato que as telas usam desde a v1 (`variant` = capacidade). */
const orderItemFromRow = (r) => ({
  id: r.id,
  position: r.position,
  productId: r.product_id || r.legacy_product || '',
  variantId: r.variant_id || null,
  categoryId: r.category_id || r.legacy_category || '',
  productName: r.product_name,
  variant: r.storage || '',
  color: r.color || '',
  size: r.size || '',
  band: r.band || '',
  condition: r.condition || '',
  origin: r.origin || '',
  serial: r.serial || '',
  unitIds: Array.isArray(r.unit_ids) ? r.unit_ids : [],
  qty: Number(r.qty) || 1,
  unitPrice: num(r.unit_price),
  unitCost: num(r.unit_cost),
  warrantyDays: Number(r.warranty_days) || 0,
  note: r.note || '',
  // custo gravado: mantido ao editar o pedido (a menos que o item mude)
  costSource: 'db',
});

const paymentFromRow = (r) => ({
  id: r.id, date: r.paid_at, amount: num(r.amount), method: r.method || '', note: r.note || '', createdAt: r.created_at,
});

const installmentFromRow = (r) => ({
  id: r.id, number: Number(r.number) || 0, dueDate: r.due_date, amount: num(r.amount), note: r.note || '',
  remindedAt: r.reminded_at || null,
});

function orderFromRow(r) {
  const items = (r.order_items || []).map(orderItemFromRow).sort((a, b) => a.position - b.position);
  const payments = (r.payments || []).map(paymentFromRow)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.createdAt).localeCompare(String(b.createdAt)));
  return {
    id: r.id,
    code: r.code,
    clientRef: r.client_ref || null,
    customerId: r.customer_id || null,
    customerName: r.customer_name ?? '',
    customerPhone: r.customer_phone ?? '',
    customerEmail: r.customer_email ?? '',
    customerDoc: r.customer_doc ?? '',
    channel: r.channel ?? '',
    status: r.status,
    priority: !!r.priority,
    items,
    payments,
    // fiado: o combinado (vencimentos); paga/atrasada sai de planState()
    plan: (r.order_installments || []).map(installmentFromRow)
      .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)) || a.number - b.number),
    handedOverAt: r.handed_over_at || null,
    notes: r.notes ?? '',
    orderDate: r.order_date,
    dueDate: r.due_date,
    deliveredAt: r.delivered_at,
    paymentMethod: r.payment_method ?? '',
    paymentStatus: r.payment_status ?? 'pendente',
    installments: r.installments ?? 1,
    paidAmount: num(r.paid_amount),
    discount: num(r.discount),
    shippingMethod: r.shipping_method ?? '',
    shippingCost: num(r.shipping_cost),
    shippingExpense: num(r.shipping_expense),
    trackingCode: r.tracking_code ?? '',
    shipCep: r.ship_cep ?? '',
    shipStreet: r.ship_street ?? '',
    shipNumber: r.ship_number ?? '',
    shipComplement: r.ship_complement ?? '',
    shipDistrict: r.ship_district ?? '',
    shipCity: r.ship_city ?? '',
    shipUf: r.ship_uf ?? '',
    subtotal: num(r.subtotal),
    costTotal: num(r.cost_total),
    total: num(r.total),
    profit: num(r.profit),
    balance: num(r.balance),
    stockApplied: !!r.stock_applied,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    createdByEmail: r.created_by_email ?? '',
  };
}

const purchaseFromRow = (r) => ({
  id: r.id, number: r.number, supplierId: r.supplier_id || null, supplierName: r.supplier_name || '',
  date: r.purchase_date, invoiceRef: r.invoice_ref || '', currency: r.currency || 'BRL', exchangeRate: num(r.exchange_rate) || 1,
  freight: num(r.freight), otherCosts: num(r.other_costs), itemsTotal: num(r.items_total), total: num(r.total),
  status: r.status, notes: r.notes || '', createdAt: r.created_at,
  items: (r.purchase_items || []).sort((a, b) => a.position - b.position).map((i) => ({
    id: i.id, variantId: i.variant_id || null, description: i.description, qty: Number(i.qty) || 1,
    unitCostInput: num(i.unit_cost_input), unitCost: num(i.unit_cost), salePrice: i.sale_price == null ? null : num(i.sale_price),
    serials: i.serials || [],
  })),
});

const requestFromRow = (r) => ({
  id: r.id, number: r.number, createdAt: r.created_at, customerName: r.customer_name, customerPhone: r.customer_phone || '',
  notes: r.notes || '', total: num(r.total), status: r.status, orderId: r.order_id || null,
  items: (r.items || []).map((i) => ({
    variantId: i.variant_id, name: i.name, qty: Number(i.qty) || 1, unitPrice: num(i.unit_price), available: i.available !== false,
    mode: i.mode === 'encomenda' ? 'encomenda' : 'pronta', lead: i.lead || '',
  })),
});

/* ------------------------------------------------------------ leitura -- */

/** Lê todas as páginas. `filter` recebe a consulta e devolve a consulta filtrada. */
async function readAll(table, select = '*', order = null, filter = null) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    let q = getClient().from(table).select(select);
    if (filter) q = filter(q);
    if (order) q = q.order(order.col, { ascending: !!order.asc });
    q = q.range(from, from + PAGE - 1);
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}

function windowStart() {
  const d = new Date();
  d.setMonth(d.getMonth() - WINDOW_MONTHS);
  return todayISO(d);
}

const ORDER_SELECT = '*, order_items(*), payments(*), order_installments(*)';
const sortPt = (a, b) => String(a).localeCompare(String(b), 'pt-BR');

const LOADERS = {
  settings: async () => {
    const { data, error } = await getClient().from('store_settings').select('*').eq('id', 1).maybeSingle();
    if (error) throw error;
    state.settings = settingsFromRow(data || {});
  },
  categories: async () => {
    state.categories = (await readAll('categories', '*', { col: 'id', asc: true })).map(categoryFromRow)
      .sort((a, b) => a.sort - b.sort || sortPt(a.name, b.name));
    categoryIndex = new Map(state.categories.map((c) => [c.id, c]));
  },
  products: async () => {
    const [prods, vars] = await Promise.all([
      readAll('products', '*', { col: 'code', asc: true }),
      readAll('product_variants', '*', { col: 'code', asc: true }),
    ]);
    state.products = prods.map(productFromRow).sort((a, b) => sortPt(a.name, b.name));
    state.variants = vars.map(variantFromRow);
    reindexProducts();
  },
  units: async () => {
    state.units = (await readAll('units', '*', { col: 'created_at', asc: true })).map(unitFromRow);
    reindexUnits();
  },
  customers: async () => {
    state.customers = (await readAll('customers', '*', { col: 'id', asc: true })).map(customerFromRow)
      .sort((a, b) => sortPt(a.name, b.name));
    customerIndex = new Map(state.customers.map((c) => [c.id, c]));
  },
  suppliers: async () => {
    state.suppliers = (await readAll('suppliers', '*', { col: 'id', asc: true })).map(supplierFromRow)
      .sort((a, b) => sortPt(a.name, b.name));
  },
  orders: async () => {
    const from = state.ordersFrom || windowStart();
    const rows = await readAll('orders', ORDER_SELECT, { col: 'code', asc: false },
      (q) => q.or(`order_date.gte.${from},balance.gt.0,status.in.(${OPEN_STATUSES.join(',')})`));
    state.ordersFrom = from;
    state.orders = rows.map(orderFromRow);
  },
  purchases: async () => {
    state.purchases = (await readAll('purchases', '*, purchase_items(*)', { col: 'number', asc: false }))
      .map(purchaseFromRow);
  },
  catalogRequests: async () => {
    const since = addDays(new Date(), -60).toISOString();
    state.catalogRequests = (await readAll('catalog_requests', '*', { col: 'number', asc: false },
      (q) => q.or(`status.eq.novo,created_at.gte.${since}`))).map(requestFromRow);
  },
};

function reindexProducts() {
  productIndex = new Map(state.products.map((p) => [p.id, p]));
  variantIndex = new Map(state.variants.map((v) => [v.id, v]));
  variantsByProduct = new Map();
  for (const v of state.variants) {
    if (!variantsByProduct.has(v.productId)) variantsByProduct.set(v.productId, []);
    variantsByProduct.get(v.productId).push(v);
  }
  for (const list of variantsByProduct.values()) list.sort(compareVariants);
}

function reindexUnits() {
  unitsByVariant = new Map();
  for (const u of state.units) {
    if (!unitsByVariant.has(u.variantId)) unitsByVariant.set(u.variantId, []);
    unitsByVariant.get(u.variantId).push(u);
  }
}

/** Ordem das variações: a ordem das opções do modelo (128GB antes de 256GB), depois condição. */
function compareVariants(a, b) {
  const p = productIndex.get(a.productId);
  const idx = (list, v) => { const i = (list || []).indexOf(v); return i < 0 ? 999 : i; };
  return idx(p?.sizes, a.size) - idx(p?.sizes, b.size)
    || idx(p?.storages, a.storage) - idx(p?.storages, b.storage)
    || sortPt(a.storage, b.storage)
    || idx(p?.colors, a.color) - idx(p?.colors, b.color)
    || sortPt(a.color, b.color)
    || sortPt(a.condition, b.condition);
}

const inflight = new Map();

/** Recarrega coleções (sem repetir uma carga que já está em andamento). */
export async function reload(...names) {
  const list = names.length ? names : Object.keys(LOADERS);
  await Promise.all(list.map((n) => {
    if (!inflight.has(n)) inflight.set(n, LOADERS[n]().finally(() => inflight.delete(n)));
    return inflight.get(n);
  }));
  if (!names.length) state.loadedAt = Date.now();
  emit(...list);
}

/** Busca UM pedido (depois de salvar, receber, ou de um aviso de outro aparelho). */
export async function refreshOrder(id) {
  if (!id) return null;
  const { data, error } = await getClient().from('orders').select(ORDER_SELECT).eq('id', id).maybeSingle();
  if (error) throw error;
  const others = state.orders.filter((o) => o.id !== id);
  if (data) {
    const row = orderFromRow(data);
    const i = others.findIndex((o) => (o.code || 0) < (row.code || 0));
    others.splice(i < 0 ? others.length : i, 0, row);
  }
  state.orders = others;
  emit('orders');
  return data ? order(id) : null;
}

/**
 * Garante que os pedidos desde `fromISO` estão carregados (relatório "Tudo",
 * ficha do cliente). Devolve true se buscou algo.
 */
export async function ensureOrdersFrom(fromISO) {
  if (!state.ordersFrom || fromISO >= state.ordersFrom) return false;
  const until = state.ordersFrom;
  const rows = await readAll('orders', ORDER_SELECT, { col: 'code', asc: false },
    (q) => q.gte('order_date', fromISO).lt('order_date', until));
  const have = new Set(state.orders.map((o) => o.id));
  const older = rows.map(orderFromRow).filter((o) => !have.has(o.id));
  state.orders = [...state.orders, ...older].sort((a, b) => (b.code || 0) - (a.code || 0));
  state.ordersFrom = fromISO;
  emit('orders');
  return true;
}

export const ensureAllOrders = () => ensureOrdersFrom('0001-01-01');
export const ordersLoadedFrom = () => state.ordersFrom;
export const allOrdersLoaded = () => state.ordersFrom <= '0001-01-01';

/** "Quem sou eu" no banco: membro da loja? banco na versão certa? */
export async function whoami() {
  const { data, error } = await getClient().rpc('whoami');
  if (error) throw error;
  return data || {};
}

export async function loadAll({ userEmail = '', memberName = '' } = {}) {
  state.userEmail = userEmail;
  state.memberName = memberName;
  await reload();
  state.loaded = true;
  startRealtime();
}

export function isLoaded() { return state.loaded; }
export function msSinceLoad() { return state.loadedAt ? Date.now() - state.loadedAt : Infinity; }

export function reset() {
  stopRealtime();
  Object.assign(state, {
    loaded: false, loadedAt: 0, settings: null, categories: [], products: [], variants: [], units: [], customers: [],
    suppliers: [], orders: [], ordersFrom: '', purchases: [], catalogRequests: [],
  });
  productIndex = new Map(); variantIndex = new Map(); categoryIndex = new Map(); customerIndex = new Map();
  variantsByProduct = new Map(); unitsByVariant = new Map();
  emit('orders', 'products', 'customers');
}

/* ------------------------------------------------------------ getters -- */

export const settings = () => state.settings || settingsFromRow();
export const categories = () => state.categories;
export const category = (id) => categoryIndex.get(id) || null;
export const categoryBySlug = (slug) => state.categories.find((c) => c.slug === slug) || null;
export const products = () => state.products;
export const product = (id) => productIndex.get(id) || null;
export const variants = () => state.variants;
export const variant = (id) => variantIndex.get(id) || null;
export const variantsOf = (productId) => variantsByProduct.get(productId) || [];
export const units = () => state.units;
export const unitsOf = (variantId) => unitsByVariant.get(variantId) || [];
export const unit = (id) => state.units.find((u) => u.id === id) || null;
export const stockUnitsOf = (variantId) => unitsOf(variantId).filter((u) => u.status === 'estoque');
export const customersList = () => state.customers;
export const customer = (id) => customerIndex.get(id) || null;
export const suppliers = () => state.suppliers;
export const supplier = (id) => state.suppliers.find((s) => s.id === id) || null;
export const orders = () => state.orders;
export const order = (id) => state.orders.find((o) => o.id === id) || null;
export const purchases = () => state.purchases;
export const purchase = (id) => state.purchases.find((p) => p.id === id) || null;
export const catalogRequests = () => state.catalogRequests;
export const catalogRequest = (id) => state.catalogRequests.find((r) => r.id === id) || null;
export const userEmail = () => state.userEmail;
export const memberName = () => state.memberName;

/** "iPhone 15 · 256GB · Azul · Lacrado" */
export function variantTitle(v) {
  if (!v) return '';
  const p = product(v.productId);
  return [p?.name, variantLabel(v)].filter(Boolean).join(' · ');
}

/** Estoque de um modelo inteiro (soma das variações ativas). */
export function productStock(productId) {
  return variantsOf(productId).filter((v) => v.active).reduce((a, v) => a + Math.max(v.stock, 0), 0);
}

/** Faixa de preço de um modelo (variações ativas com preço). */
export function priceRange(productId) {
  const prices = variantsOf(productId).filter((v) => v.active && v.price > 0).map((v) => v.price);
  if (!prices.length) return null;
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

export function level(v) {
  return stockLevel(v.stock, v.minStock);
}

/** Variações ativas com estoque abaixo do mínimo (o painel avisa). */
export function lowStock() {
  return state.variants.filter((v) => {
    const p = product(v.productId);
    return v.active && p?.active && v.minStock > 0 && v.stock <= v.minStock;
  });
}

/** Valor do estoque a custo (aparelhos: soma do custo de cada unidade). */
export function stockValue() {
  let cost = 0;
  let sale = 0;
  let units = 0;
  for (const v of state.variants) {
    if (!v.active || v.stock <= 0) continue;
    const p = product(v.productId);
    if (!p?.active) continue;
    units += v.stock;
    sale += v.stock * v.price;
    cost += p.tracksSerial ? stockUnitsOf(v.id).reduce((a, u) => a + u.cost, 0) : v.stock * v.cost;
  }
  return { cost: round2(cost), sale: round2(sale), units };
}

/** Acha o aparelho pelo IMEI (em qualquer situação). */
export function findUnitBySerial(serial) {
  const s = String(serial || '').replace(/\s/g, '').toUpperCase();
  if (!s) return [];
  return state.units.filter((u) => u.serial.replace(/\s/g, '').toUpperCase().includes(s));
}

/** Pedidos de um cliente (por cadastro; pedidos antigos sem cadastro, pelo nome). */
export function ordersOfCustomer(c) {
  if (!c) return [];
  const name = String(c.name || '').trim().toLowerCase();
  return state.orders.filter((o) => (c.id && o.customerId === c.id) || (!o.customerId && o.customerName.trim().toLowerCase() === name));
}

/** Clientes com números (pedidos, quanto gastou, último pedido, quanto deve). */
export function customerStats() {
  const byId = new Map(state.customers.map((c) => [c.id, {
    ...c, orders: 0, spent: 0, owed: 0, lastAt: null,
  }]));
  for (const o of state.orders) {
    const entry = o.customerId ? byId.get(o.customerId) : null;
    if (!entry) continue;
    entry.orders += 1;
    if (o.status !== 'cancelado' && o.status !== 'orcamento') {
      entry.spent += o.total;
      entry.owed += o.balance;
    }
    if (!entry.lastAt || new Date(o.createdAt) > new Date(entry.lastAt)) entry.lastAt = o.createdAt;
  }
  return [...byId.values()].sort((a, b) => b.spent - a.spent || sortPt(a.name, b.name));
}

/* ------------------------------------------------------ fiado / a receber -- */

/** O pedido conta como "a receber"? (orçamento e cancelado não devem nada) */
export const owes = (o) => o.balance > 0.005 && o.status !== 'orcamento' && o.status !== 'cancelado';

/**
 * Parcelas do pedido com a situação de hoje. Pedido devendo sem combinado
 * vira uma "parcela" só, com o saldo, vencendo na previsão (ou na data do pedido).
 */
export function orderPlan(o, today = todayISO()) {
  if (o.plan?.length) return planState(o.plan, o.paidAmount, today);
  if (!owes(o)) return [];
  return planState([{ id: `saldo-${o.id}`, number: 1, dueDate: o.dueDate || o.orderDate, amount: o.total, note: '', synthetic: true }],
    o.paidAmount, today);
}

/**
 * Tudo que os clientes devem, parcela por parcela (só as que faltam).
 * [{ order, inst, open, status, dueDate, late, inDays }]
 */
export function receivables(today = todayISO()) {
  const out = [];
  for (const o of state.orders) {
    if (!owes(o)) continue;
    for (const inst of orderPlan(o, today)) {
      if (inst.status === 'paga') continue;
      out.push({ order: o, inst, open: inst.open, status: inst.status, dueDate: inst.dueDate, late: inst.late, inDays: inst.inDays });
    }
  }
  return out.sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)) || (a.order.code || 0) - (b.order.code || 0));
}

/** Resumo para o painel, o menu e os avisos. */
export function receivablesSummary(today = todayISO()) {
  const list = receivables(today);
  const sum = (xs) => round2(xs.reduce((a, x) => a + x.open, 0));
  const late = list.filter((x) => x.status === 'atrasada');
  const due = list.filter((x) => x.status === 'hoje');
  const week = list.filter((x) => x.status === 'aberta' && x.inDays <= 7);
  return {
    list,
    total: round2(state.orders.filter(owes).reduce((a, o) => a + o.balance, 0)),
    late: { n: late.length, sum: sum(late) },
    today: { n: due.length, sum: sum(due) },
    week: { n: week.length, sum: sum(week) },
    customers: new Set(list.map((x) => x.order.customerId || x.order.customerName)).size,
  };
}

/** Marca "cobrei hoje" nas parcelas (lembrete mandado no WhatsApp). */
export async function markReminded(ids) {
  const real = ids.filter(isUuid);
  if (!real.length) return;
  const { error } = await getClient().from('order_installments').update({ reminded_at: new Date().toISOString() }).in('id', real);
  if (error) throw error;
  const orderIds = new Set(state.orders.filter((o) => o.plan?.some((p) => real.includes(p.id))).map((o) => o.id));
  await Promise.all([...orderIds].map((id) => refreshOrder(id)));
}

/** Mais vendidos (unidades) nos últimos `days` dias, por modelo. */
export function salesRank(days = 60) {
  const since = todayISO(addDays(new Date(), -days));
  const map = new Map();
  for (const o of state.orders) {
    if (o.status === 'cancelado' || o.status === 'orcamento' || String(o.orderDate) < since) continue;
    for (const it of o.items) {
      const key = it.productId || it.productName;
      map.set(key, (map.get(key) || 0) + it.qty);
    }
  }
  return map;
}

/* ------------------------------------------------------------ escrita -- */

/*
 * "Silêncio" do realtime: depois de uma escrita daqui, os avisos dessa
 * coleção nos próximos segundos são o eco dela mesma - já recarregamos.
 */
const muted = new Map();
function mute(...names) {
  const until = Date.now() + 4000;
  names.forEach((n) => muted.set(n, until));
}
const isMuted = (n) => (muted.get(n) || 0) > Date.now();

async function rpc(fn, args) {
  const { data, error } = await getClient().rpc(fn, args);
  if (error) throw error;
  return data;
}

export async function saveSettings(patch) {
  mute('settings');
  const row = {};
  for (const [k, col] of Object.entries(SETTINGS_COLS)) {
    if (k in patch) row[col] = typeof patch[k] === 'string' ? nul(patch[k]) : patch[k];
  }
  if ('storeName' in patch && !row.store_name) row.store_name = APP.name;
  const { error } = await getClient().from('store_settings').update(row).eq('id', 1);
  if (error) throw error;
  await reload('settings');
}

/* ------------------------------------------------------- categorias -- */

export async function saveCategory(c) {
  mute('categories');
  const row = { name: String(c.name || '').trim(), emoji: nul(c.emoji), active: c.active !== false };
  for (const [k, col] of [['image', 'image'], ['description', 'description']]) if (k in c) row[col] = nul(c[k]);
  for (const [k, col] of [['variantLabel', 'variant_label'], ['colorLabel', 'color_label'], ['sizeLabel', 'size_label']]) {
    if (k in c) row[col] = String(c[k] || '').trim() || undefined;
  }
  if ('tracksSerial' in c) row.tracks_serial = !!c.tracksSerial;
  if ('bands' in c) row.bands = (c.bands || []).map((b) => String(b).trim()).filter(Boolean);
  if (!c.id) row.sort = (Math.max(0, ...state.categories.map((x) => x.sort)) || 0) + 10;
  Object.keys(row).forEach((k) => row[k] === undefined && delete row[k]);
  const q = c.id ? getClient().from('categories').update(row).eq('id', c.id) : getClient().from('categories').insert(row);
  const { data, error } = await q.select().single();
  if (error) throw error;
  await reload('categories');
  return category(data.id);
}

/** Exclui a categoria levando os produtos para `moveTo` (ou "Sem categoria"). */
export async function deleteCategory(id, moveTo = null) {
  mute('categories', 'products');
  const n = await rpc('delete_category', { p_id: id, p_move_to: moveTo || null });
  await reload('categories', 'products');
  return Number(n) || 0;
}

/** Nova ordem das categorias (lista inteira de ids, do primeiro ao último). */
export async function reorderCategories(ids) {
  mute('categories');
  const pos = new Map(ids.map((id, i) => [id, (i + 1) * 10]));
  state.categories.forEach((c) => { if (pos.has(c.id)) c.sort = pos.get(c.id); });
  state.categories.sort((a, b) => a.sort - b.sort || sortPt(a.name, b.name));
  emit('categories');
  try {
    await rpc('reorder_categories', { p_ids: ids });
  } finally {
    await reload('categories');
  }
}

/* ------------------------------------------------- modelos e variações -- */

const listOf = (a) => [...new Set((a || []).map((x) => String(x).trim()).filter(Boolean))];

export async function saveProduct(p) {
  mute('products');
  const row = {
    name: String(p.name || '').trim(),
    category_id: p.categoryId || null,
    brand: nul(p.brand),
    year: p.year ? Number(p.year) : null,
    description: nul(p.description),
    image_url: nul(p.imageUrl),
    gallery: (p.gallery || []).filter((u) => u && u !== p.imageUrl).slice(0, 8),
    storages: listOf(p.storages),
    colors: listOf(p.colors),
    sizes: listOf(p.sizes),
    tracks_serial: !!p.tracksSerial,
    show_in_catalog: p.showInCatalog !== false,
    featured: !!p.featured,
    needs_review: !!p.needsReview,
    notes: nul(p.notes),
    active: p.active !== false,
  };
  const q = p.id
    ? getClient().from('products').update(row).eq('id', p.id)
    : getClient().from('products').insert(row);
  const { data, error } = await q.select().single();
  if (error) throw error;
  await reload('products');
  return product(data.id);
}

/** Campos soltos de vários modelos (catálogo, ativo, categoria) de uma vez. */
export async function patchProducts(ids, fields) {
  if (!ids.length) return;
  mute('products');
  const row = {};
  if ('showInCatalog' in fields) row.show_in_catalog = !!fields.showInCatalog;
  if ('active' in fields) row.active = !!fields.active;
  if ('categoryId' in fields) row.category_id = fields.categoryId || null;
  if ('featured' in fields) row.featured = !!fields.featured;
  const { error } = await getClient().from('products').update(row).in('id', ids);
  if (error) throw error;
  await reload('products');
}

export async function deleteProduct(id) {
  mute('products');
  const photo = product(id)?.imageUrl;
  await rpc('delete_product', { p_id: id });
  await reload('products');
  if (photo) await deleteProductImage(photo);
}

function variantToRow(v, { creating }) {
  const row = {
    storage: String(v.storage || '').trim(),
    color: String(v.color || '').trim(),
    size: String(v.size || '').trim(),
    condition: String(v.condition || 'Lacrado').trim() || 'Lacrado',
    price: round2(num(v.price)),
    min_stock: Math.max(Math.trunc(num(v.minStock)), 0),
    barcode: nul(v.barcode),
    image_url: nul(v.imageUrl),
    show_in_catalog: v.showInCatalog !== false,
    active: v.active !== false,
  };
  if ('cost' in v) row.cost = Math.max(num(v.cost), 0);
  if ('onOrder' in v) {
    row.on_order = !!v.onOrder;
    row.order_price = v.onOrder ? round2(num(v.orderPrice)) || null : (num(v.orderPrice) ? round2(num(v.orderPrice)) : null);
    row.order_cost = num(v.orderCost) ? Math.max(num(v.orderCost), 0) : null;
    row.order_lead = nul(v.orderLead);
    row.order_supplier = nul(v.orderSupplier);
    row.order_updated_at = new Date().toISOString();
  }
  if (creating) {
    row.product_id = v.productId;
    row.stock = Math.max(Math.trunc(num(v.stock)), 0);
  }
  return row;
}

/** Cadastra ou edita UMA variação. */
export async function saveVariant(v) {
  mute('products');
  const creating = !v.id;
  const row = variantToRow(v, { creating });
  const q = creating
    ? getClient().from('product_variants').insert(row)
    : getClient().from('product_variants').update(row).eq('id', v.id);
  const { data, error } = await q.select().single();
  if (error) throw error;
  await reload('products');
  return variant(data.id);
}

/** Várias variações novas de uma vez (o gerador "capacidades × cores"). */
export async function createVariants(productId, list) {
  if (!list.length) return [];
  mute('products');
  const rows = list.map((v) => variantToRow({ ...v, productId }, { creating: true }));
  const { data, error } = await getClient().from('product_variants').insert(rows).select();
  if (error) throw error;
  await reload('products');
  return (data || []).map((r) => variant(r.id));
}

/** Mostra/esconde/ativa várias variações de uma vez. */
export async function patchVariants(ids, fields) {
  if (!ids.length) return;
  mute('products');
  const row = {};
  if ('showInCatalog' in fields) row.show_in_catalog = !!fields.showInCatalog;
  if ('active' in fields) row.active = !!fields.active;
  const { error } = await getClient().from('product_variants').update(row).in('id', ids);
  if (error) throw error;
  await reload('products');
}

export async function deleteVariant(id) {
  mute('products');
  await rpc('delete_variant', { p_id: id });
  await reload('products');
}

/** Reajuste em lote: [{ variantId, price }] numa transação. @returns quantos mudaram */
export async function setPrices(items) {
  if (!items.length) return 0;
  mute('products');
  const n = await rpc('set_prices', { p_items: items.map((i) => ({ variant_id: i.variantId, price: round2(num(i.price)) })) });
  await reload('products');
  return Number(n) || 0;
}

/**
 * Lista de encomenda do fornecedor (lida em core/order-list.js e conferida
 * na tela): publica tudo numa transação. @returns {{created, updated, removed}}
 */
/**
 * Lista colada do WhatsApp → catálogo. mode 'pronta' (a lista da loja:
 * preço + estoque, aparelho sem IMEI) ou 'encomenda' (lista do fornecedor).
 */
export async function importOrderList({ mode = 'encomenda', supplier = '', lead = '', replace = false, items = [] }) {
  mute('products', 'units');
  const res = await rpc('import_order_list', { p: {
    mode: mode === 'pronta' ? 'pronta' : 'encomenda',
    supplier: str(supplier).trim(), lead: str(lead).trim(), replace: !!replace,
    items: items.map((it) => ({
      product_id: it.productId, storage: str(it.storage), color: str(it.color), size: str(it.size),
      condition: str(it.condition) || 'Lacrado', cost: Math.max(num(it.cost), 0), price: round2(num(it.price)),
      qty: it.qty ? Math.min(Math.max(Math.trunc(num(it.qty)), 1), 99) : null,
    })),
  } });
  await reload('products', 'units');
  return res || { created: 0, updated: 0, removed: 0, units: 0 };
}

/** Tira variações da encomenda (uma, várias ou a lista inteira de um fornecedor). */
export async function clearOrderOffers(ids) {
  if (!ids.length) return;
  mute('products');
  const { error } = await getClient().from('product_variants')
    .update({ on_order: false, order_updated_at: new Date().toISOString() }).in('id', ids);
  if (error) throw error;
  await reload('products');
}

/**
 * Foto por cor: a foto escolhida numa variação vale para as outras da
 * mesma cor do modelo que ainda estão sem foto (128GB, 256GB, seminovo,
 * sob encomenda...). Devolve quantas ganharam a foto.
 */
export async function applyColorPhoto(productId, color, url) {
  const ids = state.variants.filter((v) => v.productId === productId && v.color === color && !v.imageUrl).map((v) => v.id);
  if (!url || !color || !ids.length) return 0;
  mute('products');
  const { error } = await getClient().from('product_variants').update({ image_url: url }).in('id', ids);
  if (error) throw error;
  await reload('products');
  return ids.length;
}

/**
 * Foto de uma cor do modelo ("Fotos por cor" na ficha): fica no MODELO e vale
 * para toda variação dessa cor - pronta entrega, encomenda, lista do WhatsApp -
 * até as que ainda vão ser criadas. Foto própria de uma variação continua
 * vencendo. url vazia tira a foto da cor.
 */
export async function setColorPhoto(productId, color, url) {
  const p = product(productId);
  if (!p || !color) return 0;
  const next = { ...(p.colorPhotos || {}) };
  if (url) next[color] = [url, ...(next[color] || []).filter((u) => u !== url)].slice(0, 8); else delete next[color];
  mute('products');
  const { error } = await getClient().from('products').update({ color_photos: next }).eq('id', productId);
  if (error) throw error;
  await reload('products');
  return state.variants.filter((v) => v.productId === productId && v.color === color).length;
}

/**
 * Fotos do modelo de uma vez (importar pasta de fotos): capa, fotos por cor
 * e cores novas. `reloadAfter: false` deixa para recarregar no fim do lote.
 */
export async function patchProductMedia(id, { imageUrl, colorPhotos, colors } = {}, { reloadAfter = true } = {}) {
  const row = {};
  if (imageUrl !== undefined) row.image_url = imageUrl || null;
  if (colorPhotos) row.color_photos = colorPhotos;
  if (colors) row.colors = listOf(colors);
  if (!Object.keys(row).length) return;
  mute('products');
  const { error } = await getClient().from('products').update(row).eq('id', id);
  if (error) throw error;
  if (reloadAfter) await reload('products');
}

/** A foto que a variação mostra: a dela, a da cor no modelo, ou a capa. */
export function variantPhoto(v) {
  const p = product(v?.productId);
  return v?.imageUrl || (v?.color && p?.colorPhotos?.[v.color]?.[0]) || p?.imageUrl || '';
}

/** Ajusta o valor de venda de uma oferta de encomenda (sem mexer no resto). */
export async function setOrderPrice(id, price) {
  const value = round2(num(price));
  if (!(value > 0)) throw new Error('Informe um valor de venda maior que zero.');
  mute('products');
  const { error } = await getClient().from('product_variants')
    .update({ order_price: value, order_updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
  await reload('products');
}

/** Variações sob encomenda (catálogo de encomenda). */
export function orderOffers() {
  return state.variants.filter((v) => v.onOrder && v.orderPrice > 0 && product(v.productId)?.active);
}

/** Variação já existente com a mesma combinação (evita duplicar). */
export function findVariant(productId, { storage = '', color = '', size = '', condition = 'Lacrado' } = {}) {
  const k = (s) => String(s || '').trim().toLowerCase();
  return variantsOf(productId).find((v) => k(v.storage) === k(storage) && k(v.color) === k(color)
    && k(v.size) === k(size) && k(v.condition) === k(condition)) || null;
}

/* ---------------------------------------------------------- estoque -- */

export async function adjustStock(variantId, newStock, note) {
  mute('products');
  await rpc('adjust_stock', { p_variant: variantId, p_new_stock: Math.trunc(newStock), p_note: note || null });
  await reload('products');
}

/** Aparelhos que já estão na loja (estoque inicial, troca, compra sem nota). */
export async function addUnits(variantId, list, note) {
  mute('products', 'units');
  const n = await rpc('add_units', {
    p_variant: variantId,
    p_units: list.map((u) => ({
      serial: String(u.serial || '').trim(), cost: num(u.cost), origin: nul(u.origin),
      battery_health: u.batteryHealth === '' || u.batteryHealth == null ? null : Number(u.batteryHealth), notes: nul(u.notes),
    })),
    p_note: note || null,
  });
  await reload('products', 'units');
  return Number(n) || 0;
}

export async function saveUnit(u) {
  mute('products', 'units', 'orders');
  await rpc('save_unit', {
    p: {
      id: u.id, serial: String(u.serial || '').trim(), cost: num(u.cost), origin: nul(u.origin),
      battery_health: u.batteryHealth === '' || u.batteryHealth == null ? null : Number(u.batteryHealth), notes: nul(u.notes),
    },
  });
  const orderId = unit(u.id)?.orderId;
  await reload('products', 'units');
  if (orderId) await refreshOrder(orderId).catch(() => {});
}

export async function discardUnit(id, note) {
  mute('products', 'units');
  await rpc('discard_unit', { p_id: id, p_note: note || null });
  await reload('products', 'units');
}

export async function restoreUnit(id) {
  mute('products', 'units');
  await rpc('restore_unit', { p_id: id });
  await reload('products', 'units');
}

/** Histórico de uma variação (entradas, vendas, ajustes). */
export async function variantMovements(variantId, limit = 80) {
  const { data, error } = await getClient().from('stock_movements')
    .select('*').eq('variant_id', variantId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data || []).map((m) => ({
    id: m.id, kind: m.kind, qty: m.qty, unitCost: num(m.unit_cost), unitId: m.unit_id, orderId: m.order_id,
    purchaseId: m.purchase_id, note: m.note || '', createdAt: m.created_at,
  }));
}

/* ------------------------------------------------------------- fotos -- */

/**
 * Foto do produto em alta: até 1600 px (nítida até na tela Retina do iPhone,
 * ~200-400 KB) e a miniatura de 720 px gerada da ORIGINAL (sem comprimir
 * duas vezes) para a grade do catálogo e as listas. O bucket aceita até
 * 1 MB: foto pesada demais desce a qualidade aos poucos até caber. Chrome e
 * Android geram WebP; o Safari do iPhone não sabe gerar WebP e sai JPEG - o
 * nome e o tipo do arquivo acompanham o que foi gerado de verdade.
 */
export async function uploadProductImage(file, { square = true, name = '' } = {}) {
  const blob = await compressImage(file, PHOTO_PX, 0.9, { square, maxBytes: 950000 });
  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
  // `name` fixo (importar pasta: o código do conteúdo) - a mesma foto cai no
  // mesmo arquivo; se ele já está no Storage, aproveita em vez de duplicar.
  const path = `p/${name || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`}.${ext}`;
  const bucket = getClient().storage.from(APP.photoBucket);
  const { error } = await bucket.upload(path, blob, { contentType: blob.type, cacheControl: '31536000', upsert: false });
  const exists = error && (String(error.statusCode) === '409' || /exist|duplicate/i.test(error.message || ''));
  if (error && !(name && exists)) throw error;
  // Miniatura (~15 KB) para listas e para a grade do catálogo no 4G do
  // cliente. Se falhar, nada quebra: a tela cai na foto grande.
  try {
    const small = await compressImage(file, THUMB_PX, 0.85, { square, maxBytes: 300000 });
    await bucket.upload(thumbPath(path), small, { contentType: small.type, cacheControl: '31536000', upsert: true });
  } catch (err) {
    console.warn('miniatura não foi gerada', err);
  }
  return bucket.getPublicUrl(path).data.publicUrl;
}

/**
 * Apaga uma foto do Storage (trocada ou removida). Foto usada por outro
 * modelo/variação/categoria fica. Falhar aqui não atrapalha nada.
 */
export async function deleteProductImage(url, { except = null } = {}) {
  const marker = `/object/public/${APP.photoBucket}/`;
  const i = String(url || '').indexOf(marker);
  if (i < 0) return;
  const used = state.products.some((p) => (p.imageUrl === url || p.gallery.includes(url) || Object.values(p.colorPhotos || {}).flat().includes(url)) && p.id !== except)
    || state.variants.some((v) => v.imageUrl === url && v.id !== except)
    || state.categories.some((c) => c.image === url && c.id !== except);
  if (used) return;
  const path = decodeURIComponent(url.slice(i + marker.length).split('?')[0]);
  try {
    await getClient().storage.from(APP.photoBucket).remove([path, thumbPath(path)]);
  } catch (err) {
    console.warn('não consegui apagar a foto antiga', err);
  }
}

/**
 * Reduz a foto no aparelho. `square`: enquadra num quadrado com fundo branco
 * (a foto inteira, sem cortar o aparelho) - é o formato da vitrine: todos os
 * cartões do catálogo ficam iguais, venha a foto em pé, deitada ou de print.
 */
const PHOTO_PX = 1600;

async function compressImage(file, max, quality, { square = false, maxBytes = 0 } = {}) {
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    // Safari antigo: createImageBitmap não lê alguns formatos - vai pelo <img>.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      bmp = img;
    } catch {
      throw new Error('Não consegui abrir esta imagem. Use uma foto JPG ou PNG (no iPhone, escolha pela Câmera ou pela Galeria).');
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
  const w = bmp.width;
  const h = bmp.height;
  // No quadrado a margem de respiro (6%) entra na conta: o lado final não passa de `max`.
  const scale = Math.min(1, (square ? max / 1.06 : max) / Math.max(w, h));
  const dw = Math.round(w * scale);
  const dh = Math.round(h * scale);
  const canvas = document.createElement('canvas');
  // Quadrado: lado = o maior lado + uma margem de respiro (6%).
  const side = Math.round(Math.max(dw, dh) * 1.06);
  canvas.width = square ? side : dw;
  canvas.height = square ? side : dh;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  // Fundo branco: PNG transparente virando JPEG ficaria com fundo preto.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, Math.round((canvas.width - dw) / 2), Math.round((canvas.height - dh) / 2), dw, dh);
  bmp.close?.();
  const encode = async (q) => {
    const out = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', q));
    if (out && out.type === 'image/webp') return out;
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', q));
  };
  let q = quality;
  let blob = await encode(q);
  while (blob && maxBytes && blob.size > maxBytes && q > 0.62) {
    q = Math.round((q - 0.07) * 100) / 100;
    blob = await encode(q);
  }
  if (!blob) throw new Error('Não consegui preparar a foto. Tente outra.');
  return blob;
}

/* ----------------------------------------------- clientes e fornecedores -- */

const CUSTOMER_COLS = {
  name: 'name', phone: 'phone', email: 'email', doc: 'doc', instagram: 'instagram', cep: 'cep', street: 'street',
  number: 'number', complement: 'complement', district: 'district', city: 'city', uf: 'uf', birthday: 'birthday',
  notes: 'notes', active: 'active',
};

export async function saveCustomer(c) {
  mute('customers');
  const row = {};
  for (const [k, col] of Object.entries(CUSTOMER_COLS)) if (k in c) row[col] = typeof c[k] === 'string' ? nul(c[k]) : c[k];
  if ('name' in c) row.name = String(c.name || '').trim();
  if (row.uf) row.uf = String(row.uf).toUpperCase().slice(0, 2);
  const q = c.id ? getClient().from('customers').update(row).eq('id', c.id) : getClient().from('customers').insert(row);
  const { data, error } = await q.select().single();
  if (error) throw error;
  await reload('customers');
  return customer(data.id);
}

export async function saveSupplier(s) {
  mute('suppliers');
  const row = {
    name: String(s.name || '').trim(), contact_name: nul(s.contactName), phone: nul(s.phone), city: nul(s.city),
    notes: nul(s.notes), active: s.active !== false,
  };
  const q = s.id ? getClient().from('suppliers').update(row).eq('id', s.id) : getClient().from('suppliers').insert(row);
  const { data, error } = await q.select().single();
  if (error) throw error;
  await reload('suppliers');
  return supplier(data.id);
}

/* ---------------------------------------------------------- pedidos -- */

export function newPaymentDraft(partial = {}) {
  return { id: uid(), date: todayISO(), amount: 0, method: '', note: '', ...partial };
}

export function newOrderDraft() {
  return {
    id: null,
    clientRef: uid(),
    customerId: null,
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    customerDoc: '',
    channel: 'Instagram',
    status: 'novo',
    priority: false,
    items: [],
    payments: [],
    plan: [],
    notes: '',
    orderDate: todayISO(),
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
    variantId: null,
    productName: '',
    variant: '',
    color: '',
    size: '',
    band: '',
    condition: 'Lacrado',
    origin: '',
    serial: '',
    unitIds: [],
    qty: 1,
    unitPrice: 0,
    unitCost: 0,
    costSource: 'auto',
    warrantyDays: 90,
    note: '',
    ...partial,
  };
}

/** Rascunho do formulário → o que a função save_order espera. */
function orderPayload(o) {
  const items = (o.items || []).map((it) => {
    const variantId = isUuid(it.variantId) ? it.variantId : null;
    const productId = !variantId && isUuid(it.productId) && product(it.productId) ? it.productId : null;
    const catalog = !!(variantId || productId);
    const out = {
      variant_id: variantId,
      product_id: productId,
      category_id: isUuid(it.categoryId) ? it.categoryId : null,
      product_name: String(it.productName || 'Item').trim().slice(0, 120) || 'Item',
      storage: str(it.variant).trim(),
      color: str(it.color).trim(),
      size: str(it.size).trim(),
      condition: str(it.condition).trim(),
      band: str(it.band).trim(),
      origin: str(it.origin).trim(),
      qty: Math.min(Math.max(Math.trunc(num(it.qty)) || 1, 1), 999),
      unit_price: round2(num(it.unitPrice)),
      unit_ids: (it.unitIds || []).filter(isUuid),
      serial: str(it.serial).trim(),
      warranty_days: Math.min(Math.max(Math.trunc(num(it.warrantyDays)), 0), 3650),
      note: str(it.note).trim(),
    };
    // Custo: item avulso leva o digitado; item do catálogo deixa o banco
    // calcular (custo médio / custo do aparelho), a não ser que o custo seja
    // o gravado (pedido antigo, intocado) ou digitado à mão.
    if (!catalog || it.costSource === 'db' || it.costSource === 'manual') out.unit_cost = Math.max(num(it.unitCost), 0);
    return out;
  });
  return {
    id: o.id || null,
    client_ref: o.id ? null : (o.clientRef || uid()),
    expected_updated_at: o.id ? o.updatedAt || null : null,
    status: o.status || 'novo',
    customer_id: isUuid(o.customerId) ? o.customerId : null,
    customer_name: str(o.customerName).trim(),
    customer_phone: str(o.customerPhone).trim(),
    customer_email: str(o.customerEmail).trim(),
    customer_doc: str(o.customerDoc).trim(),
    channel: str(o.channel).trim(),
    priority: !!o.priority,
    notes: str(o.notes).trim(),
    order_date: o.orderDate || todayISO(),
    due_date: o.dueDate || null,
    payment_method: str(o.paymentMethod).trim(),
    installments: Math.min(Math.max(Math.trunc(num(o.installments)) || 1, 1), 24),
    discount: round2(Math.max(num(o.discount), 0)),
    shipping_method: str(o.shippingMethod).trim(),
    shipping_cost: round2(Math.max(num(o.shippingCost), 0)),
    shipping_expense: round2(Math.max(num(o.shippingExpense), 0)),
    tracking_code: str(o.trackingCode).trim(),
    ship_cep: str(o.shipCep).trim(),
    ship_street: str(o.shipStreet).trim(),
    ship_number: str(o.shipNumber).trim(),
    ship_complement: str(o.shipComplement).trim(),
    ship_district: str(o.shipDistrict).trim(),
    ship_city: str(o.shipCity).trim(),
    ship_uf: str(o.shipUf).trim().toUpperCase().slice(0, 2),
    items,
    payments: (o.payments || []).filter((p) => num(p.amount) !== 0).map((p) => ({
      id: isUuid(p.id) ? p.id : uid(),
      paid_at: /^\d{4}-\d{2}-\d{2}$/.test(String(p.date || '')) ? p.date : todayISO(),
      amount: round2(num(p.amount)),
      method: str(p.method).trim(),
      note: str(p.note).trim(),
    })),
    plan: (o.plan || []).filter((x) => num(x.amount) > 0).map((x, i) => ({
      id: isUuid(x.id) ? x.id : uid(),
      number: Number.isFinite(Number(x.number)) ? Math.trunc(Number(x.number)) : i + 1,
      due_date: /^\d{4}-\d{2}-\d{2}$/.test(String(x.dueDate || '')) ? x.dueDate : todayISO(),
      amount: round2(num(x.amount)),
      note: str(x.note).trim(),
    })),
  };
}

/** Itens do pedido mexem em estoque: depois de gravar, recarrega o que mudou. */
async function afterOrderWrite(id, { stock = true } = {}) {
  const tasks = [refreshOrder(id)];
  if (stock) tasks.push(reload('products', 'units'));
  tasks.push(reload('customers'));
  await Promise.all(tasks);
}

/** Cria ou edita um pedido inteiro (itens, pagamentos, estoque) - save_order. */
export async function saveOrder(draft) {
  mute('products', 'units', 'customers');
  const row = await rpc('save_order', { p: orderPayload(draft) });
  await afterOrderWrite(row.id);
  return order(row.id);
}

export async function setOrderStatus(id, status) {
  mute('products', 'units');
  await rpc('set_order_status', { p_id: id, p_status: status });
  await afterOrderWrite(id);
  return order(id);
}

/** Cancela; com `refund` lança o estorno (dinheiro devolvido) na data de hoje. */
export async function cancelOrder(id, { refund = false } = {}) {
  mute('products', 'units');
  await rpc('cancel_order', { p_id: id, p_refund: !!refund, p_date: todayISO() });
  await afterOrderWrite(id);
  return order(id);
}

export async function deleteOrder(id) {
  mute('products', 'units');
  await rpc('delete_order', { p_id: id });
  state.orders = state.orders.filter((o) => o.id !== id);
  emit('orders');
  await reload('products', 'units');
}

export async function setPriority(id, priority) {
  const { error } = await getClient().from('orders').update({ priority: !!priority }).eq('id', id);
  if (error) throw error;
  return refreshOrder(id);
}

/** Pagamento lançado direto (ficha do pedido). O id nasce aqui: reenvio não duplica. */
export async function savePayment(orderId, p) {
  const row = {
    id: isUuid(p.id) ? p.id : uid(),
    order_id: orderId,
    paid_at: /^\d{4}-\d{2}-\d{2}$/.test(String(p.date || '')) ? p.date : todayISO(),
    amount: round2(num(p.amount)),
    method: nul(p.method),
    note: nul(p.note),
  };
  const { error } = await getClient().from('payments').upsert(row, { onConflict: 'id' });
  if (error) throw error;
  return refreshOrder(orderId);
}

export async function deletePayment(orderId, paymentId) {
  const { error } = await getClient().from('payments').delete().eq('id', paymentId);
  if (error) throw error;
  return refreshOrder(orderId);
}

/* --------------------------------------------------------- entradas -- */

export async function postPurchase(p) {
  mute('products', 'units', 'purchases');
  const row = await rpc('post_purchase', {
    p: {
      supplier_id: isUuid(p.supplierId) ? p.supplierId : null,
      supplier_name: str(p.supplierName).trim(),
      purchase_date: p.date || todayISO(),
      invoice_ref: str(p.invoiceRef).trim(),
      currency: p.currency === 'USD' ? 'USD' : 'BRL',
      exchange_rate: num(p.exchangeRate) || 1,
      freight: round2(num(p.freight)),
      other_costs: round2(num(p.otherCosts)),
      notes: str(p.notes).trim(),
      items: (p.items || []).map((it) => ({
        variant_id: isUuid(it.variantId) ? it.variantId : null,
        product_id: !isUuid(it.variantId) && isUuid(it.productId) ? it.productId : null,
        storage: str(it.storage), color: str(it.color), size: str(it.size), condition: str(it.condition),
        qty: Math.max(Math.trunc(num(it.qty)) || 1, 1),
        unit_cost: Math.max(num(it.unitCost), 0),
        sale_price: num(it.salePrice) > 0 ? round2(num(it.salePrice)) : null,
        units: it.units?.length ? it.units.map((u) => ({
          serial: str(u.serial).trim(), cost: u.cost === '' || u.cost == null ? null : num(u.cost),
          origin: nul(u.origin), battery_health: u.batteryHealth === '' || u.batteryHealth == null ? null : Number(u.batteryHealth),
          notes: nul(u.notes),
        })) : undefined,
      })),
    },
  });
  await reload('products', 'units', 'purchases');
  return purchase(row.id);
}

export async function cancelPurchase(id) {
  mute('products', 'units', 'purchases');
  await rpc('cancel_purchase', { p_id: id });
  await reload('products', 'units', 'purchases');
}

/* ------------------------------------------------- pedidos do catálogo -- */

export async function setCatalogRequest(id, { status, orderId }) {
  mute('catalogRequests');
  const row = {};
  if (status) row.status = status;
  if (orderId !== undefined) row.order_id = orderId || null;
  const { error } = await getClient().from('catalog_requests').update(row).eq('id', id);
  if (error) throw error;
  await reload('catalogRequests');
}

export async function deleteCatalogRequest(id) {
  mute('catalogRequests');
  const { error } = await getClient().from('catalog_requests').delete().eq('id', id);
  if (error) throw error;
  await reload('catalogRequests');
}

/* ---------------------------------------------------- erros do aparelho -- */

export async function sendErrors(rows) {
  const { error } = await getClient().from('client_errors').insert(rows);
  if (error) throw error;
}

export async function listErrors(limit = 30) {
  const { data, error } = await getClient().from('client_errors')
    .select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

export async function clearErrors() {
  const { error } = await getClient().from('client_errors').delete().gte('id', 0);
  if (error) throw error;
}

/* ----------------------------------------------------------- realtime -- */

const TABLE_TO_COLLECTION = {
  products: ['products'],
  product_variants: ['products'],
  units: ['units'],
  categories: ['categories'],
  customers: ['customers'],
  suppliers: ['suppliers'],
  purchases: ['purchases'],
  store_settings: ['settings'],
  catalog_requests: ['catalogRequests'],
};

let channel = null;
let channelUp = false;
let pending = new Set();
let pendingOrders = new Set();
let pendingTimer = null;
let reconnectTimer = null;

export const isRealtimeUp = () => channelUp;

/** Vários avisos seguidos (um pedido mexe em 5 variações) viram uma recarga só. */
function queueReload(names) {
  names.forEach((n) => pending.add(n));
  schedule();
}

function schedule() {
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    const list = [...pending].filter((n) => !isMuted(n));
    const ids = [...pendingOrders];
    pending = new Set();
    pendingOrders = new Set();
    if (list.length) reload(...list).catch((err) => console.warn('recarga pelo realtime falhou', err));
    ids.forEach((id) => refreshOrder(id).catch(() => {}));
  }, 400);
}

function onOrderChange(payload) {
  const id = payload.new?.id || payload.old?.id;
  if (!id) return;
  const cur = order(id);
  if (payload.eventType === 'DELETE') {
    if (cur) { state.orders = state.orders.filter((o) => o.id !== id); emit('orders'); }
    return;
  }
  // Eco da nossa própria gravação: já temos esta versão (ou uma mais nova).
  if (cur && ts(cur.updatedAt) >= ts(payload.new.updated_at)) return;
  // Pedido antigo, fora da janela carregada e sem pendência: não interessa agora.
  if (!cur && payload.new.order_date < state.ordersFrom && !(Number(payload.new.balance) > 0)
      && !OPEN_STATUSES.includes(payload.new.status)) return;
  pendingOrders.add(id);
  schedule();
}

function onTableChange(table, payload) {
  if (table === 'payments' || table === 'order_installments') {
    const orderId = payload.new?.order_id || payload.old?.order_id;
    if (orderId && order(orderId)) { pendingOrders.add(orderId); schedule(); }
    return;
  }
  if (table === 'catalog_requests' && payload.eventType === 'INSERT' && payload.new) {
    const req = requestFromRow(payload.new);
    requestListeners.forEach((fn) => { try { fn(req); } catch { /* ignore */ } });
  }
  queueReload(TABLE_TO_COLLECTION[table]);
}

function startRealtime() {
  if (channel) return;
  const ch = getClient().channel('i7even-sync');
  channel = ch;
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, onOrderChange);
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, (p) => onTableChange('payments', p));
  ch.on('postgres_changes', { event: '*', schema: 'public', table: 'order_installments' }, (p) => onTableChange('order_installments', p));
  for (const table of Object.keys(TABLE_TO_COLLECTION)) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => onTableChange(table, payload));
  }
  ch.subscribe((status) => {
    if (channel !== ch) return;
    if (status === 'SUBSCRIBED') {
      const wasDown = !channelUp;
      channelUp = true;
      // Voltou depois de cair: o que mudou nesse meio-tempo não chega pelo canal.
      if (wasDown && state.loaded && state.loadedAt && Date.now() - state.loadedAt > 3000) queueReload(Object.keys(LOADERS));
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      channelUp = false;
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => { stopRealtime(); if (state.loaded) startRealtime(); }, 5000);
    }
  });
}

function stopRealtime() {
  clearTimeout(reconnectTimer);
  channelUp = false;
  if (!channel) return;
  try { getClient().removeChannel(channel); } catch { /* cliente já derrubado */ }
  channel = null;
}

/**
 * Ao voltar para o app (celular desbloqueado) ou a cada tanto: se o canal
 * caiu, busca tudo de novo (o que mudou nesse meio-tempo não chegou).
 */
export function refreshIfStale(maxAgeMs = 120000) {
  if (!state.loaded) return Promise.resolve();
  if (channelUp && Date.now() - state.loadedAt < maxAgeMs) return Promise.resolve();
  return reload().catch((err) => console.warn('sincronização falhou', err));
}

/* ------------------------------------------------------------- backup -- */

/** Tudo o que está carregado, num JSON (Ajustes → Backup). Busca os pedidos antigos antes. */
export async function backupSnapshot() {
  await ensureAllOrders();
  return {
    app: 'i7even-pedidos',
    version: APP.version,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    categories: state.categories,
    products: state.products,
    variants: state.variants,
    units: state.units,
    customers: state.customers,
    suppliers: state.suppliers,
    orders: state.orders,
    purchases: state.purchases,
    catalogRequests: state.catalogRequests,
  };
}

/**
 * Restaura pedidos de um backup (v1 ou v2) como pedidos NOVOS, item por item
 * avulso (sem mexer em estoque). Usado só para trazer de volta o que foi apagado.
 */
export async function importOrders(list) {
  let n = 0;
  for (const o of list) {
    // Todo item volta como avulso (sem variação/aparelho): restaurar um
    // pedido não pode tirar do estoque de hoje o que já saiu lá atrás.
    const draft = {
      ...newOrderDraft(),
      ...o,
      id: null,
      // mesmo código do pedido original: restaurar duas vezes não duplica
      clientRef: isUuid(o.clientRef) ? o.clientRef : (isUuid(o.id) ? o.id : uid()),
      items: (o.items || []).map((it) => ({
        ...it, variantId: null, productId: '', unitIds: [], costSource: 'manual',
      })),
      payments: (o.payments || []).map((p) => ({ ...p, id: uid() })),
      plan: (o.plan || []).map((x) => ({ ...x, id: uid() })),
    };
    await rpc('save_order', { p: orderPayload(draft) });
    n += 1;
  }
  await reload('orders', 'customers');
  return n;
}
