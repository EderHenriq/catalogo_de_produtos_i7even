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
  cond: readJSON(PREF_KEY, {}).cond || 'todos',      // todos | lacrado | seminovo
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
  writeJSON(PREF_KEY, { cond: st.cond, avail: st.avail, sort: st.sort });
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

/** Esqueleto da página enquanto o banco responde (parece mais rápido do que um spinner). */
function renderSkeleton() {
  ROOT.innerHTML = `
    <div class="cat-top"><div class="cat-top-inner"><span class="cat-brand-mark"></span><span class="cat-wordmark"></span></div></div>
    <div class="cat-hero"><div class="cat-hero-inner"><div class="sk" style="height:12px;width:120px;border-radius:6px;opacity:.15;background:#fff"></div>
      <div style="height:46px;width:min(420px,80%);margin-top:14px;border-radius:12px;background:rgba(255,255,255,.08)"></div></div></div>
    <div class="cat-skeleton"><div class="cat-grid">${'<div class="sk" style="aspect-ratio:.78"></div>'.repeat(8)}</div></div>`;
}

async function boot() {
  renderSkeleton();
  try {
    st.data = await rpc('public_catalog');
  } catch (err) {
    logError(err, { where: 'load' });
    ROOT.innerHTML = `
      <div class="cat-empty-page">
        <div class="cat-brand-mark"></div>
        <h1>Não consegui abrir o catálogo</h1>
        <p>${esc(err.message || 'Confira a internet e tente de novo.')}</p>
        <button class="cat-btn cat-btn-primary">Tentar de novo</button>
      </div>`;
    ROOT.querySelector('button')?.addEventListener('click', () => location.reload());
    return;
  }
  if (!st.data.enabled) { renderClosed(); return; }
  index(st.data);
  // Filtro guardado de "encomenda" sem nenhuma oferta hoje: volta para tudo.
  if (st.avail === 'encomenda' && !products.some((p) => (p.variants || []).some(hasOrder))) st.avail = 'todos';
  readHash();
  renderShell();
  renderGrid();
  updateBagButton();
  const top = ROOT.querySelector('.cat-top');
  const onScroll = () => top?.classList.toggle('is-scrolled', window.scrollY > 8);
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
      <div class="cat-brand-mark"></div>
      <h1>${esc(s.name || 'i7even Store')}</h1>
      <p>O catálogo está em atualização. Fale com a gente pelo WhatsApp - respondemos rapidinho.</p>
      ${wa ? `<a class="cat-btn cat-btn-wa" href="${esc(wa)}">${icon('whatsapp')} Falar no WhatsApp</a>` : ''}
    </div>`;
}

function renderShell() {
  const s = st.data.store || {};
  document.title = `${s.name || 'i7even Store'} · Catálogo`;
  const ig = String(s.instagram || '').replace(/^@/, '');
  ROOT.innerHTML = `
    <header class="cat-top">
      <div class="cat-top-inner">
        <a class="cat-logo" href="#" aria-label="${esc(s.name)}">
          <span class="cat-brand-mark"></span>
          <span class="cat-wordmark" role="img" aria-label="${esc(s.name)}"></span>
        </a>
        <span class="grow"></span>
        ${storeWa() ? `<a class="cat-btn cat-btn-ghost hide-xs" href="${esc(storeWa(`Olá, ${s.name}! Vim pelo catálogo.`))}" target="_blank" rel="noopener">${icon('whatsapp')}<span>Falar com a loja</span></a>` : ''}
        <button type="button" class="cat-bag-btn" data-open-bag aria-label="Sacola">
          ${icon('orders')}<span class="cat-bag-count" data-bag-count hidden>0</span>
        </button>
      </div>
    </header>

    <section class="cat-hero">
      <div class="cat-hero-inner">
        <p class="cat-eyebrow">Catálogo oficial</p>
        <h1>${esc(s.name || 'i7even Store')}</h1>
        <p class="cat-hero-sub">${esc(s.message || 'iPhones lacrados e seminovos, Apple Watch, AirPods e mais. Preços atualizados e garantia.')}</p>
        <div class="cat-hero-badges">
          <span>${icon('checkCircle')} Garantia em todos os aparelhos</span>
          <span>${icon('whatsapp')} Atendimento no WhatsApp</span>
          ${ig ? `<a href="https://instagram.com/${esc(ig)}" target="_blank" rel="noopener">@${esc(ig)}</a>` : ''}
          ${s.address ? `<span>${icon('pin')} ${esc(s.address)}</span>` : ''}
        </div>
      </div>
    </section>

    <div class="cat-bar">
      <div class="cat-bar-inner">
        <label class="cat-search">${icon('search')}
          <input type="search" placeholder="Buscar iPhone, Watch, AirPods…" data-q autocomplete="off" enterkeyhint="search" value="${esc(st.q)}">
        </label>
        <div class="cat-chips" data-cats></div>
        <div class="cat-filters">
          <div class="cat-seg" role="group" aria-label="Condição">
            ${[['todos', 'Todos'], ['lacrado', 'Lacrados'], ['seminovo', 'Seminovos']].map(([k, l]) => `<button type="button" data-cond="${k}" aria-pressed="${st.cond === k}">${l}</button>`).join('')}
          </div>
          ${products.some((p) => (p.variants || []).some(hasOrder)) ? `
            <div class="cat-seg" role="group" aria-label="Disponibilidade">
              ${[['todos', 'Tudo'], ['pronta', 'Pronta entrega'], ['encomenda', 'Encomenda']].map(([k, l]) => `<button type="button" data-avail="${k}" aria-pressed="${st.avail === k}">${l}</button>`).join('')}
            </div>`
            : `<label class="cat-toggle"><input type="checkbox" data-avail-toggle ${st.avail === 'pronta' ? 'checked' : ''}><span>Pronta entrega</span></label>`}
          <select class="cat-select" data-sort aria-label="Ordenar">
            ${[['destaques', 'Destaques'], ['menor', 'Menor preço'], ['maior', 'Maior preço'], ['novos', 'Mais novos'], ['az', 'A-Z']].map(([k, l]) => `<option value="${k}" ${st.sort === k ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>

    <main class="cat-main">
      <p class="cat-count" data-count></p>
      <div data-grid></div>
    </main>

    <footer class="cat-foot">
      <div class="cat-brand-mark sm"></div>
      <p><b>${esc(s.name)}</b></p>
      <p>Preços sujeitos a alteração sem aviso · imagens ilustrativas</p>
      ${storeWa() ? `<a class="cat-btn cat-btn-wa" href="${esc(storeWa(`Olá, ${s.name}! Vim pelo catálogo.`))}" target="_blank" rel="noopener">${icon('whatsapp')} Falar no WhatsApp</a>` : ''}
    </footer>

    <button type="button" class="cat-fab-bag" data-open-bag hidden>
      ${icon('orders')}<span data-fab-text>Ver sacola</span><span class="cat-fab-total" data-fab-total></span>
    </button>`;
  renderCats();
}

function renderCats() {
  const box = ROOT.querySelector('[data-cats]');
  if (!box) return;
  const cats = st.data.categories || [];
  box.innerHTML = `
    <button type="button" class="cat-chip" data-cat="" aria-pressed="${!st.cat}">Tudo</button>
    ${cats.map((c) => `<button type="button" class="cat-chip" data-cat="${esc(c.id)}" aria-pressed="${st.cat === c.id}">
      ${c.image ? `<img src="${esc(thumbUrl(c.image))}" alt="" loading="lazy">` : `<span aria-hidden="true">${esc(c.emoji || '')}</span>`}${esc(c.name)}</button>`).join('')}`;
}

/* --------------------------------------------------------------- grade -- */

function visibleVariants(p) {
  return (p.variants || []).filter((v) => (st.cond === 'todos' || (st.cond === 'lacrado' ? !isSemi(v) : isSemi(v)))
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
    destaques: (a, b) => avail(b) - avail(a) || Number(b.featured) - Number(a.featured) || (b.year || 0) - (a.year || 0) || a.name.localeCompare(b.name, 'pt-BR'),
    menor: (a, b) => minP(a) - minP(b),
    maior: (a, b) => minP(b) - minP(a),
    novos: (a, b) => (b.year || 0) - (a.year || 0) || minP(b) - minP(a),
    az: (a, b) => a.name.localeCompare(b.name, 'pt-BR'),
  };
  return list.sort(sorts[st.sort] || sorts.destaques);
}

function cardHTML(p) {
  const vs = visibleVariants(p);
  const min = Math.min(...vs.map(shownPrice));
  const anyAvail = vs.some(hasReady);
  const anyOrder = vs.some(hasOrder);
  const leads = [...new Set(vs.filter(hasOrder).map((v) => v.order_lead).filter(Boolean))];
  const last = vs.some((v) => v.last_units);
  const conds = [...new Set(vs.map((v) => (isSemi(v) ? 'Seminovo' : 'Lacrado')))];
  const colors = [...new Set(vs.map((v) => v.color).filter(Boolean))];
  const dots = colors.map(swatch).filter(Boolean).slice(0, 6);
  const img = p.image || '';
  return `
    <button type="button" class="cat-card" data-product="${esc(p.id)}">
      <span class="cat-photo">
        ${img ? `<img src="${esc(thumbUrl(img))}" ${thumbUrl(img) !== img ? `srcset="${esc(thumbUrl(img))} 720w, ${esc(img)} 1600w" sizes="(max-width: 640px) 50vw, (max-width: 1100px) 33vw, 280px"` : ''} data-full="${esc(img)}" alt="${esc(p.name)}" loading="lazy" decoding="async">`
          : `<span class="cat-photo-empty">${icon('device')}</span>`}
        <span class="cat-badges">
          ${!anyAvail || st.avail === 'encomenda' ? `<span class="cat-badge order">Sob encomenda${leads.length === 1 ? ` · ${esc(leads[0])}` : ''}</span>` : last ? '<span class="cat-badge hot">Últimas unidades</span>' : ''}
          ${p.featured ? '<span class="cat-badge">Destaque</span>' : ''}
        </span>
      </span>
      <span class="cat-card-body">
        <span class="cat-card-conds">${conds.map((c) => `<span class="${c === 'Seminovo' ? 'semi' : ''}">${c}</span>`).join('')}</span>
        <span class="cat-card-name">${esc(p.name)}</span>
        ${dots.length ? `<span class="cat-dots">${dots.map((d) => `<span style="background:${d}"></span>`).join('')}${colors.length > dots.length ? `<em>+${colors.length - dots.length}</em>` : ''}</span>` : ''}
        <span class="cat-card-price"><small>${vs.length > 1 ? 'a partir de' : '&nbsp;'}</small>${esc(money(min))}</span>
        ${anyAvail && anyOrder && st.avail === 'todos' ? '<span class="cat-card-extra">Também sob encomenda</span>' : ''}
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
  ROOT.querySelector('[data-count]').textContent = `${list.length} ${list.length === 1 ? 'modelo' : 'modelos'}`;
  if (!list.length) {
    grid.innerHTML = `<div class="cat-none">
      <p><b>Nada encontrado</b></p><p>Tente outra busca, ou pergunte pra gente - muita coisa chega por encomenda.</p>
      ${storeWa() ? `<a class="cat-btn cat-btn-wa" href="${esc(storeWa(`Olá! Procuro ${st.q || 'um aparelho'}. Vocês têm?`))}" target="_blank" rel="noopener">${icon('whatsapp')} Perguntar no WhatsApp</a>` : ''}</div>`;
    return;
  }
  // "Tudo" sem busca: separado por categoria, com título.
  if (!st.cat && !st.q && st.sort === 'destaques') {
    const cats = st.data.categories || [];
    const by = new Map();
    for (const p of list) { const k = p.category_id || '_'; if (!by.has(k)) by.set(k, []); by.get(k).push(p); }
    grid.innerHTML = [...cats.map((c) => [c, by.get(c.id)]), [{ id: '_', name: 'Outros' }, by.get('_')]]
      .filter(([, items]) => items?.length)
      .map(([c, items]) => `
        <section class="cat-section">
          <div class="cat-section-head">
            <h2>${esc(c.name)}</h2>
            ${c.description ? `<p>${esc(c.description)}</p>` : ''}
            ${c.id !== '_' && items.length > 4 ? `<button type="button" class="cat-link" data-cat="${esc(c.id)}">Ver todos ${icon('chevronRight')}</button>` : ''}
          </div>
          <div class="cat-grid">${items.map(cardHTML).join('')}</div>
        </section>`).join('');
    return;
  }
  const cat = (st.data.categories || []).find((c) => c.id === st.cat);
  grid.innerHTML = `${cat?.description ? `<p class="cat-desc">${esc(cat.description)}</p>` : ''}<div class="cat-grid">${list.map(cardHTML).join('')}</div>`;
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
  const pref = vs.filter((v) => (st.cond === 'todos' || (st.cond === 'lacrado' ? !isSemi(v) : isSemi(v)))
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
    const vImg = v?.image;
    const shown = vImg && !photos.includes(vImg) ? [vImg, ...photos] : photos;
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
    st.cat = c.dataset.cat;
    history.replaceState(null, '', st.cat ? `#c=${encodeURIComponent(st.cat)}` : location.pathname);
    renderCats();
    renderGrid();
    ROOT.querySelector('.cat-main')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    st.avail = av.dataset.avail;
    savePrefs();
    ROOT.querySelectorAll('[data-avail]').forEach((b) => b.setAttribute('aria-pressed', String(b === av)));
    renderGrid();
    updateBagButton();
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
