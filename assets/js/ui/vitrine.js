/**
 * Vitrine: o que o cliente vê no catálogo, do jeito que ele vê.
 *
 *   Grade   os modelos com a foto do cartão, o preço e a chave "No
 *           catálogo". Atalhos: no catálogo · escondidos · sem foto ·
 *           com foto e sem preço (os do cadastro/importador prontos para
 *           vender: "Pôr à venda").
 *   Ficha   qual foto vai no cartão (a cor que aparece primeiro), as fotos
 *           de cada cor na ordem (toque nas fotos na ordem que quiser), a
 *           ordem das cores, cada versão à venda liga/desliga e o destaque.
 *
 * Grava na hora: é a mesma informação de Produtos (fotos por cor, à mostra
 * no catálogo, destaque), organizada como vitrine.
 */

import * as Data from '../core/data.js';
import { variantLabel } from '../core/calc.js';
import { friendlyError } from '../core/errors.js';
import { esc, money, thumbUrl } from '../core/utils.js';
import { openModal, toast, toastError, emptyState } from './kit.js';
import { icon } from './icons.js';
import { matches, catalogUrl, pref, setPref, openColorPhotos, moneyHTML } from './common.js';
import { openQuickProduct } from './quick-product.js';

const FILTERS = [
  { key: 'mostra', label: 'No catálogo', hint: 'O que o cliente vê agora, na ordem do catálogo. Toque no produto para escolher a foto do cartão e a ordem das fotos.' },
  { key: 'escondidos', label: 'Escondidos', hint: 'Têm preço, mas não aparecem no catálogo. Ligue a chave para mostrar.' },
  { key: 'semfoto', label: 'Sem foto', hint: 'Aparecem sem foto - vendem bem menos. Toque para pôr as fotos.' },
  { key: 'prontos', label: 'Com foto, sem preço', hint: 'Já têm foto (cadastro ou importador), falta o preço: toque em "Pôr à venda" - pronta entrega ou encomenda.' },
];

/* ------------------------------------------------------------ regras -- */

/** Valor de encomenda que o catálogo mostra (mesma regra do banco). */
function offerOf(v, s = Data.settings()) {
  if (v.onOrder && v.orderPrice > 0) return v.orderPrice;
  if (s.catalogShowOutOfStock && v.stock <= 0 && v.price > 0) return v.price;
  return 0;
}
const isReady = (v) => v.stock > 0 && v.price > 0;

/** Versões ativas, as que vendem (pronta ou encomenda) e as que estão à mostra. */
function sellInfo(p) {
  const s = Data.settings();
  const vs = Data.variantsOf(p.id).filter((v) => v.active);
  const sellable = vs.filter((v) => isReady(v) || offerOf(v, s) > 0);
  const shown = sellable.filter((v) => v.showInCatalog);
  const priceOf = (v) => (isReady(v) ? v.price : offerOf(v, s));
  const prices = shown.map(priceOf);
  return {
    vs, sellable, shown, priceOf,
    ready: shown.some(isReady),
    min: prices.length ? Math.min(...prices) : 0,
    visible: p.showInCatalog && shown.length > 0 && (!p.categoryId || Data.category(p.categoryId)?.active !== false),
  };
}

/** Cores do modelo: as cadastradas (na ordem) + as das versões + as que têm foto. */
function colorsOf(p) {
  const vs = Data.variantsOf(p.id).filter((v) => v.active);
  return [...new Set([...p.colors, ...vs.map((v) => v.color), ...Object.keys(p.colorPhotos || {})])]
    .filter((c) => c && !/^outra cor$/i.test(c));
}
/** Fotos de uma cor, na ordem (a foto que uma versão guardava sozinha vai no fim). */
const photosOfColor = (p, c) => [...new Set([...(p.colorPhotos?.[c] || []),
  ...Data.variantsOf(p.id).filter((v) => v.color === c && v.imageUrl).map((v) => v.imageUrl)])];
const modelPhotos = (p) => [p.imageUrl, ...(p.gallery || [])].filter(Boolean);
const allPhotos = (p) => new Set([...modelPhotos(p), ...colorsOf(p).flatMap((c) => photosOfColor(p, c))]);

/** A foto do cartão no catálogo (mesma regra do catalog.js: capa do modelo, senão a cor da versão mais barata). */
function cardPhoto(p, info = sellInfo(p)) {
  if (p.imageUrl) return p.imageUrl;
  const byPrice = [...info.shown].sort((a, b) => info.priceOf(a) - info.priceOf(b));
  for (const v of byPrice) { const u = v.imageUrl || p.colorPhotos?.[v.color]?.[0]; if (u) return u; }
  return colorsOf(p).map((c) => photosOfColor(p, c)[0]).find(Boolean) || '';
}

/** Qual cor está no cartão: '' automática, '_model' foto própria do modelo. */
function coverChoice(p) {
  if (!p.imageUrl) return '';
  return colorsOf(p).find((c) => photosOfColor(p, c)[0] === p.imageUrl) || '_model';
}

/* =================================================================== */
/*  Grade                                                               */
/* =================================================================== */

export function mount(host, ctx) {
  const st = { q: '', filter: pref('vitrine.filter', 'mostra'), cat: '' };
  if (!FILTERS.some((f) => f.key === st.filter)) st.filter = 'mostra';

  host.innerHTML = `
    <div class="view">
      <div class="section-head">
        <div>
          <h2>Vitrine</h2>
          <p class="small dim hide-mobile">O que aparece no catálogo e a ordem das fotos - do jeito que o cliente vê.</p>
        </div>
        <div class="row gap-2 wrap">
          <button class="btn hide-mobile" data-photo-import title="Importar pasta de fotos (no computador)">${icon('image')}<span>Importar fotos</span></button>
          <a class="btn" href="${esc(catalogUrl())}" target="_blank" rel="noopener">${icon('eye')}<span>Ver como cliente</span></a>
        </div>
      </div>
      <div data-closed></div>
      <div class="filters">
        <div class="chips filter-chips" data-filters></div>
        <div class="chips filter-chips" data-cats></div>
      </div>
      <p class="small dim vit-hint" data-hint></p>
      <div data-grid></div>
    </div>`;
  const $grid = host.querySelector('[data-grid]');

  function test(p, key) {
    if (!p.active) return false;
    const info = sellInfo(p);
    const sells = info.sellable.length > 0;
    switch (key) {
      case 'mostra': return info.visible;
      case 'escondidos': return sells && !info.visible;
      case 'semfoto': return info.visible && !allPhotos(p).size;
      case 'prontos': return !sells && allPhotos(p).size > 0;
      default: return false;
    }
  }

  function list() {
    const catOrder = new Map(Data.categories().map((c, i) => [c.id, i]));
    return Data.products().filter((p) => test(p, st.filter)
      && (!st.cat || p.categoryId === st.cat)
      && (!st.q || matches(st.q, p.name, p.brand, Data.category(p.categoryId)?.name, colorsOf(p).join(' '))))
      .map((p) => ({ p, info: sellInfo(p) }))
      // a ordem do catálogo: pronta entrega, destaque, mais novo, nome
      .sort((a, b) => Number(b.info.ready) - Number(a.info.ready) || Number(b.p.featured) - Number(a.p.featured)
        || (st.filter === 'prontos' ? (catOrder.get(a.p.categoryId) ?? 99) - (catOrder.get(b.p.categoryId) ?? 99) : 0)
        || (b.p.year || 0) - (a.p.year || 0) || a.p.name.localeCompare(b.p.name, 'pt-BR', { numeric: true }));
  }

  function cardHTML({ p, info }) {
    const photo = cardPhoto(p, info);
    const n = allPhotos(p).size;
    const colors = colorsOf(p);
    const noPhoto = colors.filter((c) => !photosOfColor(p, c).length && info.shown.some((v) => v.color === c)).length;
    const sells = info.sellable.length > 0;
    const sub = !sells ? 'sem preço' : info.shown.length
      ? `${info.ready ? 'Pronta entrega' : 'Encomenda'} · a partir de ${money(info.min)}`
      : 'todas as versões escondidas';
    return `
      <article class="vit-card${sells && !info.visible ? ' is-off' : ''}">
        <button type="button" class="vit-photo" data-open="${esc(p.id)}" aria-label="Organizar ${esc(p.name)}">
          ${photo ? `<img src="${esc(thumbUrl(photo))}" data-full="${esc(photo)}" alt="" loading="lazy" decoding="async">`
            : `<span class="vit-nophoto">${icon('camera')}<span>Sem foto</span></span>`}
          ${n > 1 ? `<span class="vit-count">${icon('image')} ${n}</span>` : ''}
          ${p.featured ? `<span class="vit-star" title="Destaque">${icon('star')}</span>` : ''}
          ${sells && !info.visible ? '<span class="vit-off">Escondido</span>' : ''}
        </button>
        <div class="vit-body">
          <button type="button" class="vit-name" data-open="${esc(p.id)}">${esc(p.name)}</button>
          <span class="vit-sub">${esc(sub)}</span>
          ${colors.length ? `<span class="vit-colors">${colors.length} ${colors.length === 1 ? 'cor' : 'cores'}${noPhoto ? ` · <span class="tone-amber">${noPhoto} sem foto</span>` : ''}</span>` : ''}
        </div>
        <div class="vit-foot">
          ${sells
            ? `<label class="vit-switch"><span>No catálogo</span><span class="switch"><input type="checkbox" data-show="${esc(p.id)}" ${p.showInCatalog ? 'checked' : ''}><span class="track"><span class="thumb"></span></span></span></label>`
            : `<button type="button" class="btn btn-sm btn-primary btn-block" data-sell="${esc(p.id)}">${icon('store')} Pôr à venda</button>`}
        </div>
      </article>`;
  }

  function render() {
    const s = Data.settings();
    host.querySelector('[data-closed]').innerHTML = s.catalogEnabled ? '' : `
      <div class="alert" data-kind="warn">${icon('alert')}<div class="grow">O catálogo está <b>fechado</b>: ninguém vê a vitrine agora.</div>
        <button class="btn btn-sm" data-open-catalog>Abrir o catálogo</button></div>`;
    host.querySelector('[data-filters]').innerHTML = FILTERS.map((f) => {
      const n = Data.products().filter((p) => test(p, f.key)).length;
      return `<button type="button" class="chip sm" data-filter="${f.key}" aria-pressed="${f.key === st.filter}">${esc(f.label)}${n ? `<span class="chip-n">${n}</span>` : ''}</button>`;
    }).join('');
    host.querySelector('[data-hint]').textContent = FILTERS.find((f) => f.key === st.filter).hint;
    const items = list();
    const used = new Set(Data.products().filter((p) => test(p, st.filter)).map((p) => p.categoryId));
    const cats = Data.categories().filter((c) => used.has(c.id));
    if (st.cat && !used.has(st.cat)) st.cat = '';
    host.querySelector('[data-cats]').innerHTML = cats.length > 1 ? `
      <button type="button" class="chip sm" data-cat="" aria-pressed="${!st.cat}">Todas</button>
      ${cats.map((c) => `<button type="button" class="chip sm" data-cat="${esc(c.id)}" aria-pressed="${c.id === st.cat}"><span aria-hidden="true">${esc(c.emoji || '')}</span>${esc(c.name)}</button>`).join('')}` : '';
    if (!items.length) {
      const empty = {
        mostra: { emoji: '🛍️', title: 'Nada na vitrine ainda', text: 'Produto com preço (pronta entrega ou encomenda) aparece aqui. Adicione pelo Estoque ou cole a lista de encomenda no Catálogo.' },
        escondidos: { emoji: '👀', title: 'Nenhum produto escondido', text: 'Tudo que tem preço está aparecendo no catálogo.' },
        semfoto: { emoji: '📸', title: 'Todos com foto', text: 'Cada produto à mostra tem pelo menos uma foto.' },
        prontos: { emoji: '🗂️', title: 'Nenhum produto com foto esperando preço', text: 'Importe a pasta de fotos (no computador) ou ponha fotos em Produtos.' },
      }[st.filter];
      $grid.innerHTML = `<div class="card">${emptyState(empty)}</div>`;
      return;
    }
    $grid.innerHTML = `<div class="vit-grid">${items.map(cardHTML).join('')}</div>`;
  }

  host.addEventListener('click', (e) => {
    const t = e.target;
    const f = t.closest('[data-filter]');
    if (f) { st.filter = f.dataset.filter; setPref('vitrine.filter', st.filter); render(); return; }
    const c = t.closest('[data-cat]');
    if (c) { st.cat = c.dataset.cat; render(); return; }
    const o = t.closest('[data-open]');
    if (o) { openVitrineItem(o.dataset.open, { onDone: render }); return; }
    const sell = t.closest('[data-sell]');
    if (sell) { openQuickProduct({ productId: sell.dataset.sell, onDone: render }); return; }
    if (t.closest('[data-photo-import]')) { import('./photo-import.js').then((m) => m.openPhotoImport({ onDone: render })); return; }
    if (t.closest('[data-open-catalog]')) {
      Data.saveSettings({ catalogEnabled: true }).then(() => { toast('Catálogo aberto'); render(); })
        .catch((err) => toastError('Não foi possível abrir', friendlyError(err)));
    }
  });
  host.addEventListener('change', async (e) => {
    const sw = e.target.closest('[data-show]');
    if (!sw) return;
    const p = Data.product(sw.dataset.show);
    try {
      await Data.patchProducts([p.id], { showInCatalog: sw.checked });
      toast(sw.checked ? `${p.name} no catálogo` : `${p.name} saiu do catálogo`, { duration: 1800 });
    } catch (err) { sw.checked = !sw.checked; toastError('Não foi possível', friendlyError(err)); }
  });

  const unsub = Data.subscribe((changed) => {
    if (['products', 'units', 'categories', 'settings'].some((k) => changed.has(k))) render();
  });
  render();
  return {
    onSearch(q) { st.q = q; render(); },
    refresh: render,
    destroy() { unsub(); },
  };
}

/* =================================================================== */
/*  Ficha: foto do cartão, ordem das fotos e das cores, versões          */
/* =================================================================== */

export function openVitrineItem(productId, { onDone } = {}) {
  if (!Data.product(productId)) { toastError('Produto não encontrado.'); return null; }
  let ordering = null;      // cor sendo ordenada ('' = fotos do modelo)
  let picks = [];           // fotos tocadas, na ordem
  let busy = false;

  const p0 = Data.product(productId);
  const modal = openModal({
    title: p0.name,
    subtitle: [Data.category(p0.categoryId)?.name, 'Vitrine'].filter(Boolean).join(' · '),
    size: 'lg',
    body: '<div data-vit></div>',
    footer: `
      <button class="btn btn-ghost" data-full title="Abrir o modelo completo em Produtos">${icon('box')}<span>Modelo</span></button>
      <span class="grow"></span>
      <a class="btn" data-see target="_blank" rel="noopener">${icon('eye')}<span>Ver no catálogo</span></a>`,
  });
  const $v = modal.body.querySelector('[data-vit]');
  const product = () => Data.product(productId);

  const thumbs = (list, key) => list.map((u, i) => {
    const n = picks.indexOf(u);
    return `<button type="button" class="vit-thumb${ordering === key ? ' is-pickable' : ''}${n >= 0 ? ' is-picked' : ''}" data-pick="${esc(u)}" ${ordering === key ? '' : 'tabindex="-1"'} aria-label="Foto ${i + 1}">
      <img src="${esc(thumbUrl(u))}" data-full="${esc(u)}" alt="" loading="lazy">
      ${ordering === key ? (n >= 0 ? `<span class="vit-num">${n + 1}</span>` : '') : (i === 0 ? '<span class="vit-main">Principal</span>' : `<span class="vit-pos">${i + 1}</span>`)}
    </button>`;
  }).join('');

  function rowHTML(key, title, list, sub, i, total) {
    const isOrd = ordering === key;
    return `
      <div class="vit-color${isOrd ? ' is-ordering' : ''}" data-row="${esc(key)}">
        <div class="vit-color-head">
          <div class="grow" style="min-width:0"><div class="strong truncate">${esc(title)}</div><div class="xs dim">${sub}</div></div>
          ${key !== '' && total > 1 ? `
            <button type="button" class="icon-btn sm" data-move="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Subir a cor ${esc(title)}" title="Subir">${icon('arrowUp')}</button>
            <button type="button" class="icon-btn sm" data-move="${i}" data-dir="1" ${i === total - 1 ? 'disabled' : ''} aria-label="Descer a cor ${esc(title)}" title="Descer">${icon('arrowDown')}</button>` : ''}
          ${isOrd ? '' : `${list.length > 1 ? `<button type="button" class="btn btn-sm" data-order="${esc(key)}">${icon('layers')}<span>Ordenar</span></button>` : ''}
            <button type="button" class="btn btn-sm btn-ghost" data-edit="${esc(key)}">${icon(list.length ? 'edit' : 'camera')}<span>${list.length ? 'Fotos' : 'Pôr fotos'}</span></button>`}
        </div>
        ${list.length ? `<div class="vit-strip">${thumbs(list, key)}</div>` : '<p class="xs dim" style="margin:6px 0 0">Sem foto: o cliente vê esta cor sem imagem.</p>'}
        ${isOrd ? `
          <div class="vit-order-bar">
            <span class="small grow">${picks.length ? `${picks.length} de ${list.length} - as sem número ficam depois, na ordem de hoje.` : 'Toque nas fotos na ordem que você quer (a 1ª é a principal).'}</span>
            <button type="button" class="btn btn-sm btn-ghost" data-order-cancel>Cancelar</button>
            <button type="button" class="btn btn-sm btn-primary" data-order-save ${picks.length ? '' : 'disabled'}>${icon('check')} Salvar ordem</button>
          </div>` : ''}
      </div>`;
  }

  function render() {
    const p = product();
    if (!p) { modal.close(); return; }
    const s = Data.settings();
    const info = sellInfo(p);
    const colors = colorsOf(p);
    const cover = cardPhoto(p, info);
    const choice = coverChoice(p);
    const withPhoto = colors.filter((c) => photosOfColor(p, c).length);
    modal.foot.querySelector('[data-see]').href = catalogUrl(p.id);
    const status = !info.sellable.length ? '<span class="tone-amber">Sem preço: não aparece no catálogo.</span>'
      : !s.catalogEnabled ? '<span class="tone-amber">O catálogo está fechado.</span>'
      : info.visible ? `Aparece no catálogo · a partir de ${moneyHTML(info.min)}`
      : !p.showInCatalog ? 'Escondido do catálogo.' : !info.shown.length ? '<span class="tone-amber">Todas as versões estão escondidas.</span>' : 'A categoria está desativada.';

    const rows = colors.length
      ? colors.map((c, i) => {
        const vs = info.sellable.filter((v) => v.color === c);
        const sub = [`${photosOfColor(p, c).length} ${photosOfColor(p, c).length === 1 ? 'foto' : 'fotos'}`,
          vs.some(isReady) ? 'pronta entrega' : vs.length ? 'encomenda' : 'sem versão à venda'].join(' · ');
        return rowHTML(c, c, photosOfColor(p, c), esc(sub), i, colors.length);
      }).join('')
      : rowHTML('', 'Fotos do modelo', modelPhotos(p), `${modelPhotos(p).length} ${modelPhotos(p).length === 1 ? 'foto' : 'fotos'}`, 0, 1);

    $v.innerHTML = `
      <div class="vit-hero">
        <span class="vit-hero-photo">${cover ? `<img src="${esc(thumbUrl(cover))}" data-full="${esc(cover)}" alt="">` : `<span class="vit-nophoto">${icon('camera')}<span>Sem foto</span></span>`}</span>
        <div class="col gap-2 grow" style="min-width:0">
          <p class="small" style="margin:0">${status}</p>
          ${info.sellable.length ? `<label class="check-row"><span class="switch"><input type="checkbox" data-p-show ${p.showInCatalog ? 'checked' : ''}><span class="track"><span class="thumb"></span></span></span><span>Aparece no catálogo</span></label>` : `<button type="button" class="btn btn-primary btn-sm" data-sell style="align-self:flex-start">${icon('store')} Pôr à venda</button>`}
          <label class="check-row"><span class="switch"><input type="checkbox" data-p-feat ${p.featured ? 'checked' : ''}><span class="track"><span class="thumb"></span></span></span><span>Destaque <span class="xs dim">(aparece antes dos outros)</span></span></label>
        </div>
      </div>

      ${withPhoto.length > 1 || (withPhoto.length && choice) ? `
        <div class="fieldset">
          <div class="fieldset-title">Foto do cartão <span class="dim small" style="font-weight:400;text-transform:none;letter-spacing:0">a primeira coisa que o cliente vê</span></div>
          <div class="vit-covers">
            <button type="button" class="vit-cover${choice === '' ? ' is-on' : ''}" data-cover=""><span class="vit-cover-img">${icon('refresh')}</span><span>Automática</span></button>
            ${choice === '_model' ? `<button type="button" class="vit-cover is-on" data-cover="_model"><span class="vit-cover-img"><img src="${esc(thumbUrl(p.imageUrl))}" data-full="${esc(p.imageUrl)}" alt=""></span><span>Foto do modelo</span></button>` : ''}
            ${withPhoto.map((c) => `<button type="button" class="vit-cover${choice === c ? ' is-on' : ''}" data-cover="${esc(c)}">
              <span class="vit-cover-img"><img src="${esc(thumbUrl(photosOfColor(p, c)[0]))}" data-full="${esc(photosOfColor(p, c)[0])}" alt=""></span><span>${esc(c)}</span></button>`).join('')}
          </div>
        </div>` : ''}

      <div class="fieldset">
        <div class="fieldset-title">${colors.length ? 'Cores e fotos' : 'Fotos'} <span class="dim small" style="font-weight:400;text-transform:none;letter-spacing:0">${colors.length > 1 ? 'setas: ordem das cores na ficha · Ordenar: ordem das fotos' : 'Ordenar: ordem das fotos'}</span></div>
        <div class="vit-colors-list">${rows}</div>
      </div>

      ${info.sellable.length ? `
        <div class="fieldset">
          <div class="fieldset-title">Versões à venda <span class="dim small" style="font-weight:400;text-transform:none;letter-spacing:0">desligue a que não quer mostrar</span></div>
          <div class="vit-versions">
            ${info.sellable.map((v) => `
              <label class="vit-version${v.showInCatalog ? '' : ' is-off'}">
                <span class="grow" style="min-width:0"><span class="strong truncate block">${esc(variantLabel(v) || 'Padrão')}</span>
                  <span class="xs dim">${isReady(v) ? `Pronta entrega · ${v.stock} un · ${esc(money(v.price))}` : `Encomenda · ${esc(money(offerOf(v, s)))}${v.orderLead ? ` · ${esc(v.orderLead)}` : ''}`}</span></span>
                <span class="switch"><input type="checkbox" data-v-show="${esc(v.id)}" ${v.showInCatalog ? 'checked' : ''}><span class="track"><span class="thumb"></span></span></span>
              </label>`).join('')}
          </div>
        </div>` : ''}`;
  }

  /** Cor ordenada/editada era a do cartão: o cartão acompanha a nova 1ª foto. */
  async function followCover(oldFirst, newFirst) {
    const p = product();
    if (p?.imageUrl && oldFirst && p.imageUrl === oldFirst && newFirst && newFirst !== oldFirst) {
      await Data.saveProduct({ ...p, imageUrl: newFirst });
    }
  }

  async function run(fn, ok) {
    if (busy) return;
    busy = true;
    try { await fn(); if (ok) toast(ok, { duration: 1800 }); onDone?.(); } catch (err) { toastError('Não foi possível salvar', friendlyError(err)); } finally { busy = false; render(); }
  }

  modal.body.addEventListener('click', (e) => {
    const t = e.target;
    const p = product();
    if (ordering !== null) {
      const pk = t.closest('[data-pick]');
      if (pk && pk.closest(`[data-row="${CSS.escape(ordering)}"]`)) {
        const u = pk.dataset.pick;
        const i = picks.indexOf(u);
        if (i >= 0) picks.splice(i, 1); else picks.push(u);
        render();
        return;
      }
      if (t.closest('[data-order-cancel]')) { ordering = null; picks = []; render(); return; }
      if (t.closest('[data-order-save]')) {
        const key = ordering;
        const old = key === '' ? modelPhotos(p) : photosOfColor(p, key);
        const next = [...picks, ...old.filter((u) => !picks.includes(u))];
        ordering = null; picks = [];
        run(async () => {
          if (key === '') await Data.saveProduct({ ...p, imageUrl: next[0] || '', gallery: next.slice(1) });
          else { await Data.setColorPhotos(p.id, key, next); await followCover(old[0], next[0]); }
        }, 'Ordem das fotos salva');
        return;
      }
    }
    const ord = t.closest('[data-order]');
    if (ord) { ordering = ord.dataset.order; picks = []; render(); return; }
    const ed = t.closest('[data-edit]');
    if (ed) {
      const key = ed.dataset.edit;
      const oldFirst = key ? photosOfColor(p, key)[0] : '';
      openColorPhotos(p, key, { onDone: async () => {
        if (key) await followCover(oldFirst, photosOfColor(product(), key)[0]).catch(() => {});
        render(); onDone?.();
      } });
      return;
    }
    const mv = t.closest('[data-move]');
    if (mv && !mv.disabled) {
      const list = colorsOf(p);
      const i = Number(mv.dataset.move);
      const j = i + Number(mv.dataset.dir);
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      run(() => Data.saveProduct({ ...p, colors: list }), 'Ordem das cores salva');
      return;
    }
    const cv = t.closest('[data-cover]');
    if (cv) {
      const c = cv.dataset.cover;
      if (c === '_model' || c === coverChoice(p)) return;
      let gallery = p.gallery || [];
      // foto própria do modelo não se perde: vai para as fotos do modelo
      if (coverChoice(p) === '_model' && !gallery.includes(p.imageUrl)) gallery = [p.imageUrl, ...gallery].slice(0, 8);
      run(() => Data.saveProduct({ ...p, imageUrl: c ? photosOfColor(p, c)[0] : '', gallery }), c ? `Cartão com a foto ${c}` : 'Foto do cartão automática');
      return;
    }
    if (t.closest('[data-sell]')) { openQuickProduct({ productId: p.id, onDone: () => { render(); onDone?.(); } }); }
  });
  modal.body.addEventListener('change', (e) => {
    const t = e.target;
    const p = product();
    if (t.matches('[data-p-show]')) { run(() => Data.patchProducts([p.id], { showInCatalog: t.checked }), t.checked ? 'Aparece no catálogo' : 'Escondido do catálogo'); return; }
    if (t.matches('[data-p-feat]')) { run(() => Data.patchProducts([p.id], { featured: t.checked }), t.checked ? 'Em destaque' : 'Sem destaque'); return; }
    if (t.matches('[data-v-show]')) { run(() => Data.patchVariants([t.dataset.vShow], { showInCatalog: t.checked }), t.checked ? 'Versão à mostra' : 'Versão escondida'); }
  });
  modal.foot.querySelector('[data-full]').addEventListener('click', async () => {
    const m = await import('./products.js');
    m.openProductSheet(productId);
  });

  const unsub = Data.subscribe((changed) => { if (!busy && ordering === null && changed.has('products')) render(); });
  const close = modal.close;
  modal.close = (...a) => { unsub(); close(...a); };
  render();
  return modal;
}
