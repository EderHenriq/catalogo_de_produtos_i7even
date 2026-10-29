/**
 * Catálogo público da i7even (catalogo.html) - aberto sem login.
 *
 * Nunca lê tabela: só chama as duas funções públicas do banco
 * (public_catalog e catalog_request) por um fetch simples, com a mesma
 * publishable key do sistema. Custo, estoque exato e IMEI nunca chegam aqui.
 *
 * O cliente: busca ou filtra → toca no modelo → escolhe condição,
 * capacidade e cor (cada combinação com o seu preço e disponibilidade) →
 * sacola (guardada no celular dele) → "Enviar pelo WhatsApp": o pedido fica
 * registrado no sistema (preço do BANCO) e o WhatsApp da loja abre com a
 * mensagem pronta e o número do pedido.
 *
 * Links diretos: catalogo.html#p=<modelo> abre o modelo; #c=<categoria> filtra.
 */

import { getConfig, APP } from './config.js';
import { esc, money, maskPhone, onlyDigits, waNumber, thumbUrl } from './core/utils.js';
import { icon } from './ui/icons.js';

const ROOT = document.getElementById('catalog');
const BAG_KEY = 'i7even.catalog.bag';
const ME_KEY = 'i7even.catalog.me';
const PREF_KEY = 'i7even.catalog.prefs';
const TIMEOUT_MS = 12000;

const readJSON = (k, fb) => { try { return JSON.parse(localStorage.getItem(k)) || fb; } catch { return fb; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* modo privado */ } };

const st = {
  data: null,
  q: '',
  cat: '',
  // todos | lacrado | semi | cpo | aberta (COND_GROUPS)
  cond: ({ seminovo: 'semi' })[readJSON(PREF_KEY, {}).cond] || readJSON(PREF_KEY, {}).cond || 'todos',
  view: readJSON(PREF_KEY, {}).view === 'list' ? 'list' : 'grid',
  // todos | pronta (pronta entrega) | encomenda (sob encomenda)
  avail: readJSON(PREF_KEY, {}).avail || (readJSON(PREF_KEY, {}).onlyAvail ? 'pronta' : 'todos'),
  sort: readJSON(PREF_KEY, {}).sort || 'destaques',
  bag: readJSON(BAG_KEY, {}),                          // { "variantId|pronta": qty, "variantId|encomenda": qty }
  me: readJSON(ME_KEY, { name: '', phone: '' }),
};
let products = [];
const productIndex = new Map();
const variantIndex = new Map();   // variantId → { product, variant }

/* ------------------------------------------------------------ servidor -- */

async function rpc(fn, body) {
  const cfg = getConfig();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${cfg.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.message || `Erro ${res.status}`);
    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('A internet está lenta. Tente de novo em instantes.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* Erros do celular do cliente chegam no Diagnóstico do sistema (com teto no banco). */
const sentErrors = new Set();
function logError(err, context = {}) {
  const message = String(err?.message || err || '').slice(0, 300);
  const m = message.toLowerCase();
  if (!message || sentErrors.size >= 5 || sentErrors.has(message) || m.includes('failed to fetch') || m.includes('load failed')
      || m.includes('internet está lenta')) return;
  sentErrors.add(message);
  rpc('log_client_error', { p: {
    message, stack: String(err?.stack || '').slice(0, 1500), url: location.href.slice(0, 300),
    user_agent: navigator.userAgent.slice(0, 300), app_version: APP.version, context,
  } }).catch(() => {});
}
window.addEventListener('error', (e) => logError(e.error || e.message, { kind: 'error' }));
window.addEventListener('unhandledrejection', (e) => logError(e.reason, { kind: 'promise' }));

/* -------------------------------------------------------------- dados -- */

const isSemi = (v) => !/^lacrado$/i.test(v.condition || '');
const vLabel = (v) => [v.size, v.storage, v.color, v.condition].filter(Boolean).join(' · ');
const vTitle = (p, v) => [p.name, vLabel(v)].filter(Boolean).join(' · ');

/* Cada variação pode ter pronta entrega (estoque) e/ou encomenda (preço e prazo próprios). */
const hasReady = (v) => !!v.available && Number(v.ready_price ?? v.price) > 0;
const hasOrder = (v) => !!v.on_order && Number(v.order_price) > 0;
const modePrice = (v, mode) => Number(mode === 'encomenda' ? v.order_price : (v.ready_price ?? v.price)) || 0;
/** O modo que vale para a variação, respeitando o filtro de cima. */
function defaultMode(v) {
  if (st.avail === 'encomenda' && hasOrder(v)) return 'encomenda';
  return hasReady(v) ? 'pronta' : 'encomenda';
}
/** O preço que o cliente vê agora (com o filtro de cima). */
const shownPrice = (v) => modePrice(v, st.avail === 'todos' ? (hasReady(v) ? 'pronta' : 'encomenda') : defaultMode(v));
const bagKey = (id, mode) => `${id}|${mode}`;
/** Fotos de uma cor do modelo (o banco guarda uma url ou uma lista). */
const colorList = (p, color) => { const v = color ? p?.color_photos?.[color] : null; return (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean); };
const firstColorPhoto = (p) => Object.keys(p?.color_photos || {}).map((c) => colorList(p, c)[0]).find(Boolean) || '';

function index(data) {
  products = data.products || [];
  productIndex.clear();
  variantIndex.clear();
  for (const p of products) {
    productIndex.set(p.id, p);
    for (const v of p.variants || []) variantIndex.set(v.id, { product: p, variant: v });
  }
  // Sacola guardada: perde o que saiu do catálogo; pronta entrega que esgotou
  // vira encomenda (se houver a oferta) e vice-versa.
  const next = {};
  for (const [key, qty] of Object.entries(st.bag)) {
    const [id, m] = key.split('|');
    const x = variantIndex.get(id);
    if (!x || !(qty > 0)) continue;
    let mode = m === 'encomenda' ? 'encomenda' : m === 'pronta' ? 'pronta' : defaultMode(x.variant);
    if (mode === 'pronta' && !hasReady(x.variant)) mode = 'encomenda';
    if (mode === 'encomenda' && !hasOrder(x.variant)) mode = hasReady(x.variant) ? 'pronta' : '';
    if (!mode) continue;
    const k = bagKey(id, mode);
    next[k] = Math.min((next[k] || 0) + qty, 20);
  }
  if (JSON.stringify(next) !== JSON.stringify(st.bag)) { st.bag = next; writeJSON(BAG_KEY, st.bag); }
}

function savePrefs() {
  writeJSON(PREF_KEY, { cond: st.cond, avail: st.avail, sort: st.sort, view: st.view });
}

/* Cores de fábrica → bolinha de cor (o resto aparece só com o nome). */
const SWATCH = [
  [/meia-noite|midnight/i, '#232a31'], [/preto-espacial|space black/i, '#2e2c2b'], [/preto|black|grafite/i, '#1d1d1f'],
  [/estelar|starlight/i, '#f0e5d3'], [/branco|white|prateado|silver/i, '#f2f2f0'], [/titânio natural|natural/i, '#bab4a9'],
  [/titânio-deserto|deserto|desert/i, '#bfa48f'], [/titânio azul|azul-profundo|azul-sierra|azul-pacífico/i, '#3c4a5e'],
  [/titânio preto/i, '#3b3b3c'], [/titânio branco/i, '#ecebe7'], [/laranja|cósmico/i, '#e9733a'],
  [/dourado|gold/i, '#e9d3a8'], [/rosa|pink/i, '#f3c9cf'], [/roxo|lavanda|purple/i, '#c7bce3'],
  [/verde|green|sálvia|alpino/i, '#a8bfa3'], [/amarelo|yellow/i, '#f6e27a'], [/vermelho|red|product/i, '#c8232c'],
  [/azul|blue|ultramarino|teal|céu/i, '#7da2cf'], [/cinza|gray/i, '#8e8e93'],
];
const swatch = (name) => SWATCH.find(([re]) => re.test(name || ''))?.[1] || '';

/* --------------------------------------------------------------- shell -- */

/* Condição → grupo do filtro (Lacrado · Semi · CPO · Caixa aberta). A ordem importa: "Seminovo" antes de "novo". */
const COND_GROUPS = [
  ['lacrado', 'Lacrado', /^lacrad/i],
  ['cpo', 'CPO', /cpo|recondicionad/i],
  ['semi', 'Semi', /semi|usad|vitrine|swap/i],
  ['aberta', 'Caixa aberta', /caixa aberta|novo/i],
];
const condKey = (v) => (COND_GROUPS.find(([, , re]) => re.test(v.condition || '')) || ['outro'])[0];
const condLabel = (k) => COND_GROUPS.find((g) => g[0] === k)?.[1] || 'Outros';
const condOk = (v) => st.cond === 'todos' || condKey(v) === st.cond;

/** "ou 12x de R$ 935,39" - parcelamento no cartão configurado pela loja (taxa já embutida). */
function installmentText(price) {
  const s = st.data?.store || {};
  const n = Math.trunc(Number(s.installments) || 0);
  if (n < 2 || !(price > 0)) return '';
  const per = (price * (1 + (Number(s.card_fee) || 0) / 100)) / n;
  return `ou ${n}x de <b>${esc(money(per))}</b>`;
}

/** Esqueleto da página enquanto o banco responde (parece mais rápido do que um spinner). */
function renderSkeleton() {
  ROOT.innerHTML = `
    <div class="cat-profile"><div class="cat-profile-inner">
      <span class="cat-avatar sk"></span>
      <div class="grow"><div class="sk" style="height:20px;width:180px;border-radius:8px"></div>
        <div class="sk" style="height:12px;width:120px;border-radius:6px;margin-top:10px"></div></div></div></div>
    <div class="cat-skeleton"><div class="cat-grid">${'<div class="sk" style="aspect-ratio:.62;border-radius:20px"></div>'.repeat(8)}</div></div>`;
}

async function boot() {
  renderSkeleton();
  try {
    st.data = await rpc('public_catalog');
  } catch (err) {
    logError(err, { where: 'load' });
    ROOT.innerHTML = `
      <div class="cat-empty-page">
        <div class="cat-avatar lg"></div>
        <h1>Não consegui abrir o catálogo</h1>
        <p>${esc(err.message || 'Confira a internet e tente de novo.')}</p>
        <button class="cat-btn cat-btn-primary">Tentar de novo</button>
      </div>`;
    ROOT.querySelector('button')?.addEventListener('click', () => location.reload());
    return;
  }
  if (!st.data.enabled) { renderClosed(); return; }
  index(st.data);
  // Filtros guardados que hoje não têm nada: voltam para "todos".
  if (st.avail === 'encomenda' && !products.some((p) => (p.variants || []).some(hasOrder))) st.avail = 'todos';
  if (st.cond !== 'todos' && !products.some((p) => (p.variants || []).some((v) => condKey(v) === st.cond))) st.cond = 'todos';
  readHash();
  renderShell();
  renderGrid();
  updateBagButton();
  // Barra compacta aparece quando o perfil da loja sai da tela.
  const mini = ROOT.querySelector('.cat-mini');
  const profile = ROOT.querySelector('.cat-brand');
  const onScroll = () => mini?.classList.toggle('is-on', window.scrollY > (profile?.offsetHeight || 200) - 10);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  openFromHash();
  window.addEventListener('hashchange', () => { readHash(); renderCats(); renderGrid(); openFromHash(); });
}

function storeWa(text = '') {
  const n = waNumber(st.data?.store?.phone);
  return n ? `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ''}` : '';
}

function renderClosed() {
  const s = st.data.store || {};
  const wa = storeWa(`Olá, ${s.name || 'i7even'}! Vim pelo catálogo.`);
  document.title = `${s.name || 'i7even Store'} · Catálogo`;
  ROOT.innerHTML = `
    <div class="cat-empty-page">
      <div class="cat-avatar lg"></div>
      <h1>${esc(s.name || 'i7even Store')}</h1>
      <p>O catálogo está em atualização. Fale com a gente pelo WhatsApp - respondemos rapidinho.</p>
      ${wa ? `<a class="cat-btn cat-btn-wa" href="${esc(wa)}">${icon('whatsapp')} Falar no WhatsApp</a>` : ''}
    </div>`;
}

const VERIFIED = '<svg class="cat-verified-ic" viewBox="0 0 24 24" aria-label="Loja oficial"><path fill="currentColor" d="M12 1.5l2.4 1.8 3-.2 1 2.8 2.6 1.6-.7 2.9 1.2 2.7-2.2 2 .1 3-2.9.7-1.6 2.6-2.8-1-2.7 1.3-2-2.2-3 .1-.7-2.9L1.6 14l1-2.8-1.3-2.7 2.2-2-.1-3 2.9-.7L7.9 1.9l2.8 1z"/><path fill="#fff" d="M10.6 15.6l-3.2-3.2 1.4-1.4 1.8 1.8 4.6-4.6 1.4 1.4z"/></svg>';

function renderShell() {
  const s = st.data.store || {};
  const name = s.name || 'i7even Store';
  document.title = `${name} · Catálogo`;
  const ig = String(s.instagram || '').replace(/^@/, '').trim();
  const wa = storeWa(`Olá, ${name}! Vim pelo catálogo.`);
  const conds = COND_GROUPS.filter(([k]) => products.some((p) => (p.variants || []).some((v) => condKey(v) === k)));
  const hasEnc = products.some((p) => (p.variants || []).some(hasOrder));
  ROOT.innerHTML = `
    <div class="cat-mini" aria-hidden="true">
      <div class="cat-mini-inner">
        <span class="cat-avatar sm"></span><b class="grow">${esc(name)}</b>
        <button type="button" class="cat-icon-btn" data-go-search tabindex="-1" aria-label="Buscar">${icon('search')}</button>
        <button type="button" class="cat-icon-btn" data-open-bag tabindex="-1" aria-label="Sacola">${icon('orders')}<span class="cat-bag-count" data-bag-count hidden>0</span></button>
      </div>
    </div>

    <header class="cat-brand">
      <div class="cat-brand-card">
        <div class="cat-brand-top">
          <span class="cat-avatar" role="img" aria-label="${esc(name)}"></span>
          <div class="cat-brand-info grow">
            <h1>${esc(name)} ${VERIFIED}</h1>
            <p class="cat-trust">${icon('checkCircle')} Garantia em todos os aparelhos</p>
            <div class="cat-brand-meta">
              ${s.address ? `<span>${icon('pin')} ${esc(s.address)}</span>` : ''}
              ${ig ? `<span>${INSTAGRAM} @${esc(ig)}</span>` : ''}
            </div>
          </div>
          <button type="button" class="cat-icon-btn on-dark" data-share-store aria-label="Compartilhar o catálogo">${icon('share')}</button>
        </div>
        <div class="cat-actions">
          ${ig ? `<a class="cat-action" href="https://instagram.com/${esc(ig)}" target="_blank" rel="noopener">${INSTAGRAM} Instagram</a>` : ''}
          ${wa ? `<a class="cat-action is-wa" href="${esc(wa)}" target="_blank" rel="noopener">${icon('whatsapp')} Falar com a loja</a>` : ''}
        </div>
      </div>
    </header>

    ${hasEnc ? `
      <div class="cat-avail-tabs" role="tablist" aria-label="Disponibilidade">
        <button type="button" role="tab" class="cat-avail-tab" data-avail="todos" aria-selected="${st.avail === 'todos'}">
          <span class="cat-avail-ic">${icon('grid')}</span><span><b>Tudo</b><small>${products.length} modelos</small></span></button>
        <button type="button" role="tab" class="cat-avail-tab is-ready" data-avail="pronta" aria-selected="${st.avail === 'pronta'}">
          <span class="cat-avail-ic">${icon('checkCircle')}</span><span><b>Pronta entrega</b><small>leva hoje</small></span></button>
        <button type="button" role="tab" class="cat-avail-tab is-order" data-avail="encomenda" aria-selected="${st.avail === 'encomenda'}">
          <span class="cat-avail-ic">${icon('truck')}</span><span><b>Sob encomenda</b><small>${esc(leadText())}</small></span></button>
      </div>` : ''}

    <nav class="cat-cats" data-cats aria-label="Categorias"></nav>

    <div class="cat-tools">
      <label class="cat-search">${icon('search')}
        <input type="search" placeholder="Digite um modelo…" data-q autocomplete="off" enterkeyhint="search" value="${esc(st.q)}" aria-label="Buscar modelo">
      </label>
      <div class="cat-view" role="group" aria-label="Exibição">
        <button type="button" data-view="grid" aria-pressed="${st.view !== 'list'}" aria-label="Em grade">${icon('grid')}</button>
        <button type="button" data-view="list" aria-pressed="${st.view === 'list'}" aria-label="Em lista">${icon('menu')}</button>
      </div>
    </div>

    <div class="cat-filters">
      <div class="cat-pills" role="group" aria-label="Condição">
        <button type="button" class="cat-pill" data-cond="todos" aria-pressed="${st.cond === 'todos'}">Todos</button>
        ${conds.map(([k, l]) => `<button type="button" class="cat-pill" data-cond="${k}" aria-pressed="${st.cond === k}">${esc(l)}</button>`).join('')}
      </div>
    </div>

    <main class="cat-main">
      ${s.message ? `<p class="cat-notice">${esc(s.message)}</p>` : ''}
      <div class="cat-countbar">
        <p class="cat-count" data-count></p>
        <label class="cat-sort">
          <select data-sort aria-label="Ordenar">
            ${[['destaques', 'Relevância'], ['menor', 'Menor preço'], ['maior', 'Maior preço'], ['novos', 'Mais novos'], ['az', 'A-Z']].map(([k, l]) => `<option value="${k}" ${st.sort === k ? 'selected' : ''}>${l}</option>`).join('')}
          </select>${icon('chevronDown')}
        </label>
      </div>
      <div data-grid></div>
    </main>

    <footer class="cat-foot">
      <span class="cat-avatar sm"></span>
      <p><b>${esc(name)}</b></p>
    </footer>

    ${wa ? `<a class="cat-fab-wa" href="${esc(wa)}" target="_blank" rel="noopener" aria-label="Falar no WhatsApp">${icon('whatsapp')}</a>` : ''}
    <button type="button" class="cat-fab-bag" data-open-bag hidden>
      ${icon('orders')}<span data-fab-text>Ver sacola</span><span class="cat-fab-total" data-fab-total></span>
    </button>`;
  renderCats();
}

/** Prazo da encomenda que mais aparece ("7 a 15 dias"). */
function leadText() {
  const count = new Map();
  for (const p of products) for (const v of p.variants || []) if (hasOrder(v) && v.order_lead) count.set(v.order_lead, (count.get(v.order_lead) || 0) + 1);
  const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
  return top ? `chega em ${top[0]}` : 'chega em poucos dias';
}

const INSTAGRAM = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>';

function renderCats() {
  const box = ROOT.querySelector('[data-cats]');
  if (!box) return;
  const cats = (st.data.categories || []);
  box.hidden = cats.length < 2 && !st.cat;
  box.innerHTML = cats.map((c) => {
    // Sem foto da categoria: a capa do primeiro modelo dela (fica igual à imoove).
    const cover = c.image || products.filter((p) => p.category_id === c.id).map((p) => p.image || firstColorPhoto(p)).find(Boolean) || '';
    return `<button type="button" class="cat-circle" data-cat="${esc(c.id)}" aria-pressed="${st.cat === c.id}">
      <span class="cat-circle-img">${cover ? `<img src="${esc(thumbUrl(cover))}" data-full="${esc(cover)}" alt="" loading="lazy">` : `<span aria-hidden="true">${esc(c.emoji || '📱')}</span>`}</span>
      <span class="cat-circle-name">${esc(c.name)}</span></button>`;
  }).join('');
}

/* --------------------------------------------------------------- grade -- */

function visibleVariants(p) {
  return (p.variants || []).filter((v) => condOk(v)
    && (st.avail === 'todos' || (st.avail === 'pronta' ? hasReady(v) : hasOrder(v))));
}

function norm(s) { return String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase(); }

function filtered() {
  const q = norm(st.q).trim();
  const catName = new Map((st.data.categories || []).map((c) => [c.id, c.name]));
  const list = products.filter((p) => {
    if (st.cat && p.category_id !== st.cat) return false;
    if (!visibleVariants(p).length) return false;
    if (!q) return true;
    const hay = norm([p.name, p.brand, catName.get(p.category_id), ...(p.variants || []).map(vLabel)].join(' '));
    return q.split(/\s+/).every((w) => hay.includes(w));
  });
  const minP = (p) => Math.min(...visibleVariants(p).map(shownPrice));
  const avail = (p) => visibleVariants(p).some(hasReady);
  const sorts = {
    destaques: (a, b) => avail(b) - avail(a) || Number(b.featured) - Number(a.featured) || (b.year || 0) - (a.year || 0) || minP(b) - minP(a),
    menor: (a, b) => minP(a) - minP(b),
    maior: (a, b) => minP(b) - minP(a),
    novos: (a, b) => (b.year || 0) - (a.year || 0) || minP(b) - minP(a),
    az: (a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }),
  };
  return list.sort(sorts[st.sort] || sorts.destaques);
}

/** "256GB · 4 cores", "128GB a 1TB · 6 cores". */
function specLine(p, vs) {
  const pos = (list, x) => { const i = (list || []).indexOf(x); return i < 0 ? 999 : i; };
  const storages = [...new Set(vs.map((v) => v.storage).filter(Boolean))].sort((a, b) => pos(p.storages, a) - pos(p.storages, b));
  const sizes = [...new Set(vs.map((v) => v.size).filter(Boolean))].sort((a, b) => pos(p.sizes, a) - pos(p.sizes, b));
  const colors = new Set(vs.map((v) => v.color).filter(Boolean)).size;
  const range = (xs) => (xs.length > 1 ? `${xs[0]} a ${xs[xs.length - 1]}` : xs[0]);
  return [sizes.length ? range(sizes) : '', storages.length ? range(storages) : '', colors ? `${colors} ${colors === 1 ? 'cor' : 'cores'}` : '']
    .filter(Boolean).join(' · ');
}

function cardHTML(p) {
  const vs = visibleVariants(p);
  const min = Math.min(...vs.map(shownPrice));
  const anyAvail = vs.some(hasReady);
  const leads = [...new Set(vs.filter(hasOrder).map((v) => v.order_lead).filter(Boolean))];
  const last = vs.some((v) => v.last_units);
  const conds = [...new Set(vs.map(condKey))];
  const colors = [...new Set(vs.map((v) => v.color).filter(Boolean))];
  const dots = colors.map((c) => [c, swatch(c)]).filter(([, d]) => d).slice(0, 6);
  // sem capa: a foto da primeira cor à venda
  const img = p.image || vs.map((v) => v.image || colorList(p, v.color)[0]).find(Boolean) || firstColorPhoto(p) || '';
  const photos = 1 + (p.gallery || []).length;
  const inst = installmentText(min);
  return `
    <button type="button" class="cat-card" data-product="${esc(p.id)}">
      <span class="cat-photo">
        ${img ? `<img src="${esc(thumbUrl(img))}" ${thumbUrl(img) !== img ? `srcset="${esc(thumbUrl(img))} 720w, ${esc(img)} 1600w" sizes="(max-width: 640px) 50vw, (max-width: 1100px) 33vw, 300px"` : ''} data-full="${esc(img)}" alt="${esc(p.name)}" loading="lazy" decoding="async">`
          : `<span class="cat-photo-empty">${icon('device')}</span>`}
        <span class="cat-badges">
          ${anyAvail && st.avail !== 'encomenda' && last ? '<span class="cat-badge hot">Últimas unidades</span>' : ''}
          ${p.featured ? '<span class="cat-badge">Destaque</span>' : ''}
        </span>
        ${img && photos > 1 ? `<span class="cat-photo-dots" aria-hidden="true">${Array.from({ length: Math.min(photos, 4) }, (_, i) => `<i${i ? '' : ' class="on"'}></i>`).join('')}</span>` : ''}
      </span>
      <span class="cat-card-body">
        <span class="cat-card-avail ${anyAvail && st.avail !== 'encomenda' ? 'is-ready' : 'is-order'}">${anyAvail && st.avail !== 'encomenda'
          ? `${icon('checkCircle')} Pronta entrega`
          : `${icon('truck')} Sob encomenda${leads.length === 1 ? ` · ${esc(leads[0])}` : ''}`}</span>
        <span class="cat-card-name">${esc(p.name)}</span>
        <span class="cat-card-spec">${esc(specLine(p, vs))}</span>
        <span class="cat-card-conds">${conds.map((k) => `<span class="cat-cond is-${k}">${esc(condLabel(k))}</span>`).join('')}</span>
        <span class="cat-card-price"><small>${vs.length > 1 ? 'A partir de' : 'Por'}</small><b>${esc(money(min))}</b>${inst ? `<small class="cat-inst">${inst}</small>` : ''}</span>
        ${dots.length ? `<span class="cat-dots">${dots.map(([c, d]) => `<span style="background:${d}" title="${esc(c)}"></span>`).join('')}${colors.length > dots.length ? `<em>+${colors.length - dots.length}</em>` : ''}</span>` : ''}
        <span class="cat-card-cta">Ver opções ${icon('chevronRight')}</span>
      </span>
    </button>`;
}

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let revealObserver = null;

/** Marca os cartões novos e revela em cascata conforme entram na tela. */
function reveal(grid) {
  if (reduceMotion.matches || !('IntersectionObserver' in window)) return;
  revealObserver?.disconnect();
  revealObserver = new IntersectionObserver((entries) => {
    let i = 0;
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.style.setProperty('--d', `${Math.min(i++, 8) * 0.045}s`);
      e.target.classList.add('is-in');
      revealObserver.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.08 });
  grid.querySelectorAll('.cat-card').forEach((c) => { c.classList.add('reveal'); revealObserver.observe(c); });
}

function renderGrid() {
  const grid = ROOT.querySelector('[data-grid]');
  if (!grid) return;
  requestAnimationFrame(() => reveal(grid));
  const list = filtered();
  ROOT.querySelector('[data-count]').textContent = `Exibindo ${list.length} ${list.length === 1 ? 'produto' : 'produtos'}`;
  if (!list.length) {
    grid.innerHTML = `<div class="cat-none">
      <p><b>Nada encontrado</b></p><p>Tente outra busca, ou pergunte pra gente - muita coisa chega por encomenda.</p>
      ${storeWa() ? `<a class="cat-btn cat-btn-wa" href="${esc(storeWa(`Olá! Procuro ${st.q || 'um aparelho'}. Vocês têm?`))}" target="_blank" rel="noopener">${icon('whatsapp')} Perguntar no WhatsApp</a>` : ''}</div>`;
    return;
  }
  const cat = (st.data.categories || []).find((c) => c.id === st.cat);
  const gridHTML = (items) => `<div class="cat-grid${st.view === 'list' ? ' is-list' : ''}">${items.map(cardHTML).join('')}</div>`;
  // "Tudo": pronta entrega primeiro, depois a encomenda - cada uma com o seu título.
  const ready = list.filter((p) => visibleVariants(p).some(hasReady));
  const order = list.filter((p) => !ready.includes(p));
  if (st.avail === 'todos' && ready.length && order.length) {
    grid.innerHTML = `${cat?.description ? `<p class="cat-desc">${esc(cat.description)}</p>` : ''}
      <section class="cat-sec">
        <div class="cat-sec-head is-ready"><span class="cat-sec-ic">${icon('checkCircle')}</span>
          <div><h2>Pronta entrega</h2><p>Na loja, pronto para levar hoje</p></div><span class="cat-sec-n">${ready.length}</span></div>
        ${gridHTML(ready)}
      </section>
      <section class="cat-sec">
        <div class="cat-sec-head is-order"><span class="cat-sec-ic">${icon('truck')}</span>
          <div><h2>Sob encomenda</h2><p>${esc(leadText().replace(/^c/, 'C'))} · a loja confirma tudo no WhatsApp antes de você pagar</p></div><span class="cat-sec-n">${order.length}</span></div>
        ${gridHTML(order)}
      </section>`;
    return;
  }
  grid.innerHTML = `${cat?.description ? `<p class="cat-desc">${esc(cat.description)}</p>` : ''}${gridHTML(list)}`;
}

/* ----------------------------------------------------- ficha do modelo -- */

function dims(p) {
  const vs = p.variants || [];
  const order = (list, field) => {
    const vals = [...new Set(vs.map((v) => v[field]).filter(Boolean))];
    const pos = (x) => { const i = (list || []).indexOf(x); return i < 0 ? 999 : i; };
    return vals.sort((a, b) => pos(a) - pos(b) || String(a).localeCompare(String(b), 'pt-BR', { numeric: true }));
  };
  const cat = (st.data.categories || []).find((c) => c.id === p.category_id) || {};
  return [
    { field: 'condition', label: 'Condição', values: [...new Set(vs.map((v) => v.condition))].sort((a, b) => Number(isSemi({ condition: a })) - Number(isSemi({ condition: b }))) },
    { field: 'size', label: cat.size_label || 'Tamanho', values: order(p.sizes, 'size') },
    { field: 'storage', label: cat.variant_label || 'Capacidade', values: order(p.storages, 'storage') },
    { field: 'color', label: cat.color_label || 'Cor', values: order(p.colors, 'color') },
  ].filter((d) => d.values.length);
}

const matchesSel = (v, sel, skip) => Object.entries(sel).every(([k, val]) => k === skip || !val || (v[k] || '') === val);

function openProduct(id) {
  const p = productIndex.get(id);
  if (!p) return;
  const ds = dims(p);
  const vs = p.variants || [];
  // Começa pela variação disponível mais barata (respeitando o filtro de condição).
  const pref = vs.filter((v) => condOk(v)
    && (st.avail === 'todos' || (st.avail === 'pronta' ? hasReady(v) : hasOrder(v))));
  const start = [...(pref.length ? pref : vs)].sort((a, b) => Number(hasReady(b)) - Number(hasReady(a)) || shownPrice(a) - shownPrice(b))[0];
  const sel = {};
  for (const d of ds) sel[d.field] = start?.[d.field] || '';
  let qty = 1;
  let mode = start ? defaultMode(start) : 'pronta';
  const photos = [p.image, ...(p.gallery || [])].filter(Boolean);
  let photoIdx = 0;

  const dlg = document.createElement('dialog');
  dlg.className = 'cat-sheet';
  document.body.appendChild(dlg);
  history.replaceState(null, '', `#p=${encodeURIComponent(p.id)}`);

  const current = () => vs.find((v) => matchesSel(v, sel)) || null;

  function render() {
    const v = current();
    if (v) {
      if (mode === 'pronta' && !hasReady(v)) mode = 'encomenda';
      if (mode === 'encomenda' && !hasOrder(v)) mode = 'pronta';
    }
    const both = v && hasReady(v) && hasOrder(v);
    // Foto da cor escolhida: a da própria variação ou de outra da mesma cor
    // (a versão sob encomenda aproveita a foto da pronta entrega).
    // Cor com fotos próprias: o carrossel é o daquela cor (como vitrine de loja).
    const cl = colorList(p, v?.color);
    const vImg = v?.image || cl[0] || (v?.color ? vs.find((x) => x.color === v.color && x.image)?.image : '') || '';
    const shown = cl.length && !v?.image ? cl : vImg && !photos.includes(vImg) ? [vImg, ...photos] : photos.length ? photos : (vImg ? [vImg] : []);
    if (photoIdx >= shown.length) photoIdx = 0;
    dlg.innerHTML = `
      <div class="cat-sheet-panel">
        <button type="button" class="cat-close" data-close aria-label="Fechar">${icon('x')}</button>
        <div class="cat-sheet-gallery">
          ${shown.length ? `
            <div class="cat-carousel" data-carousel>
              ${shown.map((u, i) => `<div class="cat-slide"><img src="${esc(u)}" alt="${esc(p.name)} ${i + 1}" decoding="async" ${i ? 'loading="lazy"' : 'fetchpriority="high"'}></div>`).join('')}
            </div>
            ${shown.length > 1 ? `<div class="cat-dots-nav">${shown.map((_, i) => `<button type="button" data-slide="${i}" aria-label="Foto ${i + 1}" aria-pressed="${i === photoIdx}"></button>`).join('')}</div>` : ''}`
          : `<div class="cat-slide empty">${icon('device')}</div>`}
        </div>
        <div class="cat-sheet-info">
          <p class="cat-eyebrow">${esc([p.brand, p.year].filter(Boolean).join(' · '))}</p>
          <h2>${esc(p.name)}</h2>
          <div class="cat-price-row">
            <span class="cat-price">${v ? esc(money(modePrice(v, mode))) : '-'}</span>
            ${v ? availHTML(v, mode) : '<span class="cat-avail muted">Combinação indisponível</span>'}
          </div>
          ${v && installmentText(modePrice(v, mode)) ? `<p class="cat-inst-line">${installmentText(modePrice(v, mode))} no cartão</p>` : ''}
          ${both ? `
            <div class="cat-modes" role="radiogroup" aria-label="Como você quer">
              <button type="button" class="cat-mode" role="radio" data-mode="pronta" aria-checked="${mode === 'pronta'}">
                <span class="cat-mode-t">${icon('checkCircle')} Pronta entrega</span>
                <b>${esc(money(modePrice(v, 'pronta')))}</b><small>leva hoje</small></button>
              <button type="button" class="cat-mode" role="radio" data-mode="encomenda" aria-checked="${mode === 'encomenda'}">
                <span class="cat-mode-t">${icon('truck')} Sob encomenda</span>
                <b>${esc(money(modePrice(v, 'encomenda')))}</b><small>${esc(v.order_lead || 'prazo a combinar')}</small></button>
            </div>` : v && mode === 'encomenda' ? `<p class="cat-lead">${icon('truck')} Chega em ${esc(v.order_lead || 'prazo a combinar com a loja')}. A loja confirma tudo no WhatsApp antes de você pagar.</p>` : ''}
          ${v && isSemi(v) && v.battery_min != null ? `<p class="cat-battery">${icon('trend')} Bateria ${v.battery_min === v.battery_max ? `${v.battery_min}%` : `de ${v.battery_min}% a ${v.battery_max}%`} nos aparelhos disponíveis</p>` : ''}
          ${ds.map((d) => `
            <div class="cat-opt">
              <span class="cat-opt-label">${esc(d.label)}${sel[d.field] ? `: <b>${esc(sel[d.field])}</b>` : ''}</span>
              <div class="cat-opt-values">
                ${d.values.map((val) => {
                  const possible = vs.filter((x) => x[d.field] === val && matchesSel(x, sel, d.field));
                  const avail = possible.some((x) => hasReady(x) || hasOrder(x));
                  const sw = d.field === 'color' ? swatch(val) : '';
                  return `<button type="button" class="cat-opt-btn${sw ? ' has-swatch' : ''}${!possible.length ? ' is-off' : !avail ? ' is-soldout' : ''}"
                    data-opt="${d.field}" data-val="${esc(val)}" aria-pressed="${sel[d.field] === val}">
                    ${sw ? `<span class="sw" style="background:${sw}"></span>` : ''}<span>${esc(val)}</span></button>`;
                }).join('')}
              </div>
            </div>`).join('')}
          ${p.description ? `<div class="cat-desc-block">${esc(p.description).replace(/\n/g, '<br>')}</div>` : ''}
          <div class="cat-buy">
            <div class="cat-qty">
              <button type="button" data-q-step="-1" aria-label="Menos">${icon('minus')}</button>
              <span data-qty>${qty}</span>
              <button type="button" data-q-step="1" aria-label="Mais">${icon('plus')}</button>
            </div>
            <button type="button" class="cat-btn cat-btn-primary grow" data-add ${v ? '' : 'disabled'}>${icon('plus')} Adicionar à sacola</button>
          </div>
          <div class="cat-sheet-links">
            ${storeWa() && v ? `<a class="cat-btn cat-btn-ghost" target="_blank" rel="noopener"
              href="${esc(storeWa(`Olá! Tenho interesse no ${vTitle(p, v)} (${money(modePrice(v, mode))}${mode === 'encomenda' ? ', sob encomenda' : ''}). ${mode === 'pronta' ? 'Ainda tem disponível?' : 'Qual o prazo certinho?'}`))}">${icon('whatsapp')} Perguntar no WhatsApp</a>` : ''}
            <button type="button" class="cat-btn cat-btn-ghost" data-share>${icon('share')} Compartilhar</button>
          </div>
        </div>
      </div>`;
    const car = dlg.querySelector('[data-carousel]');
    if (car) {
      requestAnimationFrame(() => { car.scrollLeft = photoIdx * car.clientWidth; });
      car.addEventListener('scroll', () => {
        const i = Math.round(car.scrollLeft / Math.max(car.clientWidth, 1));
        if (i !== photoIdx) { photoIdx = i; dlg.querySelectorAll('[data-slide]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.slide) === i))); }
      }, { passive: true });
    }
  }

  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) { close(); return; }
    const o = e.target.closest('[data-opt]');
    if (o) {
      const field = o.dataset.opt;
      const val = o.dataset.val;
      sel[field] = val;
      // Combinação que não existe: ajusta as outras escolhas para a mais parecida.
      if (!current()) {
        const fallback = vs.filter((x) => x[field] === val)
          .sort((a, b) => ds.reduce((acc, d) => acc + (b[d.field] === sel[d.field]) - (a[d.field] === sel[d.field]), 0)
            || Number(hasReady(b)) - Number(hasReady(a)))[0];
        if (fallback) for (const d of ds) sel[d.field] = fallback[d.field] || '';
      }
      photoIdx = 0;
      render();
      return;
    }
    const md = e.target.closest('[data-mode]');
    if (md) { mode = md.dataset.mode; render(); return; }
    const s = e.target.closest('[data-slide]');
    if (s) { photoIdx = Number(s.dataset.slide); const car = dlg.querySelector('[data-carousel]'); car?.scrollTo({ left: photoIdx * car.clientWidth, behavior: 'smooth' }); return; }
    const step = e.target.closest('[data-q-step]');
    if (step) { qty = Math.min(Math.max(qty + Number(step.dataset.qStep), 1), 20); dlg.querySelector('[data-qty]').textContent = qty; return; }
    if (e.target.closest('[data-add]')) {
      const v = current();
      if (!v) return;
      const k = bagKey(v.id, mode);
      st.bag[k] = Math.min((st.bag[k] || 0) + qty, 20);
      writeJSON(BAG_KEY, st.bag);
      updateBagButton(true);
      close();
      flash(`${vTitle(p, v)} na sacola${mode === 'encomenda' ? ' (encomenda)' : ''}`);
      return;
    }
    if (e.target.closest('[data-share]')) {
      const url = `${location.origin}${location.pathname}#p=${encodeURIComponent(p.id)}`;
      if (navigator.share) navigator.share({ title: p.name, text: `${p.name} - ${st.data.store.name}`, url }).catch(() => {});
      else navigator.clipboard?.writeText(url).then(() => flash('Link copiado')).catch(() => {});
    }
  });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });

  function close() {
    animateClose(dlg, () => {
      if (location.hash.startsWith('#p=')) history.replaceState(null, '', location.pathname + (st.cat ? `#c=${encodeURIComponent(st.cat)}` : ''));
    });
  }

  render();
  document.documentElement.classList.add('cat-locked');
  dlg.showModal();
  enableSwipeClose(dlg, close);
}

function availHTML(v, mode = defaultMode(v)) {
  if (mode === 'encomenda') return `<span class="cat-avail order">Sob encomenda${v.order_lead ? ` · ${esc(v.order_lead)}` : ''}</span>`;
  if (v.last_units) return '<span class="cat-avail hot">Últimas unidades</span>';
  return '<span class="cat-avail ok">Pronta entrega</span>';
}

/* --------------------------------------------------------------- sacola -- */

function bagItems() {
  return Object.entries(st.bag).map(([key, qty]) => {
    const [id, mode] = key.split('|');
    const x = variantIndex.get(id);
    return x ? { ...x, key, id, mode, qty, price: modePrice(x.variant, mode) } : null;
  }).filter((x) => x && x.price > 0);
}

function updateBagButton(bump = false) {
  const items = bagItems();
  const n = items.reduce((a, x) => a + x.qty, 0);
  const total = items.reduce((a, x) => a + x.qty * x.price, 0);
  const c = ROOT.querySelector('[data-bag-count]');
  if (c) { c.textContent = String(n); c.hidden = !n; if (bump) { c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); } }
  const fab = ROOT.querySelector('.cat-fab-bag');
  if (fab) {
    fab.hidden = !n;
    fab.querySelector('[data-fab-text]').textContent = `Ver sacola (${n})`;
    fab.querySelector('[data-fab-total]').textContent = money(total);
  }
}

function openBag() {
  const dlg = document.createElement('dialog');
  dlg.className = 'cat-sheet cat-bag';
  document.body.appendChild(dlg);

  function render(error = '') {
    const items = bagItems();
    const total = items.reduce((a, x) => a + x.qty * x.price, 0);
    dlg.innerHTML = `
      <div class="cat-sheet-panel narrow">
        <button type="button" class="cat-close" data-close aria-label="Fechar">${icon('x')}</button>
        <div class="cat-bag-body">
          <h2>Sua sacola</h2>
          ${items.length ? `
            <div class="cat-bag-items">
              ${items.map((x) => `
                <div class="cat-bag-item">
                  <span class="cat-bag-thumb">${x.product.image || x.variant.image ? `<img src="${esc(thumbUrl(x.variant.image || x.product.image))}" alt="">` : icon('device')}</span>
                  <span class="grow">
                    <b>${esc(x.product.name)}</b>
                    <small>${esc(vLabel(x.variant))}</small>
                    <small>${x.mode === 'encomenda' ? `<em>sob encomenda${x.variant.order_lead ? ` · ${esc(x.variant.order_lead)}` : ''}</em> · ` : ''}${esc(money(x.price))}</small>
                  </span>
                  <span class="cat-qty sm">
                    <button type="button" data-bag-step="-1" data-id="${esc(x.key)}" aria-label="Menos">${icon(x.qty === 1 ? 'trash' : 'minus')}</button>
                    <span>${x.qty}</span>
                    <button type="button" data-bag-step="1" data-id="${esc(x.key)}" aria-label="Mais">${icon('plus')}</button>
                  </span>
                </div>`).join('')}
            </div>
            <div class="cat-bag-total"><span>Total</span><b>${esc(money(total))}</b></div>
            <form class="cat-form" data-send>
              <label><span>Seu nome *</span><input name="name" required maxlength="80" autocomplete="name" value="${esc(st.me.name)}"></label>
              <label><span>Seu WhatsApp</span><input name="phone" inputmode="tel" maxlength="16" autocomplete="tel" value="${esc(maskPhone(st.me.phone))}" placeholder="(00) 00000-0000"></label>
              <label><span>Entrega, pagamento ou observação</span><textarea name="notes" maxlength="500" rows="2" placeholder="ex.: retiro na loja · pago no Pix · quero parcelar"></textarea></label>
              ${error ? `<p class="cat-error">${esc(error)}</p>` : ''}
              <button type="submit" class="cat-btn cat-btn-wa block">${icon('whatsapp')} Enviar pedido pelo WhatsApp</button>
              <p class="cat-fine">Você confirma pagamento e entrega direto com a loja no WhatsApp.</p>
            </form>` : `
            <div class="cat-none"><p><b>Sua sacola está vazia</b></p><p>Toque num modelo e escolha a versão que você quer.</p></div>`}
        </div>
      </div>`;
  }

  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) { close(); return; }
    const s = e.target.closest('[data-bag-step]');
    if (s) {
      const id = s.dataset.id;
      const next = (st.bag[id] || 0) + Number(s.dataset.bagStep);
      if (next <= 0) delete st.bag[id]; else st.bag[id] = Math.min(next, 20);
      writeJSON(BAG_KEY, st.bag);
      updateBagButton();
      render();
    }
  });
  dlg.addEventListener('input', (e) => { if (e.target.name === 'phone') e.target.value = maskPhone(e.target.value); });
  dlg.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('[type="submit"]');
    const name = f.name.value.trim();
    const phone = onlyDigits(f.phone.value);
    const notes = f.notes.value.trim();
    if (!name) { f.name.focus(); return; }
    st.me = { name, phone };
    writeJSON(ME_KEY, st.me);
    btn.disabled = true;
    btn.innerHTML = '<span class="cat-spinner sm"></span> Enviando…';
    let res;
    try {
      res = await rpc('catalog_request', { p: {
        customer_name: name, customer_phone: phone, notes,
        items: bagItems().map((x) => ({ variant_id: x.id, qty: x.qty, mode: x.mode })),
      } });
    } catch (err) {
      logError(err, { where: 'send' });
      // Sem registrar (banco fora, robô...): o WhatsApp abre mesmo assim com a sacola.
      const fallback = message(null, name, notes, bagItems().map((x) => ({ name: vTitle(x.product, x.variant), qty: x.qty, unit_price: x.price, mode: x.mode, lead: x.variant.order_lead, available: x.mode === 'encomenda' || hasReady(x.variant) })));
      render(err.message || 'Não consegui registrar o pedido agora.');
      const box = dlg.querySelector('.cat-error');
      if (box && storeWa()) box.insertAdjacentHTML('afterend', `<a class="cat-btn cat-btn-wa block" href="${esc(storeWa(fallback))}">${icon('whatsapp')} Mandar a sacola direto no WhatsApp</a>`);
      return;
    }
    const text = message(res.number, name, notes, res.items, res.total);
    st.bag = {};
    writeJSON(BAG_KEY, st.bag);
    updateBagButton();
    const wa = storeWa(text);
    dlg.innerHTML = `
      <div class="cat-sheet-panel narrow">
        <div class="cat-done">
          <span class="cat-done-icon">${icon('checkCircle')}</span>
          <h2>Pedido C${esc(res.number)} pronto!</h2>
          <p>Agora é só enviar a mensagem no WhatsApp da loja para confirmar pagamento e entrega.</p>
          ${wa ? `<a class="cat-btn cat-btn-wa block" href="${esc(wa)}">${icon('whatsapp')} Abrir o WhatsApp</a>` : ''}
          <button type="button" class="cat-btn cat-btn-ghost block" data-close>Voltar ao catálogo</button>
        </div>
      </div>`;
    // No iPhone, abrir o WhatsApp depois de esperar o servidor só funciona na mesma aba.
    if (wa) setTimeout(() => { location.href = wa; }, 600);
  });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });

  function close() { animateClose(dlg); }
  render();
  document.documentElement.classList.add('cat-locked');
  dlg.showModal();
  enableSwipeClose(dlg, close);
}

/** Mensagem para a loja - com os itens e o total que o BANCO devolveu (preço atual). */
function message(number, name, notes, items, total) {
  const s = st.data.store;
  const sum = total ?? items.reduce((a, i) => a + Number(i.unit_price) * i.qty, 0);
  return [
    `Olá, ${s.name}! Quero fazer um pedido pelo catálogo${number ? ` (*C${number}*)` : ''}:`,
    '',
    ...items.map((i) => `▪️ ${i.qty}x ${i.name} - ${money(Number(i.unit_price) * i.qty)}${i.mode === 'encomenda' ? ` (sob encomenda${i.lead ? ` · ${i.lead}` : ''})` : i.available === false ? ' (esgotou - confirmar)' : ''}`),
    '',
    `*Total: ${money(sum)}*`,
    '',
    `Nome: ${name}`,
    notes ? `Obs.: ${notes}` : '',
  ].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n').trim();
}

/* ---------------------------------------------------- folhas: movimento -- */

/** Desce a folha (ou some, no computador) antes de remover. */
function animateClose(dlg, after) {
  const panel = dlg.querySelector('.cat-sheet-panel');
  const done = () => {
    if (!dlg.isConnected) return;
    dlg.close();
    dlg.remove();
    document.documentElement.classList.remove('cat-locked');
    after?.();
  };
  if (!panel || reduceMotion.matches) { done(); return; }
  panel.classList.remove('is-dragging');
  panel.style.transform = '';
  panel.classList.add('is-closing');
  panel.addEventListener('animationend', done, { once: true });
  setTimeout(done, 400);   // garantia, se a animação não disparar
}

/**
 * No celular, puxar a folha para baixo fecha (como no iPhone). Só começa a
 * arrastar com a folha rolada até o topo - senão é a rolagem normal.
 */
function enableSwipeClose(dlg, close) {
  let startY = 0;
  let dy = 0;
  let dragging = false;
  dlg.addEventListener('touchstart', (e) => {
    const panel = dlg.querySelector('.cat-sheet-panel');
    if (!panel || window.innerWidth >= 860 || panel.scrollTop > 0 || e.target.closest('.cat-carousel, input, textarea')) return;
    startY = e.touches[0].clientY;
    dy = 0;
    dragging = true;
  }, { passive: true });
  dlg.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const panel = dlg.querySelector('.cat-sheet-panel');
    dy = Math.max(e.touches[0].clientY - startY, 0);
    if (dy > 4) {
      panel.classList.add('is-dragging');
      panel.style.transform = `translateY(${dy}px)`;
    }
  }, { passive: true });
  dlg.addEventListener('touchend', () => {
    if (!dragging) return;
    dragging = false;
    const panel = dlg.querySelector('.cat-sheet-panel');
    if (dy > 110) { close(); return; }
    panel.classList.remove('is-dragging');
    panel.style.transition = 'transform .35s cubic-bezier(.34,1.36,.64,1)';
    panel.style.transform = '';
    setTimeout(() => { panel.style.transition = ''; }, 380);
  });
}

/* ------------------------------------------------------------- avisos -- */

function flash(text) {
  let el = document.querySelector('.cat-flash');
  if (!el) { el = document.createElement('div'); el.className = 'cat-flash'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(flash.t);
  flash.t = setTimeout(() => el.classList.remove('show'), 2200);
}

/* --------------------------------------------------------------- links -- */

function readHash() {
  const m = /^#c=(.+)$/.exec(location.hash);
  if (m) st.cat = decodeURIComponent(m[1]);
}
function openFromHash() {
  const m = /^#p=(.+)$/.exec(location.hash);
  if (m && !document.querySelector('dialog.cat-sheet[open]')) openProduct(decodeURIComponent(m[1]));
}

/* -------------------------------------------------------------- eventos -- */

ROOT.addEventListener('click', (e) => {
  const t = e.target;
  if (t.closest('[data-open-bag]')) { openBag(); return; }
  const card = t.closest('[data-product]');
  if (card) { openProduct(card.dataset.product); return; }
  const c = t.closest('[data-cat]');
  if (c) {
    // toque de novo na categoria ligada volta para tudo
    st.cat = st.cat === c.dataset.cat ? '' : c.dataset.cat;
    history.replaceState(null, '', st.cat ? `#c=${encodeURIComponent(st.cat)}` : location.pathname);
    renderCats();
    renderGrid();
    return;
  }
  const cond = t.closest('[data-cond]');
  if (cond) {
    st.cond = cond.dataset.cond;
    savePrefs();
    ROOT.querySelectorAll('[data-cond]').forEach((b) => b.setAttribute('aria-pressed', String(b === cond)));
    renderGrid();
    return;
  }
  const av = t.closest('[data-avail]');
  if (av) {
    // toque de novo no filtro ligado desliga (volta a mostrar tudo)
    st.avail = av.dataset.avail;
    savePrefs();
    ROOT.querySelectorAll('[data-avail]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.avail === st.avail)));
    renderGrid();
    updateBagButton();
    return;
  }
  const vw = t.closest('[data-view]');
  if (vw) {
    st.view = vw.dataset.view;
    savePrefs();
    ROOT.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b === vw)));
    renderGrid();
    return;
  }
  if (t.closest('[data-go-search]')) {
    const q = ROOT.querySelector('[data-q]');
    q?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => q?.focus({ preventScroll: true }), 350);
    return;
  }
  if (t.closest('[data-share-store]')) {
    const url = `${location.origin}${location.pathname}`;
    const name = st.data?.store?.name || 'i7even';
    if (navigator.share) navigator.share({ title: `${name} · Catálogo`, url }).catch(() => {});
    else navigator.clipboard?.writeText(url).then(() => flash('Link do catálogo copiado')).catch(() => {});
  }
});
ROOT.addEventListener('input', (e) => {
  if (e.target.matches('[data-q]')) { st.q = e.target.value; renderGrid(); }
});
ROOT.addEventListener('change', (e) => {
  if (e.target.matches('[data-avail-toggle]')) { st.avail = e.target.checked ? 'pronta' : 'todos'; savePrefs(); renderGrid(); }
  if (e.target.matches('[data-sort]')) { st.sort = e.target.value; savePrefs(); renderGrid(); }
});
// Miniatura que não existe (foto antiga): cai na foto grande.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img?.tagName === 'IMG' && img.dataset.full && img.getAttribute('src') !== img.dataset.full) {
    img.removeAttribute('srcset');   // senão o navegador continua escolhendo a miniatura que falhou
    img.src = img.dataset.full;
  }
}, true);

boot();
