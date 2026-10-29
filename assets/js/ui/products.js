/**
 * Produtos: modelo → variações → aparelhos.
 *
 *   Lista       os modelos por categoria, com estoque e faixa de preço.
 *   Ficha       do modelo: foto, as variações (capacidade · cor · condição)
 *               com preço, custo, margem e estoque; reajuste de preços.
 *   Variação    preço/custo/mínimo, os APARELHOS (IMEI, bateria, origem,
 *               custo) ou o ajuste de quantidade, e o histórico.
 *
 * Estoque e custo nunca são digitados direto: entram pela Entrada, pelo
 * cadastro de aparelhos ou pelo ajuste - tudo vira movimento no histórico.
 */

import * as Data from '../core/data.js';
import { openQuickProduct } from './quick-product.js';
import { marginPct, variantLabel, round2 } from '../core/calc.js';
import { CONDITIONS, ORIGINS, MOVEMENT_KIND, ADJUST_REASONS, DISCARD_REASONS, UNIT_STATUS } from '../core/constants.js';
import { friendlyError, isInUse } from '../core/errors.js';
import { esc, money, parseMoney, moneyInputValue, formatDate, formatDateTime, toCSV, downloadFile, todayISO, thumbUrl } from '../core/utils.js';
import { openModal, confirmDialog, toast, toastError, withLoading, emptyState, openMenu } from './kit.js';
import { icon } from './icons.js';
import {
  matches, productThumb, stockBadge, variantStockBadge, code, moneyHTML, priceRangeHTML, catalogUrl,
  mountPhotoField, mountGalleryField, quickPhoto, pref, setPref, listToText, textToList,
} from './common.js';

const MONEY_ATTRS = 'inputmode="numeric" autocomplete="off" placeholder="0,00"';

const FILTERS = [
  { key: 'todos', label: 'Todos' },
  { key: 'estoque', label: 'Com estoque' },
  { key: 'baixo', label: 'Estoque baixo' },
  { key: 'sempreco', label: 'Sem preço' },
  { key: 'semfoto', label: 'Sem foto' },
  { key: 'encomenda', label: 'Sob encomenda' },
  { key: 'revisar', label: 'A confirmar' },
  { key: 'inativos', label: 'Inativos' },
];

/* =================================================================== */
/*  Lista                                                               */
/* =================================================================== */

export function mount(host, ctx) {
  const st = {
    q: '',
    filter: pref('products.filter', 'todos'),
    cat: pref('products.cat', ''),
  };

  host.innerHTML = `
    <div class="view">
      <div class="section-head">
        <div>
          <h2>Produtos</h2>
          <p class="small dim" data-count></p>
        </div>
        <div class="row gap-2 wrap">
          <button class="btn" data-export>${icon('download')}<span class="hide-mobile">Exportar</span></button>
          <button class="btn" data-olist title="Colar a lista do WhatsApp (pronta entrega ou encomenda)">${icon('copy')}<span class="hide-mobile">Lista do WhatsApp</span></button>
          <button class="btn" data-entry title="Entrada de mercadoria">${icon('truck')}<span class="hide-mobile">Entrada</span></button>
          <button class="btn btn-primary" data-new-product>${icon('plus')} Produto</button>
        </div>
      </div>

      <div class="grid grid-kpi" data-kpis></div>

      <div class="filters">
        <div class="chips filter-chips" data-filters>
          ${FILTERS.map((f) => `<button type="button" class="chip sm" data-filter="${f.key}" aria-pressed="${f.key === st.filter}">${esc(f.label)}<span class="chip-n" data-n="${f.key}"></span></button>`).join('')}
        </div>
        <div class="chips filter-chips" data-cats></div>
      </div>

      <div data-found></div>
      <div data-photo-tip></div>
      <div data-list></div>
    </div>`;

  const $list = host.querySelector('[data-list]');
  const $found = host.querySelector('[data-found]');

  function renderCats() {
    const cats = Data.categories();
    host.querySelector('[data-cats]').innerHTML = `
      <button type="button" class="chip sm" data-cat="" aria-pressed="${!st.cat}">Todas</button>
      ${cats.map((c) => `<button type="button" class="chip sm" data-cat="${esc(c.id)}" aria-pressed="${c.id === st.cat}">
        <span aria-hidden="true">${esc(c.emoji || '')}</span>${esc(c.name)}</button>`).join('')}`;
  }

  function test(p, key) {
    const vs = Data.variantsOf(p.id).filter((v) => v.active);
    switch (key) {
      case 'inativos': return !p.active;
      case 'estoque': return p.active && Data.productStock(p.id) > 0;
      case 'baixo': return p.active && vs.some((v) => v.minStock > 0 && v.stock <= v.minStock);
      case 'sempreco': return p.active && vs.some((v) => v.active && !(v.price > 0) && !v.onOrder);
      case 'encomenda': return p.active && vs.some((v) => v.onOrder && v.orderPrice > 0);
      case 'semfoto': return p.active && !p.imageUrl && !Object.keys(p.colorPhotos || {}).length;
      case 'revisar': return p.active && p.needsReview;
      default: return p.active;
    }
  }

  function filtered() {
    const rank = Data.salesRank(90);
    return Data.products().filter((p) => {
      if (!test(p, st.filter)) return false;
      if (st.cat && p.categoryId !== st.cat) return false;
      if (!st.q) return true;
      const vtext = Data.variantsOf(p.id).map((v) => [variantLabel(v), v.barcode, v.code].join(' ')).join(' ');
      return matches(st.q, p.name, p.brand, String(p.code), Data.category(p.categoryId)?.name, vtext);
    }).sort((a, b) => (Data.productStock(b.id) > 0) - (Data.productStock(a.id) > 0)
      || (rank.get(b.id) || 0) - (rank.get(a.id) || 0)
      || Number(a.needsReview) - Number(b.needsReview)
      || (b.year || 0) - (a.year || 0)
      || a.name.localeCompare(b.name, 'pt-BR'));
  }

  function renderKpis() {
    const sv = Data.stockValue();
    const low = Data.lowStock().length;
    const noPrice = Data.variants().filter((v) => v.active && Data.product(v.productId)?.active && !(v.price > 0)).length;
    const devices = Data.units().filter((u) => u.status === 'estoque').length;
    host.querySelector('[data-kpis]').innerHTML = `
      <div class="kpi"><div class="kpi-label">${icon('device')} Aparelhos em estoque</div>
        <div class="kpi-value num">${devices.toLocaleString('pt-BR')}</div>
        <div class="kpi-foot">${sv.units.toLocaleString('pt-BR')} unidades no total</div></div>
      <button type="button" class="kpi kpi-btn" data-go-filter="baixo"><div class="kpi-label">${icon('alert')} Estoque baixo</div>
        <div class="kpi-value num ${low ? 'tone-amber' : ''}">${low}</div><div class="kpi-foot">variações no mínimo</div></button>
      <button type="button" class="kpi kpi-btn" data-go-filter="sempreco"><div class="kpi-label">${icon('tag')} Sem preço</div>
        <div class="kpi-value num ${noPrice ? 'tone-amber' : ''}">${noPrice}</div><div class="kpi-foot">variações sem valor de venda</div></button>
      <div class="kpi"><div class="kpi-label">${icon('wallet')} Estoque a custo</div>
        <div class="kpi-value sm">${moneyHTML(sv.cost)}</div><div class="kpi-foot">a preço de venda: ${moneyHTML(sv.sale)}</div></div>`;
  }

  function renderCounts() {
    for (const f of FILTERS) {
      const el = host.querySelector(`[data-n="${f.key}"]`);
      if (!el) continue;
      const n = Data.products().filter((p) => test(p, f.key)).length;
      el.textContent = n && f.key !== 'todos' ? String(n) : '';
    }
  }

  /** IMEI digitado na busca: mostra o aparelho direto (em estoque, vendido ou baixado). */
  function renderFound() {
    const q = st.q.replace(/\s/g, '');
    if (q.length < 4 || !/\d{4,}/.test(q)) { $found.innerHTML = ''; return; }
    const units = Data.findUnitBySerial(q).slice(0, 8);
    if (!units.length) { $found.innerHTML = ''; return; }
    $found.innerHTML = `
      <div class="card found-units">
        <div class="card-head"><h3>${icon('device')} Aparelhos com esse IMEI</h3></div>
        <div class="mobile-list">
          ${units.map((u) => {
            const v = Data.variant(u.variantId);
            const p = v ? Data.product(v.productId) : null;
            const s = UNIT_STATUS[u.status];
            return `
              <button type="button" class="m-row" data-open-variant="${esc(u.variantId)}">
                ${productThumb(p, 'sm', v)}
                <span class="m-main">
                  <span class="m-title mono">${esc(u.serial)}</span>
                  <span class="m-sub">${esc(Data.variantTitle(v))}</span>
                </span>
                <span class="m-side"><span class="badge" data-tone="${s.tone}">${esc(s.label)}</span></span>
              </button>`;
          }).join('')}
        </div>
      </div>`;
  }

  function render() {
    renderKpis();
    renderCounts();
    renderCats();
    renderFound();
    host.querySelector('[data-photo-tip]').innerHTML = st.filter === 'semfoto' ? `
      <div class="alert" data-kind="info">${icon('camera')}<div><b>Modo fotografar:</b> toque no modelo e tire a foto -
        ela já fica salva e o modelo sai desta lista. Dá para fazer o estoque inteiro em sequência.</div></div>` : '';
    const items = filtered();
    host.querySelector('[data-count]').textContent = `${items.length} ${items.length === 1 ? 'modelo' : 'modelos'}`;
    if (!items.length) {
      const empty = !Data.products().length;
      $list.innerHTML = `<div class="card">${emptyState({
        emoji: empty ? '📱' : '🔎',
        title: empty ? 'Nenhum modelo cadastrado' : 'Nada com esse filtro',
        text: empty ? 'Rode o supabase/seed_catalogo.sql (113 modelos Apple, consoles e perfumes) ou cadastre o primeiro.'
          : 'Tente outra busca ou outro filtro.',
        action: `<button class="btn btn-primary" data-new-product>${icon('plus')} Cadastrar modelo</button>`,
      })}</div>`;
      return;
    }

    // Agrupa por categoria (na ordem das categorias); busca/filtro de categoria mostra direto.
    const groups = new Map();
    for (const p of items) {
      const key = st.cat || st.q ? '_' : (p.categoryId || '_none');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    const order = [...Data.categories().map((c) => c.id), '_none', '_'];
    $list.innerHTML = [...groups.entries()]
      .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
      .map(([key, list]) => {
        const c = Data.category(key);
        const title = key === '_' ? '' : (c ? `${c.emoji || ''} ${c.name}` : 'Sem categoria');
        return `
          <section class="product-group">
            ${title ? `<div class="fieldset-title">${esc(title)} <span class="dim">${list.length}</span></div>` : ''}
            <div class="card mobile-list product-list">
              ${list.map(rowHTML).join('')}
            </div>
          </section>`;
      }).join('');
  }

  function rowHTML(p) {
    const vs = Data.variantsOf(p.id).filter((v) => v.active);
    const stock = Data.productStock(p.id);
    const anyLow = vs.some((v) => v.minStock > 0 && v.stock <= v.minStock);
    const flags = [
      p.tracksSerial ? `<span class="tag">${icon('device')} IMEI</span>` : '',
      p.needsReview ? '<span class="tag tone-amber">a confirmar</span>' : '',
      !p.showInCatalog ? '<span class="tag">fora do catálogo</span>' : '',
      !p.active ? '<span class="tag">inativo</span>' : '',
    ].join('');
    return `
      <button type="button" class="m-row" data-open="${esc(p.id)}">
        ${productThumb(p, 'md')}
        <span class="m-main">
          <span class="m-title">${esc(p.name)}</span>
          <span class="m-sub">${vs.length ? `${vs.length} ${vs.length === 1 ? 'variação' : 'variações'}` : 'sem variações'} ${flags}</span>
        </span>
        <span class="m-side">
          <span class="strong">${vs.length ? priceRangeHTML(p.id) : ''}</span>
          ${vs.length ? (stock > 0 ? stockBadge(stock, anyLow ? stock : 0, { serial: p.tracksSerial, compact: false })
            : '<span class="badge" data-tone="gray">sem estoque</span>') : ''}
        </span>
      </button>`;
  }

  host.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-new-product]')) { openQuickProduct({ categoryId: st.cat || null, onDone: render }); return; }
    if (t.closest('[data-olist]')) {
      import('./order-list-import.js').then((m) => m.openOrderListImport({ onDone: () => { host.querySelector('[data-filter="encomenda"]')?.click(); } }));
      return;
    }
    if (t.closest('[data-entry]')) { ctx.go?.('entradas'); setTimeout(() => import('./purchases.js').then((m) => m.openPurchaseForm({})), 50); return; }
    if (t.closest('[data-export]')) { exportProducts(); return; }
    const f = t.closest('[data-filter]');
    if (f) {
      st.filter = f.dataset.filter;
      setPref('products.filter', st.filter);
      host.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b === f)));
      render();
      return;
    }
    const go = t.closest('[data-go-filter]');
    if (go) {
      st.filter = go.dataset.goFilter;
      host.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === st.filter)));
      render();
      return;
    }
    const c = t.closest('[data-cat]');
    if (c) { st.cat = c.dataset.cat; setPref('products.cat', st.cat); render(); return; }
    const ov = t.closest('[data-open-variant]');
    if (ov) { openVariantSheet(ov.dataset.openVariant); return; }
    const row = t.closest('[data-open]');
    if (!row) return;
    if (st.filter === 'semfoto') { photoMenu(row, Data.product(row.dataset.open)); return; }
    openProductSheet(row.dataset.open);
  });

  const unsub = Data.subscribe((changed) => {
    if (['products', 'units', 'categories'].some((k) => changed.has(k))) render();
  });

  render();
  return {
    onSearch(q) { st.q = q; render(); },
    refresh: render,
    destroy() { unsub(); },
  };
}

/* =================================================================== */
/*  Ficha do modelo                                                     */
/* =================================================================== */

export function openProductSheet(productId) {
  let p = Data.product(productId);
  if (!p) { toastError('Modelo não encontrado.'); return null; }

  const modal = openModal({
    title: p.name,
    subtitle: [Data.category(p.categoryId)?.name, p.brand, p.year].filter(Boolean).join(' · '),
    size: 'lg',
    body: '<div data-sheet></div>',
    footer: `
      <button class="icon-btn" data-more aria-label="Mais ações">${icon('more')}</button>
      <span class="grow"></span>
      <button class="btn" data-edit>${icon('edit')}<span class="hide-mobile">Editar modelo</span></button>
      <button class="btn" data-add-variants>${icon('layers')}<span class="hide-mobile">Variações</span></button>
      <button class="btn btn-primary" data-quick>${icon('store')}<span>Pôr à venda</span></button>`,
  });
  const $sheet = modal.body.querySelector('[data-sheet]');
  let editingPrices = false;

  function render() {
    p = Data.product(productId);
    if (!p) { modal.close(); return; }
    const cat = Data.category(p.categoryId);
    const vs = Data.variantsOf(p.id);
    const active = vs.filter((v) => v.active);
    const inactive = vs.filter((v) => !v.active);
    const stock = Data.productStock(p.id);

    $sheet.innerHTML = `
      <div class="product-hero">
        <button type="button" class="hero-photo${p.imageUrl ? '' : ' is-empty'}" data-hero aria-label="${p.imageUrl ? 'Ver foto' : 'Adicionar foto'}">
          ${productThumb(p, 'xl')}${p.imageUrl ? '' : `<span class="hero-photo-cta">${icon('camera')} Foto</span>`}
        </button>
        <div class="col gap-2 grow" style="min-width:0">
          <div class="row wrap gap-2">
            ${p.tracksSerial ? `<span class="badge no-dot" data-tone="indigo">${icon('device')} Controle por IMEI</span>` : '<span class="badge no-dot" data-tone="gray">Por quantidade</span>'}
            ${p.showInCatalog ? '<span class="badge no-dot" data-tone="green">No catálogo</span>' : '<span class="badge no-dot" data-tone="gray">Fora do catálogo</span>'}
            ${p.featured ? '<span class="badge no-dot" data-tone="amber">Destaque</span>' : ''}
            ${p.needsReview ? '<span class="badge no-dot" data-tone="amber">Especificações a confirmar</span>' : ''}
            ${!p.active ? '<span class="badge no-dot" data-tone="red">Inativo</span>' : ''}
          </div>
          <div class="hero-numbers">
            <div><span class="xs dim">Em estoque</span><span class="strong num">${stock} ${p.tracksSerial ? (stock === 1 ? 'aparelho' : 'aparelhos') : 'un'}</span></div>
            <div><span class="xs dim">Preço</span><span class="strong">${active.length ? priceRangeHTML(p.id) : '-'}</span></div>
            <div><span class="xs dim">Código</span><span class="mono">${code(p.code)}</span></div>
          </div>
          ${p.description ? `<p class="small muted clamp-3">${esc(p.description)}</p>` : ''}
          ${!p.storages.length && !p.colors.length && !p.sizes.length
            ? `<p class="xs dim">Sem opções cadastradas (${esc(cat?.variantLabel || 'capacidade')}, cor…): edite o modelo para facilitar as variações.</p>` : ''}
        </div>
      </div>

      ${colorPhotosHTML(active)}

      <div class="fieldset">
        <div class="fieldset-title">Variações (${active.length})
          ${active.length ? `<button type="button" class="btn btn-ghost btn-sm" data-toggle-prices>${icon(editingPrices ? 'x' : 'tag')} ${editingPrices ? 'Cancelar' : 'Editar preços'}</button>` : ''}
        </div>
        ${active.length ? `
          <div class="variant-list">
            ${active.map((v) => variantRowHTML(p, v)).join('')}
          </div>
          ${editingPrices ? `<div class="row gap-2" style="justify-content:flex-end;margin-top:10px">
            <button type="button" class="btn btn-primary" data-save-prices>${icon('check')} Salvar preços</button></div>` : ''}`
        : `<div class="empty compact">
            <div class="emoji">🧩</div>
            <h3>Nenhuma variação ainda</h3>
            <p>Cadastre as combinações que você vende (ex.: 128GB · Preto · Lacrado), cada uma com preço e estoque.</p>
            <button type="button" class="btn btn-primary" data-add-variants>${icon('plus')} Criar variações</button>
          </div>`}
        ${inactive.length ? `<details class="inactive-variants"><summary class="small dim">${inactive.length} ${inactive.length === 1 ? 'variação inativa' : 'variações inativas'}</summary>
          <div class="variant-list">${inactive.map((v) => variantRowHTML(p, v)).join('')}</div></details>` : ''}
      </div>`;
  }

  /** Uma foto por cor (fundo branco, como vitrine): vale para todas as variações da cor, até as de encomenda. */
  function colorPhotosHTML(active) {
    // as cores do modelo (mesmo sem estoque ainda) + as das variações
    const colors = [...new Set([...p.colors, ...active.map((v) => v.color)].filter(Boolean))]
      .filter((c) => !/^outra cor$/i.test(c))
      .sort((a, b) => (p.colors.indexOf(a) + 1 || 999) - (p.colors.indexOf(b) + 1 || 999));
    if (!colors.length) return '';
    return `
      <div class="fieldset">
        <div class="fieldset-title">Fotos por cor <span class="dim small" style="font-weight:400;text-transform:none;letter-spacing:0">o cliente vê a foto da cor que escolher</span></div>
        <div class="color-photos">
          ${colors.map((c) => {
            const photo = p.colorPhotos?.[c] || active.find((v) => v.color === c && v.imageUrl)?.imageUrl;
            return `<button type="button" class="color-photo${photo ? ' has-photo' : ''}" data-color-photo="${esc(c)}" aria-label="Foto da cor ${esc(c)}">
              <span class="color-photo-img">${photo ? `<span class="thumb thumb-md"><img src="${esc(thumbUrl(photo))}" data-full="${esc(photo)}" alt="" loading="lazy"></span>` : icon('camera')}</span>
              <span class="color-photo-name">${esc(c)}</span></button>`;
          }).join('')}
        </div>
      </div>`;
  }

  function variantRowHTML(prod, v) {
    const m = marginPct(v.price, v.cost);
    if (editingPrices && v.active) {
      return `
        <div class="variant-row is-editing">
          <span class="v-main"><span class="v-title">${esc(variantLabel(v) || 'Padrão')}</span>
            <span class="v-sub">custo ${moneyHTML(v.cost)}</span></span>
          <span class="money-input v-price-input"><input class="input" data-price="${esc(v.id)}" ${MONEY_ATTRS} value="${esc(moneyInputValue(v.price))}"></span>
        </div>`;
    }
    return `
      <button type="button" class="variant-row${v.active ? '' : ' is-muted'}" data-variant="${esc(v.id)}">
        ${v.imageUrl ? productThumb(prod, 'sm', v) : ''}
        <span class="v-main">
          <span class="v-title">${esc(variantLabel(v) || 'Padrão')}</span>
          <span class="v-sub">
            ${v.cost > 0 ? `custo ${moneyHTML(v.cost)}` : '<span class="tone-amber">sem custo</span>'}
            ${m != null && v.cost > 0 ? ` · <span class="num money-sensitive ${m < 10 ? 'tone-amber' : ''}">${m.toFixed(0)}%</span>` : ''}
            ${!v.showInCatalog ? ' · fora do catálogo' : ''}
            ${v.onOrder && v.orderPrice > 0 ? ` · <span class="tone-indigo">encomenda ${moneyHTML(v.orderPrice)}</span>` : ''}
          </span>
        </span>
        <span class="v-side">
          <span class="strong">${v.price > 0 ? moneyHTML(v.price) : v.onOrder && v.orderPrice > 0 ? '<span class="badge no-dot" data-tone="indigo">só encomenda</span>' : '<span class="badge no-dot" data-tone="amber">sem preço</span>'}</span>
          ${variantStockBadge(v, { compact: true })}
        </span>
      </button>`;
  }

  modal.panel.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.closest('[data-edit]')) { openProductForm(p, { onSaved: render }); return; }
    if (t.closest('[data-add-variants]')) { openVariantGenerator(p, { onDone: render }); return; }
    if (t.closest('[data-quick]')) { openQuickProduct({ productId: p.id, onDone: render }); return; }
    const hero = t.closest('[data-hero]');
    if (hero) {
      if (!p.imageUrl) { photoMenu(hero, p, render); return; }
      openPhotoViewer(p, render);
      return;
    }
    const cp = t.closest('[data-color-photo]');
    if (cp) {
      const color = cp.dataset.colorPhoto;
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.addEventListener('change', async () => {
        const f = input.files?.[0];
        if (!f) return;
        cp.classList.add('is-busy');
        try {
          const url = await Data.uploadProductImage(f, { square: true });
          const n = await Data.setColorPhoto(p.id, color, url);
          toast(`Foto da cor ${color}`, { text: n ? `Vale para ${n} ${n === 1 ? 'variação' : 'variações'} (pronta entrega e encomenda) e para as próximas.` : 'Vale para tudo que entrar nessa cor (pronta entrega e encomenda).' });
          render();
        } catch (err) { toastError('Não consegui salvar a foto', friendlyError(err)); cp.classList.remove('is-busy'); }
      });
      input.click();
      return;
    }
    const v = t.closest('[data-variant]');
    if (v) { openVariantSheet(v.dataset.variant, { onChange: render }); return; }
    if (t.closest('[data-toggle-prices]')) { editingPrices = !editingPrices; render(); return; }
    const save = t.closest('[data-save-prices]');
    if (save) {
      const items = [...modal.panel.querySelectorAll('[data-price]')].map((el) => ({
        variantId: el.dataset.price, price: parseMoney(el.value),
      }));
      await withLoading(save, async () => {
        try {
          const n = await Data.setPrices(items);
          toast(n ? `${n} ${n === 1 ? 'preço atualizado' : 'preços atualizados'}` : 'Nenhum preço mudou');
          editingPrices = false;
          render();
        } catch (err) { toastError('Não foi possível salvar os preços', friendlyError(err)); }
      });
      return;
    }
    const more = t.closest('[data-more]');
    if (more) {
      openMenu(more, [
        { label: 'Copiar link do catálogo', icon: 'link', onSelect: () => copyText(catalogUrl(p.id), 'Link copiado') },
        { label: p.showInCatalog ? 'Tirar do catálogo' : 'Mostrar no catálogo', icon: 'store',
          onSelect: () => Data.patchProducts([p.id], { showInCatalog: !p.showInCatalog }).then(render).catch((err) => toastError('Falhou', friendlyError(err))) },
        { label: p.active ? 'Desativar modelo' : 'Reativar modelo', icon: p.active ? 'eyeOff' : 'eye',
          onSelect: () => Data.patchProducts([p.id], { active: !p.active }).then(render).catch((err) => toastError('Falhou', friendlyError(err))) },
        { label: 'Excluir modelo', icon: 'trash', danger: true, separatorBefore: true, onSelect: () => removeProduct(p, modal) },
      ]);
    }
  });

  const unsub = Data.subscribe((changed) => {
    if (editingPrices) return; // não apaga o que a pessoa está digitando
    if (changed.has('products') || changed.has('units')) render();
  });
  const close = modal.close;
  modal.close = (...a) => { unsub(); close(...a); };

  render();
  return modal;
}

/** Câmera ou Galeria, e a foto já fica salva no modelo. */
function photoMenu(anchor, p, done) {
  if (!p) return;
  const run = async (camera) => {
    const ok = await quickPhoto(p, { camera });
    if (ok) { toast('Foto salva', { text: p.name, duration: 1800 }); done?.(); }
  };
  openMenu(anchor, [
    { label: 'Tirar foto (câmera)', icon: 'camera', onSelect: () => run(true) },
    { label: 'Escolher da galeria', icon: 'image', onSelect: () => run(false) },
  ]);
}

/** As fotos do modelo em tamanho grande, com atalho para adicionar mais. */
function openPhotoViewer(p, done) {
  const photos = [p.imageUrl, ...p.gallery].filter(Boolean);
  let i = 0;
  const m = openModal({
    title: p.name,
    subtitle: `${photos.length} ${photos.length === 1 ? 'foto' : 'fotos'}`,
    size: 'lg',
    body: `<div class="photo-viewer"><img class="photo-zoom" data-img alt="Foto de ${esc(p.name)}">
      ${photos.length > 1 ? `<div class="photo-dots">${photos.map((_, j) => `<button type="button" class="photo-dot" data-dot="${j}" aria-label="Foto ${j + 1}"></button>`).join('')}</div>` : ''}</div>`,
    footer: `<button class="btn" data-add-more>${icon('camera')} Adicionar fotos</button><span class="grow"></span>
      <button class="btn btn-primary" data-edit-photos>${icon('edit')} Organizar</button>`,
  });
  const show = () => {
    m.body.querySelector('[data-img]').src = photos[i];
    m.body.querySelectorAll('[data-dot]').forEach((d) => d.setAttribute('aria-pressed', String(Number(d.dataset.dot) === i)));
  };
  m.body.addEventListener('click', (e) => {
    const d = e.target.closest('[data-dot]');
    if (d) { i = Number(d.dataset.dot); show(); return; }
    if (e.target.closest('[data-img]') && photos.length > 1) { i = (i + 1) % photos.length; show(); }
  });
  m.foot.querySelector('[data-add-more]').addEventListener('click', (e) => { m.close(); photoMenu(e.currentTarget, p, done); });
  m.foot.querySelector('[data-edit-photos]').addEventListener('click', () => { m.close(); openProductForm(Data.product(p.id) || p, { onSaved: done }); });
  show();
}

async function removeProduct(p, sheet) {
  const ok = await confirmDialog({
    title: `Excluir ${p.name}?`,
    message: 'Só dá para excluir um modelo que nunca teve pedido, entrada nem aparelho. Com histórico, o certo é desativar.',
    confirmText: 'Excluir', danger: true,
  });
  if (!ok) return;
  try {
    await Data.deleteProduct(p.id);
    toast('Modelo excluído');
    sheet?.close();
  } catch (err) {
    if (isInUse(err)) {
      const off = await confirmDialog({
        title: 'Este modelo tem histórico',
        message: `${friendlyError(err)}\n\nDesativado, ele some do pedido e do catálogo, e os relatórios continuam certos.`,
        confirmText: 'Desativar',
      });
      if (off) await Data.patchProducts([p.id], { active: false }).then(() => toast('Modelo desativado')).catch((e2) => toastError('Falhou', friendlyError(e2)));
    } else toastError('Não foi possível excluir', friendlyError(err));
  }
}

function copyText(text, msg) {
  navigator.clipboard?.writeText(text).then(() => toast(msg)).catch(() => {
    window.prompt('Copie:', text);
  });
}

/* =================================================================== */
/*  Cadastro do modelo                                                  */
/* =================================================================== */

export function openProductForm(input = {}, { onSaved } = {}) {
  const editing = !!input.id;
  const cat0 = Data.category(input.categoryId);
  const d = {
    id: input.id || null,
    name: input.name || '',
    categoryId: input.categoryId || Data.categories()[0]?.id || null,
    brand: input.brand ?? (editing ? '' : 'Apple'),
    year: input.year || '',
    description: input.description || '',
    imageUrl: input.imageUrl || '',
    gallery: input.gallery || [],
    storages: input.storages || [],
    colors: input.colors || [],
    sizes: input.sizes || [],
    tracksSerial: editing ? !!input.tracksSerial : !!(cat0 || Data.categories()[0])?.tracksSerial,
    showInCatalog: input.showInCatalog !== false,
    featured: !!input.featured,
    needsReview: !!input.needsReview,
    notes: input.notes || '',
    active: input.active !== false,
  };
  const initial = JSON.stringify(d);
  const hasHistory = editing && Data.variantsOf(d.id).some((v) => v.stock !== 0 || Data.unitsOf(v.id).length);
  const labels = () => {
    const c = Data.category(d.categoryId);
    return { v: c?.variantLabel || 'Capacidade / versão', c: c?.colorLabel || 'Cor', s: c?.sizeLabel || 'Tamanho' };
  };
  const l = labels();

  const modal = openModal({
    title: editing ? 'Editar modelo' : 'Novo modelo',
    subtitle: editing ? d.name : 'O modelo é o aparelho; as variações (capacidade, cor, condição) vêm depois',
    size: 'lg',
    body: `
      <div class="form-grid">
        <div class="field span-12"><label class="label" for="pf-name">Nome do modelo *</label>
          <input class="input" id="pf-name" name="name" maxlength="120" value="${esc(d.name)}" placeholder="ex.: iPhone 16 Pro Max" data-autofocus></div>
        <div class="field span-6 span-half-mobile"><label class="label" for="pf-cat">Categoria</label>
          <select class="select" id="pf-cat" name="categoryId">
            ${Data.categories().map((c) => `<option value="${esc(c.id)}" ${c.id === d.categoryId ? 'selected' : ''}>${esc(c.emoji || '')} ${esc(c.name)}</option>`).join('')}
            <option value="" ${!d.categoryId ? 'selected' : ''}>Sem categoria</option>
          </select></div>
        <div class="field span-3 span-half-mobile"><label class="label" for="pf-brand">Marca</label>
          <input class="input" id="pf-brand" name="brand" maxlength="60" value="${esc(d.brand)}" placeholder="Apple"></div>
        <div class="field span-3 span-half-mobile"><label class="label" for="pf-year">Ano</label>
          <input class="input" id="pf-year" name="year" type="text" inputmode="numeric" maxlength="4" value="${esc(d.year)}" placeholder="2025"></div>

        <div class="field span-12">
          <label class="check switch-row">
            <input type="checkbox" name="tracksSerial" ${d.tracksSerial ? 'checked' : ''} ${hasHistory ? 'disabled' : ''}>
            <span class="box"></span>
            <span><b>Cada unidade tem IMEI / número de série</b>
              <span class="xs dim block">${hasHistory ? 'Não dá mais para trocar: o modelo já tem estoque ou vendas.' : 'iPhone, iPad, Watch, Mac, consoles. O estoque passa a ser aparelho por aparelho (garantia e troca rastreáveis).'}</span></span>
          </label>
        </div>

        <div class="span-12 fieldset-title" style="margin-top:4px">Opções do modelo <span class="xs dim">(separe por vírgula)</span></div>
        <div class="field span-12"><label class="label" for="pf-storages" data-lbl-v>${esc(l.v)}</label>
          <input class="input" id="pf-storages" name="storages" value="${esc(listToText(d.storages))}" placeholder="128GB, 256GB, 512GB, 1TB"></div>
        <div class="field span-12"><label class="label" for="pf-colors" data-lbl-c>${esc(l.c)}</label>
          <input class="input" id="pf-colors" name="colors" value="${esc(listToText(d.colors))}" placeholder="Preto, Branco, Azul"></div>
        <div class="field span-12"><label class="label" for="pf-sizes" data-lbl-s>${esc(l.s)} <span class="dim">(opcional)</span></label>
          <input class="input" id="pf-sizes" name="sizes" value="${esc(listToText(d.sizes))}" placeholder="ex.: 42mm, 46mm"></div>

        <div class="span-12 fieldset-title" style="margin-top:4px">Catálogo</div>
        <div class="field span-12"><span class="label">Fotos <span class="dim">(a primeira é a capa)</span></span><div data-photo></div></div>
        <div class="field span-12"><label class="label" for="pf-desc">Descrição para o cliente</label>
          <textarea class="textarea" id="pf-desc" name="description" maxlength="1000" rows="5"
            placeholder="Tela, câmera, bateria, o que vem na caixa, garantia…">${esc(d.description)}</textarea></div>
        <div class="field span-6">
          <label class="check"><input type="checkbox" name="showInCatalog" ${d.showInCatalog ? 'checked' : ''}><span class="box"></span><span>Aparece no catálogo</span></label>
        </div>
        <div class="field span-6">
          <label class="check"><input type="checkbox" name="featured" ${d.featured ? 'checked' : ''}><span class="box"></span><span>Destaque (aparece primeiro)</span></label>
        </div>

        <div class="span-12 fieldset-title" style="margin-top:4px">Interno</div>
        <div class="field span-12"><label class="label" for="pf-notes">Observações internas <span class="dim">(não aparecem no catálogo)</span></label>
          <input class="input" id="pf-notes" name="notes" maxlength="1000" value="${esc(d.notes)}"></div>
        ${d.needsReview ? `<div class="field span-12"><label class="check"><input type="checkbox" name="reviewed"><span class="box"></span>
          <span>Conferi as cores e capacidades (tirar o aviso "a confirmar")</span></label></div>` : ''}
        ${editing ? `<div class="field span-12"><label class="check"><input type="checkbox" name="active" ${d.active ? 'checked' : ''}><span class="box"></span><span>Modelo ativo (desmarcado: some do pedido e do catálogo)</span></label></div>` : ''}
      </div>
      <div class="alert hide" data-erro data-kind="warn">${icon('alert')}<div data-erro-txt></div></div>`,
    footer: `
      <button class="btn btn-ghost" data-close>Cancelar</button>
      <button class="btn btn-primary" data-ok>${editing ? 'Salvar' : 'Cadastrar modelo'}</button>`,
    beforeClose: async () => {
      read();
      if (JSON.stringify(d) === initial && !photo.toDelete(false).length) return true;
      const ok = await confirmDialog({ title: 'Descartar as alterações?', message: 'O que você mudou no modelo não foi salvo.',
        confirmText: 'Descartar', cancelText: 'Continuar editando', danger: true });
      if (ok) { photo.toDelete(false).forEach((u) => Data.deleteProductImage(u)); photo.dispose(); }
      return ok;
    },
  });

  const photo = mountGalleryField(modal.body.querySelector('[data-photo]'), { cover: d.imageUrl, gallery: d.gallery, label: d.name });
  const $ = (n) => modal.body.querySelector(`[name="${n}"]`);

  function read() {
    d.name = $('name').value.trim();
    d.categoryId = $('categoryId').value || null;
    d.brand = $('brand').value.trim();
    d.year = $('year').value.replace(/\D/g, '');
    d.tracksSerial = $('tracksSerial').checked;
    d.storages = textToList($('storages').value);
    d.colors = textToList($('colors').value);
    d.sizes = textToList($('sizes').value);
    d.description = $('description').value.trim();
    d.showInCatalog = $('showInCatalog').checked;
    d.featured = $('featured').checked;
    d.notes = $('notes').value.trim();
    if ($('reviewed')?.checked) d.needsReview = false;
    if ($('active')) d.active = $('active').checked;
    d.imageUrl = photo.cover;
    d.gallery = photo.gallery;
  }

  // Trocar a categoria ajusta os rótulos e (cadastro novo) o controle por IMEI.
  $('categoryId').addEventListener('change', () => {
    const lb = labels();
    modal.body.querySelector('[data-lbl-v]').textContent = lb.v;
    modal.body.querySelector('[data-lbl-c]').textContent = lb.c;
    if (!editing) $('tracksSerial').checked = !!Data.category($('categoryId').value)?.tracksSerial;
  });

  const showError = (msg, focus) => {
    modal.body.querySelector('[data-erro-txt]').textContent = msg;
    modal.body.querySelector('[data-erro]').classList.remove('hide');
    if (focus) $(focus)?.focus();
  };

  modal.foot.querySelector('[data-ok]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    read();
    if (!d.name) { showError('Dê um nome ao modelo.', 'name'); return; }
    if (photo.busy) { showError('Espere as fotos terminarem de enviar.'); return; }
    const dup = Data.products().find((x) => x.id !== d.id && x.name.trim().toLowerCase() === d.name.toLowerCase());
    if (dup && !editing) {
      const go = await confirmDialog({ title: 'Já existe um modelo com esse nome', message: `"${dup.name}" já está cadastrado. Cadastrar outro mesmo assim?`, confirmText: 'Cadastrar outro' });
      if (!go) return;
    }
    await withLoading(btn, async () => {
      try {
        const saved = await Data.saveProduct(d);
        photo.toDelete(true).forEach((u) => Data.deleteProductImage(u, { except: saved.id }));
        photo.dispose();
        modal.close();
        toast(editing ? 'Modelo atualizado' : 'Modelo cadastrado');
        onSaved?.(saved);
        if (!editing) {
          openProductSheet(saved.id);
          if (saved.storages.length || saved.colors.length || saved.sizes.length) openVariantGenerator(saved);
        }
      } catch (err) {
        showError(friendlyError(err));
      }
    });
  });

  return modal;
}

/* =================================================================== */
/*  Gerador de variações (capacidades × cores × condições)              */
/* =================================================================== */

export function openVariantGenerator(p, { onDone } = {}) {
  const cat = Data.category(p.categoryId);
  const sel = {
    storages: new Set(p.storages.length === 1 ? p.storages : []),
    colors: new Set(p.colors.length === 1 ? p.colors : []),
    sizes: new Set(p.sizes.length === 1 ? p.sizes : []),
    conditions: new Set(['Lacrado']),
  };
  const extra = { storages: [], colors: [], sizes: [] };
  const prices = new Map();   // chave da combinação → preço digitado
  let basePrice = 0;
  let baseStock = 0;

  const groups = [
    { key: 'sizes', label: cat?.sizeLabel || 'Tamanho', options: () => [...p.sizes, ...extra.sizes] },
    { key: 'storages', label: cat?.variantLabel || 'Capacidade / versão', options: () => [...p.storages, ...extra.storages] },
    { key: 'colors', label: cat?.colorLabel || 'Cor', options: () => [...p.colors, ...extra.colors] },
    { key: 'conditions', label: 'Condição', options: () => CONDITIONS },
  ];

  const modal = openModal({
    title: 'Criar variações',
    subtitle: p.name,
    size: 'lg',
    body: '<div data-gen></div>',
    footer: `
      <span class="small dim grow" data-gen-count></span>
      <button class="btn btn-ghost" data-close>Cancelar</button>
      <button class="btn btn-primary" data-ok disabled>Criar</button>`,
  });
  const $gen = modal.body.querySelector('[data-gen]');
  const $ok = modal.foot.querySelector('[data-ok]');

  const keyOf = (c) => [c.size, c.storage, c.color, c.condition].join('|').toLowerCase();

  function combos() {
    const list = (k) => (groups.find((g) => g.key === k).options().length ? [...sel[k]] : ['']);
    const out = [];
    for (const size of list('sizes')) for (const storage of list('storages')) for (const color of list('colors')) {
      for (const condition of [...sel.conditions]) out.push({ size, storage, color, condition });
    }
    return out;
  }

  function render() {
    const all = combos();
    const fresh = all.filter((c) => !Data.findVariant(p.id, c));
    const exists = all.length - fresh.length;
    $gen.innerHTML = `
      ${groups.map((g) => {
        const opts = g.options();
        if (!opts.length && g.key !== 'storages' && g.key !== 'colors') return '';
        return `
          <div class="config-field">
            <span class="label">${esc(g.label)} <span class="dim xs">(marque um ou vários)</span></span>
            <div class="chips">
              ${opts.map((o) => `<button type="button" class="chip sm" data-pick="${g.key}" data-value="${esc(o)}" aria-pressed="${sel[g.key].has(o)}">${esc(o)}</button>`).join('')}
              ${g.key !== 'conditions' ? `<button type="button" class="chip sm chip-add" data-add-opt="${g.key}">${icon('plus')} outra</button>` : ''}
            </div>
          </div>`;
      }).join('')}

      <div class="form-grid" style="margin-top:6px">
        <div class="field span-6 span-half-mobile"><label class="label" for="vg-price">Preço de venda (para todas)</label>
          <div class="money-input"><input class="input" id="vg-price" ${MONEY_ATTRS} value="${esc(moneyInputValue(basePrice))}"></div></div>
        ${p.tracksSerial ? '' : `<div class="field span-6 span-half-mobile"><label class="label" for="vg-stock">Estoque inicial (cada)</label>
          <input class="input" id="vg-stock" type="number" inputmode="numeric" min="0" max="9999" value="${esc(baseStock)}"></div>`}
      </div>
      ${p.tracksSerial ? `<p class="xs dim">${icon('info')} Os aparelhos (com IMEI e custo) entram depois, pela Entrada ou em "Cadastrar aparelhos" na variação.</p>` : ''}

      ${all.length ? `
        <div class="fieldset-title">Prévia · ${fresh.length} ${fresh.length === 1 ? 'nova' : 'novas'}${exists ? ` · ${exists} já ${exists === 1 ? 'existe' : 'existem'}` : ''}</div>
        <div class="variant-list">
          ${all.map((c) => {
            const has = Data.findVariant(p.id, c);
            const k = keyOf(c);
            return `
              <div class="variant-row is-editing${has ? ' is-muted' : ''}">
                <span class="v-main"><span class="v-title">${esc(variantLabel(c) || 'Padrão')}</span>
                  ${has ? '<span class="v-sub">já cadastrada</span>' : ''}</span>
                ${has ? '' : `<span class="money-input v-price-input"><input class="input" data-combo-price="${esc(k)}" ${MONEY_ATTRS}
                  value="${esc(moneyInputValue(prices.has(k) ? prices.get(k) : basePrice))}"></span>`}
              </div>`;
          }).join('')}
        </div>` : '<p class="small dim">Marque as opções acima para ver as combinações.</p>'}`;

    modal.foot.querySelector('[data-gen-count]').textContent = fresh.length ? `${fresh.length} ${fresh.length === 1 ? 'variação' : 'variações'}` : '';
    $ok.disabled = !fresh.length;
    $ok.textContent = fresh.length ? `Criar ${fresh.length}` : 'Criar';
  }

  modal.body.addEventListener('click', async (e) => {
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      const set = sel[pick.dataset.pick];
      const v = pick.dataset.value;
      set.has(v) ? set.delete(v) : set.add(v);
      render();
      return;
    }
    const add = e.target.closest('[data-add-opt]');
    if (add) {
      const g = groups.find((x) => x.key === add.dataset.addOpt);
      const val = (window.prompt(`Nova opção de ${g.label.toLowerCase()}:`) || '').trim();
      if (!val) return;
      if (!g.options().includes(val)) extra[g.key].push(val);
      sel[g.key].add(val);
      render();
    }
  });

  modal.body.addEventListener('input', (e) => {
    if (e.target.id === 'vg-price') {
      basePrice = parseMoney(e.target.value);
      // As linhas que a pessoa não mexeu acompanham o preço geral.
      modal.body.querySelectorAll('[data-combo-price]').forEach((el) => {
        if (!prices.has(el.dataset.comboPrice)) el.value = moneyInputValue(basePrice);
      });
    }
    if (e.target.id === 'vg-stock') baseStock = Math.max(Math.trunc(Number(e.target.value) || 0), 0);
    const cp = e.target.closest('[data-combo-price]');
    if (cp) prices.set(cp.dataset.comboPrice, parseMoney(cp.value));
  });

  $ok.addEventListener('click', async () => {
    const fresh = combos().filter((c) => !Data.findVariant(p.id, c));
    if (!fresh.length) return;
    // Opções novas digitadas aqui entram no modelo (aparecem no pedido e no catálogo).
    const grow = (k) => [...new Set([...p[k], ...extra[k].filter((x) => sel[k].has(x))])];
    await withLoading($ok, async () => {
      try {
        if (extra.storages.length || extra.colors.length || extra.sizes.length) {
          await Data.saveProduct({ ...p, storages: grow('storages'), colors: grow('colors'), sizes: grow('sizes') });
        }
        const list = fresh.map((c) => ({
          ...c, price: prices.has(keyOf(c)) ? prices.get(keyOf(c)) : basePrice, stock: p.tracksSerial ? 0 : baseStock,
        }));
        await Data.createVariants(p.id, list);
        toast(`${list.length} ${list.length === 1 ? 'variação criada' : 'variações criadas'}`);
        modal.close();
        onDone?.();
      } catch (err) {
        toastError('Não foi possível criar', friendlyError(err));
      }
    });
  });

  render();
  return modal;
}

/* =================================================================== */
/*  Ficha da variação                                                   */
/* =================================================================== */

export function openVariantSheet(variantId, { onChange } = {}) {
  let v = Data.variant(variantId);
  if (!v) { toastError('Variação não encontrada.'); return null; }
  let p = Data.product(v.productId);
  let showSold = false;
  let movements = null;

  const modal = openModal({
    title: variantLabel(v) || 'Padrão',
    subtitle: p?.name || '',
    size: 'lg',
    body: '<div data-vsheet></div>',
    footer: `
      <button class="icon-btn" data-vmore aria-label="Mais ações">${icon('more')}</button>
      <span class="grow"></span>
      <button class="btn" data-vedit>${icon('edit')}<span>Editar</span></button>
      ${p?.tracksSerial
        ? `<button class="btn btn-primary" data-add-units>${icon('plus')}<span>Aparelhos</span></button>`
        : `<button class="btn btn-primary" data-adjust>${icon('layers')}<span>Ajustar estoque</span></button>`}`,
  });
  const $s = modal.body.querySelector('[data-vsheet]');

  function render() {
    v = Data.variant(variantId);
    if (!v) { modal.close(); return; }
    p = Data.product(v.productId);
    const m = marginPct(v.price, v.cost);
    const units = Data.unitsOf(v.id);
    const inStock = units.filter((u) => u.status === 'estoque');
    const others = units.filter((u) => u.status !== 'estoque').sort((a, b) => String(b.soldAt || b.updatedAt).localeCompare(String(a.soldAt || a.updatedAt)));

    $s.innerHTML = `
      <div class="hero-numbers wide">
        <div><span class="xs dim">Preço</span><span class="strong">${v.price > 0 ? moneyHTML(v.price) : '<span class="tone-amber">sem preço</span>'}</span></div>
        <div><span class="xs dim">Custo médio</span><span>${v.cost > 0 ? moneyHTML(v.cost) : '<span class="dim">-</span>'}</span></div>
        <div><span class="xs dim">Margem</span><span class="num money-sensitive ${m != null && m < 10 ? 'tone-amber' : ''}">${m != null && v.cost > 0 ? `${m.toFixed(1)}%` : '-'}</span></div>
        <div><span class="xs dim">Estoque</span>${variantStockBadge(v)}</div>
        <div><span class="xs dim">Mínimo</span><span class="num">${v.minStock}</span></div>
        <div><span class="xs dim">SKU</span><span class="mono">${code(v.code)}</span></div>
      </div>
      <div class="row wrap gap-2">
        ${v.showInCatalog ? '<span class="badge no-dot" data-tone="green">No catálogo</span>' : '<span class="badge no-dot" data-tone="gray">Fora do catálogo</span>'}
        ${v.onOrder && v.orderPrice > 0 ? `<span class="badge no-dot" data-tone="indigo">Sob encomenda ${esc(money(v.orderPrice))}${v.orderLead ? ` · ${esc(v.orderLead)}` : ''}</span>` : ''}
        ${!v.active ? '<span class="badge no-dot" data-tone="red">Inativa</span>' : ''}
        ${v.barcode ? `<span class="tag">${icon('tag')} ${esc(v.barcode)}</span>` : ''}
      </div>

      ${p?.tracksSerial ? `
        <div class="fieldset">
          <div class="fieldset-title">Aparelhos em estoque (${inStock.length})</div>
          ${inStock.length ? `<div class="unit-list">${inStock.map(unitRowHTML).join('')}</div>`
            : `<p class="small dim">Nenhum aparelho desta variação na loja. Lance pela <b>Entrada</b> (compra do fornecedor) ou em <b>Aparelhos</b> (estoque que já está aqui, troca).</p>`}
          ${others.length ? `
            <button type="button" class="btn btn-ghost btn-sm" data-toggle-sold>${icon(showSold ? 'chevronDown' : 'chevronRight')}
              ${showSold ? 'Esconder' : 'Ver'} vendidos e baixados (${others.length})</button>
            ${showSold ? `<div class="unit-list">${others.map(unitRowHTML).join('')}</div>` : ''}` : ''}
        </div>` : ''}

      <div class="fieldset">
        <div class="fieldset-title">Histórico</div>
        <div data-movements>${movements ? movementsHTML(movements) : `<button type="button" class="btn btn-sm" data-load-mov>${icon('clock')} Ver histórico de estoque</button>`}</div>
      </div>`;
  }

  function unitRowHTML(u) {
    const s = UNIT_STATUS[u.status];
    const ord = u.orderId ? Data.order(u.orderId) : null;
    const details = [
      u.origin,
      u.batteryHealth != null ? `bateria ${u.batteryHealth}%` : '',
      u.status === 'vendido' && ord ? `pedido ${code(ord.code)} · ${esc(ord.customerName)}` : '',
      u.status === 'vendido' && !ord && u.soldAt ? `vendido em ${formatDate(u.soldAt)}` : '',
      u.notes,
    ].filter(Boolean);
    return `
      <div class="unit-row" data-unit="${esc(u.id)}">
        <span class="u-main">
          <span class="u-serial mono">${esc(u.serial || 'sem IMEI')}</span>
          <span class="u-sub">${details.map((x) => esc(x)).join(' · ') || '<span class="dim">-</span>'}</span>
        </span>
        <span class="u-side">
          <span class="num money-sensitive small">${esc(money(u.cost))}</span>
          ${u.status === 'estoque' ? '' : `<span class="badge no-dot" data-tone="${s.tone}">${esc(s.label)}</span>`}
        </span>
        <button type="button" class="icon-btn sm" data-unit-menu="${esc(u.id)}" aria-label="Ações do aparelho">${icon('more')}</button>
      </div>`;
  }

  function movementsHTML(list) {
    if (!list.length) return '<p class="small dim">Nenhuma movimentação ainda.</p>';
    return `<div class="movement-list">${list.map((m) => {
      const k = MOVEMENT_KIND[m.kind] || { label: m.kind, tone: 'gray' };
      const unitSerial = m.unitId ? Data.unit(m.unitId)?.serial : '';
      return `
        <div class="movement-row">
          <span class="badge no-dot" data-tone="${k.tone}">${esc(k.label)}</span>
          <span class="grow small">${esc(m.note || '')}${unitSerial ? ` · <span class="mono">${esc(unitSerial)}</span>` : ''}
            <span class="xs dim block">${esc(formatDateTime(m.createdAt))}</span></span>
          <span class="num strong ${m.qty > 0 ? 'pos' : 'neg'}">${m.qty > 0 ? '+' : ''}${m.qty}</span>
        </div>`;
    }).join('')}</div>`;
  }

  async function loadMovements() {
    try {
      movements = await Data.variantMovements(variantId);
    } catch (err) {
      toastError('Não consegui buscar o histórico', friendlyError(err));
      movements = null;
    }
    render();
  }

  modal.panel.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-vedit]')) { openVariantForm(v, { onSaved: () => { render(); onChange?.(); } }); return; }
    if (t.closest('[data-add-units]')) { openAddUnits(v, { onDone: () => { movements = null; render(); onChange?.(); } }); return; }
    if (t.closest('[data-adjust]')) { openAdjustStock(v, { onDone: () => { movements = null; render(); onChange?.(); } }); return; }
    if (t.closest('[data-toggle-sold]')) { showSold = !showSold; render(); return; }
    if (t.closest('[data-load-mov]')) { loadMovements(); return; }
    const um = t.closest('[data-unit-menu]');
    if (um) { unitMenu(um, Data.unit(um.dataset.unitMenu), () => { movements = null; render(); onChange?.(); }); return; }
    const more = t.closest('[data-vmore]');
    if (more) {
      openMenu(more, [
        { label: v.showInCatalog ? 'Tirar do catálogo' : 'Mostrar no catálogo', icon: 'store',
          onSelect: () => Data.patchVariants([v.id], { showInCatalog: !v.showInCatalog }).then(render).catch((err) => toastError('Falhou', friendlyError(err))) },
        { label: v.active ? 'Desativar variação' : 'Reativar variação', icon: v.active ? 'eyeOff' : 'eye',
          onSelect: () => Data.patchVariants([v.id], { active: !v.active }).then(() => { render(); onChange?.(); }).catch((err) => toastError('Falhou', friendlyError(err))) },
        { label: 'Excluir variação', icon: 'trash', danger: true, separatorBefore: true, onSelect: () => removeVariant(v, modal, onChange) },
      ]);
    }
  });

  const unsub = Data.subscribe((changed) => { if (changed.has('products') || changed.has('units')) render(); });
  const close = modal.close;
  modal.close = (...a) => { unsub(); close(...a); };

  render();
  return modal;
}

function unitMenu(anchor, u, done) {
  if (!u) return;
  const items = [
    { label: 'Corrigir dados do aparelho', icon: 'edit', onSelect: () => openUnitForm(u, { onDone: done }) },
    { label: 'Copiar IMEI', icon: 'copy', onSelect: () => copyText(u.serial, 'IMEI copiado') },
  ];
  if (u.status === 'estoque') items.push({ label: 'Dar baixa (defeito, devolução…)', icon: 'trash', danger: true, separatorBefore: true, onSelect: () => openDiscardUnit(u, { onDone: done }) });
  if (u.status === 'baixa') items.push({ label: 'Desfazer a baixa', icon: 'refresh', separatorBefore: true,
    onSelect: () => Data.restoreUnit(u.id).then(() => { toast('Aparelho de volta ao estoque'); done?.(); }).catch((err) => toastError('Não foi possível', friendlyError(err))) });
  openMenu(anchor, items);
}

async function removeVariant(v, sheet, onChange) {
  const ok = await confirmDialog({
    title: `Excluir ${variantLabel(v) || 'esta variação'}?`,
    message: 'Só dá para excluir uma variação que nunca teve pedido, entrada nem aparelho.',
    confirmText: 'Excluir', danger: true,
  });
  if (!ok) return;
  try {
    await Data.deleteVariant(v.id);
    toast('Variação excluída');
    sheet?.close();
    onChange?.();
  } catch (err) {
    if (isInUse(err)) {
      const off = await confirmDialog({ title: 'Esta variação tem histórico', message: `${friendlyError(err)}`, confirmText: 'Desativar' });
      if (off) await Data.patchVariants([v.id], { active: false }).then(() => { toast('Variação desativada'); onChange?.(); }).catch((e2) => toastError('Falhou', friendlyError(e2)));
    } else toastError('Não foi possível excluir', friendlyError(err));
  }
}

/* --------------------------------------------------- editar variação -- */

export function openVariantForm(v, { onSaved } = {}) {
  const p = Data.product(v.productId);
  const cat = Data.category(p?.categoryId);
  const d = { ...v };
  const modal = openModal({
    title: 'Editar variação',
    subtitle: Data.variantTitle(v),
    size: 'lg',
    sheet: true,
    body: `
      <div class="form-grid">
        ${p?.sizes.length || v.size ? `<div class="field span-4 span-half-mobile"><label class="label" for="vf-size">${esc(cat?.sizeLabel || 'Tamanho')}</label>
          <input class="input" id="vf-size" name="size" maxlength="30" value="${esc(d.size)}" list="vf-sizes">
          <datalist id="vf-sizes">${(p?.sizes || []).map((x) => `<option value="${esc(x)}">`).join('')}</datalist></div>` : ''}
        <div class="field span-4 span-half-mobile"><label class="label" for="vf-storage">${esc(cat?.variantLabel || 'Capacidade')}</label>
          <input class="input" id="vf-storage" name="storage" maxlength="60" value="${esc(d.storage)}" list="vf-storages">
          <datalist id="vf-storages">${(p?.storages || []).map((x) => `<option value="${esc(x)}">`).join('')}</datalist></div>
        <div class="field span-4 span-half-mobile"><label class="label" for="vf-color">${esc(cat?.colorLabel || 'Cor')}</label>
          <input class="input" id="vf-color" name="color" maxlength="60" value="${esc(d.color)}" list="vf-colors">
          <datalist id="vf-colors">${(p?.colors || []).map((x) => `<option value="${esc(x)}">`).join('')}</datalist></div>
        <div class="field span-4 span-half-mobile"><label class="label" for="vf-cond">Condição</label>
          <select class="select" id="vf-cond" name="condition">
            ${[...new Set([...CONDITIONS, d.condition])].map((c) => `<option ${c === d.condition ? 'selected' : ''}>${esc(c)}</option>`).join('')}
          </select></div>
        <div class="field span-4 span-half-mobile"><label class="label" for="vf-price">Preço de venda</label>
          <div class="money-input"><input class="input" id="vf-price" name="price" ${MONEY_ATTRS} value="${esc(moneyInputValue(d.price))}"></div></div>
        ${p?.tracksSerial ? '' : `<div class="field span-4 span-half-mobile"><label class="label" for="vf-cost">Custo médio</label>
          <div class="money-input"><input class="input" id="vf-cost" name="cost" ${MONEY_ATTRS} value="${esc(moneyInputValue(d.cost))}"></div>
          <div class="hint">Muda sozinho a cada entrada.</div></div>`}
        <div class="field span-4 span-half-mobile"><label class="label" for="vf-min">Estoque mínimo</label>
          <input class="input" id="vf-min" name="minStock" type="number" inputmode="numeric" min="0" max="9999" value="${esc(d.minStock)}"></div>
        <div class="field span-8"><label class="label" for="vf-barcode">Código de barras <span class="dim">(opcional)</span></label>
          <input class="input" id="vf-barcode" name="barcode" maxlength="40" inputmode="numeric" value="${esc(d.barcode)}"></div>
        <div class="field span-5"><span class="label">Foto desta cor <span class="dim">(vale também para as outras variações desta cor sem foto)</span></span><div data-photo></div></div>
        <div class="field span-7 col gap-2" style="justify-content:flex-start">
          <label class="check"><input type="checkbox" name="showInCatalog" ${d.showInCatalog ? 'checked' : ''}><span class="box"></span><span>Aparece no catálogo</span></label>
          <label class="check"><input type="checkbox" name="active" ${d.active ? 'checked' : ''}><span class="box"></span><span>Ativa (desmarcada: some do pedido)</span></label>
        </div>
      </div>
      <fieldset class="enc-box" data-enc-box>
        <label class="check"><input type="checkbox" name="onOrder" ${d.onOrder ? 'checked' : ''}><span class="box"></span>
          <span><strong>Também vendo sob encomenda</strong> <span class="xs dim block">Aparece no catálogo com o selo "Sob encomenda", o prazo e este valor - mesmo sem estoque.</span></span></label>
        <div class="form-grid enc-fields" ${d.onOrder ? '' : 'hidden'}>
          <div class="field span-4 span-half-mobile"><label class="label" for="vf-oprice">Valor na encomenda</label>
            <div class="money-input"><input class="input" id="vf-oprice" name="orderPrice" ${MONEY_ATTRS} value="${esc(moneyInputValue(d.orderPrice))}"></div></div>
          <div class="field span-4 span-half-mobile"><label class="label" for="vf-ocost">Custo do fornecedor</label>
            <div class="money-input"><input class="input money-sensitive" id="vf-ocost" name="orderCost" ${MONEY_ATTRS} value="${esc(moneyInputValue(d.orderCost))}"></div></div>
          <div class="field span-4"><label class="label" for="vf-olead">Prazo</label>
            <input class="input" id="vf-olead" name="orderLead" maxlength="40" value="${esc(d.orderLead)}" placeholder="ex.: 7 a 15 dias"></div>
          <div class="field span-12"><label class="label" for="vf-osup">Fornecedor</label>
            <input class="input" id="vf-osup" name="orderSupplier" maxlength="120" value="${esc(d.orderSupplier)}" list="vf-sups">
            <datalist id="vf-sups">${[...new Set([...Data.suppliers().map((x) => x.name), ...Data.variants().map((x) => x.orderSupplier).filter(Boolean)])].map((x) => `<option value="${esc(x)}">`).join('')}</datalist></div>
        </div>
      </fieldset>
      <div class="alert hide" data-erro data-kind="warn">${icon('alert')}<div data-erro-txt></div></div>`,
    footer: `<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Salvar</button>`,
  });
  const photo = mountPhotoField(modal.body.querySelector('[data-photo]'), { value: d.imageUrl });
  const $ = (n) => modal.body.querySelector(`[name="${n}"]`);
  $('onOrder').addEventListener('change', (e) => {
    modal.body.querySelector('.enc-fields').hidden = !e.target.checked;
    if (e.target.checked && !parseMoney($('orderPrice').value)) $('orderPrice').value = moneyInputValue($('price').value ? parseMoney($('price').value) : 0);
  });

  modal.foot.querySelector('[data-ok]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const next = {
      id: v.id,
      productId: v.productId,
      size: $('size')?.value ?? d.size,
      storage: $('storage').value,
      color: $('color').value,
      condition: $('condition').value,
      price: parseMoney($('price').value),
      minStock: Number($('minStock').value) || 0,
      barcode: $('barcode').value,
      imageUrl: photo.value,
      showInCatalog: $('showInCatalog').checked,
      active: $('active').checked,
      onOrder: $('onOrder').checked,
      orderPrice: parseMoney($('orderPrice').value),
      orderCost: parseMoney($('orderCost').value),
      orderLead: $('orderLead').value.trim(),
      orderSupplier: $('orderSupplier').value.trim(),
    };
    if ($('cost')) next.cost = parseMoney($('cost').value);
    if (next.onOrder && !(next.orderPrice > 0)) {
      modal.body.querySelector('[data-erro-txt]').textContent = 'Informe o valor da encomenda (ou desmarque "Também vendo sob encomenda").';
      modal.body.querySelector('[data-erro]').classList.remove('hide');
      return;
    }
    if (photo.busy) return;
    const dup = Data.findVariant(v.productId, next);
    if (dup && dup.id !== v.id) {
      modal.body.querySelector('[data-erro-txt]').textContent = 'Já existe outra variação com essa mesma combinação.';
      modal.body.querySelector('[data-erro]').classList.remove('hide');
      return;
    }
    await withLoading(btn, async () => {
      try {
        await Data.saveVariant(next);
        // Foto nova: vale para as outras variações desta cor que estão sem foto.
        const spread = next.imageUrl && next.imageUrl !== v.imageUrl
          ? await Data.applyColorPhoto(v.productId, next.color, next.imageUrl).catch(() => 0) : 0;
        photo.discarded(true).forEach((u) => Data.deleteProductImage(u));
        if (photo.replaced()) Data.deleteProductImage(photo.replaced(), { except: v.id });
        photo.dispose();
        modal.close();
        toast('Variação atualizada', spread ? { text: `A foto também foi para ${spread} ${spread === 1 ? 'variação' : 'variações'} na cor ${next.color}.` } : {});
        onSaved?.();
      } catch (err) {
        modal.body.querySelector('[data-erro-txt]').textContent = friendlyError(err);
        modal.body.querySelector('[data-erro]').classList.remove('hide');
      }
    });
  });
  return modal;
}

/* ----------------------------------------------- cadastrar aparelhos -- */

/**
 * Aparelhos que já estão na loja: estoque inicial, troca, compra sem nota.
 * Compra de fornecedor vai pela Entrada (rateia frete e câmbio).
 * Colar uma lista de IMEIs (um por linha) cria uma linha para cada.
 */
export function openAddUnits(v, { onDone } = {}) {
  const rows = [{ serial: '', cost: v.cost || 0, origin: '', batteryHealth: '', notes: '' }];
  const semi = /seminovo|vitrine|cpo/i.test(v.condition);
  const modal = openModal({
    title: 'Cadastrar aparelhos',
    subtitle: Data.variantTitle(v),
    size: 'lg',
    body: `
      <p class="small muted">Para aparelho que já está na loja (estoque inicial, troca, compra sem nota).
        Compra de fornecedor: use a <b>Entrada</b>, que rateia frete e câmbio no custo.</p>
      <div class="noimei-box">
        <div class="field"><label class="label" for="au-qty">Sem IMEI (só a quantidade)</label>
          <input class="input" id="au-qty" type="number" inputmode="numeric" min="0" max="99" value="0" style="max-width:110px"></div>
        <div class="field"><label class="label" for="au-qcost">Custo de cada</label>
          <div class="money-input"><input class="input" id="au-qcost" ${MONEY_ATTRS} value="${esc(moneyInputValue(v.cost || 0))}"></div></div>
        <p class="xs dim" style="align-self:center;margin:0">O IMEI é opcional - dá para anotar depois, ou na venda.</p>
      </div>
      <div class="fieldset-title" style="margin-top:6px">Com IMEI</div>
      <div data-rows></div>
      <div class="row gap-2 wrap">
        <button type="button" class="btn btn-sm" data-add-row>${icon('plus')} Outro aparelho</button>
        <span class="xs dim">Dica: cole vários IMEIs de uma vez (um por linha) no primeiro campo.</span>
      </div>
      <div class="field" style="margin-top:12px"><label class="label" for="au-note">Motivo / observação</label>
        <input class="input" id="au-note" maxlength="200" placeholder="ex.: estoque inicial, troca do cliente Maria"></div>
      <div class="alert hide" data-erro data-kind="warn">${icon('alert')}<div data-erro-txt></div></div>`,
    footer: `<span class="small dim grow" data-total></span><button class="btn btn-ghost" data-close>Cancelar</button>
             <button class="btn btn-primary" data-ok>Cadastrar</button>`,
    beforeClose: async () => {
      if (!rows.some((r) => r.serial.trim())) return true;
      return confirmDialog({ title: 'Descartar os aparelhos?', message: 'Eles ainda não foram cadastrados.', confirmText: 'Descartar', cancelText: 'Continuar', danger: true });
    },
  });
  const $rows = modal.body.querySelector('[data-rows]');

  function render() {
    $rows.innerHTML = rows.map((r, i) => `
      <div class="unit-form-row" data-i="${i}">
        <div class="field grow-2"><label class="label">IMEI / série ${rows.length > 1 ? i + 1 : ''}</label>
          <input class="input mono" data-f="serial" maxlength="40" inputmode="numeric" autocomplete="off" value="${esc(r.serial)}" placeholder="15 dígitos"></div>
        <div class="field"><label class="label">Custo</label>
          <div class="money-input"><input class="input" data-f="cost" ${MONEY_ATTRS} value="${esc(moneyInputValue(r.cost))}"></div></div>
        <div class="field"><label class="label">Origem</label>
          <select class="select" data-f="origin"><option value="">-</option>
            ${ORIGINS.map((o) => `<option ${o === r.origin ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>
        ${semi ? `<div class="field field-sm"><label class="label">Bateria %</label>
          <input class="input" data-f="batteryHealth" type="number" inputmode="numeric" min="0" max="100" value="${esc(r.batteryHealth)}"></div>` : ''}
        ${rows.length > 1 ? `<button type="button" class="icon-btn sm" data-rm-row="${i}" aria-label="Remover">${icon('x')}</button>` : ''}
      </div>`).join('');
    const n = rows.filter((r) => r.serial.trim()).length;
    modal.foot.querySelector('[data-total]').textContent = n ? `${n} ${n === 1 ? 'aparelho' : 'aparelhos'}` : '';
  }

  modal.body.addEventListener('input', (e) => {
    const el = e.target.closest('[data-f]');
    if (!el) return;
    const i = Number(el.closest('[data-i]').dataset.i);
    const f = el.dataset.f;
    if (f === 'serial' && /[\n,;]/.test(el.value)) {
      // Colou uma lista: uma linha por IMEI.
      const list = el.value.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
      rows.splice(i, 1, ...list.map((serial) => ({ ...rows[i], serial })));
      render();
      return;
    }
    rows[i][f] = f === 'cost' ? parseMoney(el.value) : el.value;
    if (f === 'serial') {
      const n = rows.filter((r) => r.serial.trim()).length;
      modal.foot.querySelector('[data-total]').textContent = n ? `${n} ${n === 1 ? 'aparelho' : 'aparelhos'}` : '';
    }
  });
  modal.body.addEventListener('change', (e) => {
    const el = e.target.closest('select[data-f]');
    if (el) rows[Number(el.closest('[data-i]').dataset.i)][el.dataset.f] = el.value;
  });
  modal.body.addEventListener('click', (e) => {
    if (e.target.closest('[data-add-row]')) {
      const last = rows[rows.length - 1];
      rows.push({ serial: '', cost: last.cost, origin: last.origin, batteryHealth: '', notes: '' });
      render();
      modal.body.querySelector(`[data-i="${rows.length - 1}"] [data-f="serial"]`)?.focus();
      return;
    }
    const rm = e.target.closest('[data-rm-row]');
    if (rm) { rows.splice(Number(rm.dataset.rmRow), 1); render(); }
  });

  modal.foot.querySelector('[data-ok]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const list = rows.filter((r) => r.serial.trim());
    const err = (t) => { modal.body.querySelector('[data-erro-txt]').textContent = t; modal.body.querySelector('[data-erro]').classList.remove('hide'); };
    const qty = Math.min(Math.max(Math.trunc(Number(modal.body.querySelector('#au-qty').value)) || 0, 0), 99);
    const qcost = parseMoney(modal.body.querySelector('#au-qcost').value);
    if (!list.length && !qty) { err('Digite o IMEI de um aparelho ou a quantidade sem IMEI.'); return; }
    const seen = new Set();
    for (const r of list) {
      const s = r.serial.trim().toUpperCase();
      if (seen.has(s)) { err(`O IMEI ${r.serial} está repetido na lista.`); return; }
      seen.add(s);
      if (Data.units().some((u) => u.status === 'estoque' && u.serial.trim().toUpperCase() === s)) { err(`O IMEI ${r.serial} já está no estoque.`); return; }
    }
    for (let i = 0; i < qty; i++) list.push({ serial: '', cost: qcost, origin: '', batteryHealth: '', notes: '' });
    if (list.some((r) => !(r.cost > 0))) {
      const go = await confirmDialog({ title: 'Aparelho sem custo', message: 'Algum aparelho está sem custo - o lucro dos pedidos vai sair errado. Cadastrar assim mesmo?', confirmText: 'Cadastrar assim' });
      if (!go) return;
    }
    await withLoading(btn, async () => {
      try {
        const n = await Data.addUnits(v.id, list, modal.body.querySelector('#au-note').value);
        rows.length = 0;
        modal.close();
        toast(`${n} ${n === 1 ? 'aparelho cadastrado' : 'aparelhos cadastrados'}`);
        onDone?.();
      } catch (e2) {
        err(friendlyError(e2));
      }
    });
  });

  render();
  return modal;
}

/* ------------------------------------------------ corrigir aparelho -- */

function openUnitForm(u, { onDone } = {}) {
  const modal = openModal({
    title: 'Dados do aparelho',
    subtitle: Data.variantTitle(Data.variant(u.variantId)),
    sheet: true,
    body: `
      <div class="form-grid">
        <div class="field span-12"><label class="label" for="uf-serial">IMEI / série</label>
          <input class="input mono" id="uf-serial" maxlength="40" value="${esc(u.serial)}"></div>
        <div class="field span-6 span-half-mobile"><label class="label" for="uf-cost">Custo</label>
          <div class="money-input"><input class="input" id="uf-cost" ${MONEY_ATTRS} value="${esc(moneyInputValue(u.cost))}"></div>
          ${u.status === 'vendido' ? '<div class="hint">O pedido já vendido mantém o custo da época.</div>' : ''}</div>
        <div class="field span-6 span-half-mobile"><label class="label" for="uf-bat">Saúde da bateria %</label>
          <input class="input" id="uf-bat" type="number" inputmode="numeric" min="0" max="100" value="${esc(u.batteryHealth ?? '')}"></div>
        <div class="field span-12"><label class="label" for="uf-origin">Origem</label>
          <select class="select" id="uf-origin"><option value="">-</option>
            ${[...new Set([...ORIGINS, u.origin].filter(Boolean))].map((o) => `<option ${o === u.origin ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>
        <div class="field span-12"><label class="label" for="uf-notes">Observação</label>
          <input class="input" id="uf-notes" maxlength="500" value="${esc(u.notes)}" placeholder="ex.: marca de uso na lateral, com caixa"></div>
      </div>
      <div class="alert hide" data-erro data-kind="warn">${icon('alert')}<div data-erro-txt></div></div>`,
    footer: `<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Salvar</button>`,
  });
  const $ = (id) => modal.body.querySelector(id);
  modal.foot.querySelector('[data-ok]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    await withLoading(btn, async () => {
      try {
        await Data.saveUnit({
          id: u.id, serial: $('#uf-serial').value, cost: parseMoney($('#uf-cost').value),
          batteryHealth: $('#uf-bat').value, origin: $('#uf-origin').value, notes: $('#uf-notes').value,
        });
        modal.close();
        toast('Aparelho atualizado');
        onDone?.();
      } catch (err) {
        $('[data-erro-txt]').textContent = friendlyError(err);
        $('[data-erro]').classList.remove('hide');
      }
    });
  });
}

function openDiscardUnit(u, { onDone } = {}) {
  let reason = DISCARD_REASONS[0];
  const modal = openModal({
    title: 'Dar baixa no aparelho',
    subtitle: `${u.serial} · ${Data.variantTitle(Data.variant(u.variantId))}`,
    sheet: true,
    body: `
      <p class="small muted">O aparelho sai do estoque sem venda e fica no histórico como "baixado". Dá para desfazer depois.</p>
      <div class="chips">${DISCARD_REASONS.map((r) => `<button type="button" class="chip sm" data-reason="${esc(r)}" aria-pressed="${r === reason}">${esc(r)}</button>`).join('')}</div>
      <div class="field"><label class="label" for="du-note">Detalhe <span class="dim">(opcional)</span></label>
        <input class="input" id="du-note" maxlength="200" placeholder="ex.: tela não liga"></div>`,
    footer: `<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-danger" data-ok>Dar baixa</button>`,
  });
  modal.body.addEventListener('click', (e) => {
    const r = e.target.closest('[data-reason]');
    if (!r) return;
    reason = r.dataset.reason;
    modal.body.querySelectorAll('[data-reason]').forEach((b) => b.setAttribute('aria-pressed', String(b === r)));
  });
  modal.foot.querySelector('[data-ok]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const note = [reason, modal.body.querySelector('#du-note').value.trim()].filter(Boolean).join(': ');
    await withLoading(btn, async () => {
      try {
        await Data.discardUnit(u.id, note);
        modal.close();
        toast('Baixa lançada');
        onDone?.();
      } catch (err) { toastError('Não foi possível', friendlyError(err)); }
    });
  });
}

/* ------------------------------------------------- ajuste de estoque -- */

export function openAdjustStock(v, { onDone } = {}) {
  let reason = ADJUST_REASONS[0];
  const modal = openModal({
    title: 'Ajustar estoque',
    subtitle: Data.variantTitle(v),
    sheet: true,
    body: `
      <p class="small muted">Digite quanto <b>tem agora</b> na loja. A diferença vira um ajuste no histórico.</p>
      <div class="form-grid">
        <div class="field span-6 span-half-mobile"><span class="label">No sistema</span><div class="kpi-value sm num">${v.stock}</div></div>
        <div class="field span-6 span-half-mobile"><label class="label" for="as-qty">Tem agora</label>
          <input class="input" id="as-qty" type="number" inputmode="numeric" min="0" max="99999" value="${esc(Math.max(v.stock, 0))}" data-autofocus></div>
      </div>
      <div class="chips">${ADJUST_REASONS.map((r) => `<button type="button" class="chip sm" data-reason="${esc(r)}" aria-pressed="${r === reason}">${esc(r)}</button>`).join('')}</div>
      <div class="field"><label class="label" for="as-note">Detalhe <span class="dim">(opcional)</span></label>
        <input class="input" id="as-note" maxlength="200"></div>
      <p class="small" data-delta></p>`,
    footer: `<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Ajustar</button>`,
  });
  const $qty = modal.body.querySelector('#as-qty');
  const delta = () => {
    const d = (Math.trunc(Number($qty.value)) || 0) - v.stock;
    modal.body.querySelector('[data-delta]').innerHTML = d ? `Diferença: <b class="${d > 0 ? 'pos' : 'neg'}">${d > 0 ? '+' : ''}${d}</b>` : '<span class="dim">Sem diferença</span>';
  };
  $qty.addEventListener('input', delta);
  modal.body.addEventListener('click', (e) => {
    const r = e.target.closest('[data-reason]');
    if (!r) return;
    reason = r.dataset.reason;
    modal.body.querySelectorAll('[data-reason]').forEach((b) => b.setAttribute('aria-pressed', String(b === r)));
  });
  modal.foot.querySelector('[data-ok]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const qty = Math.trunc(Number($qty.value));
    if (!(qty >= 0)) { $qty.focus(); return; }
    const note = [reason, modal.body.querySelector('#as-note').value.trim()].filter(Boolean).join(': ');
    await withLoading(btn, async () => {
      try {
        await Data.adjustStock(v.id, qty, note);
        modal.close();
        toast('Estoque ajustado');
        onDone?.();
      } catch (err) { toastError('Não foi possível ajustar', friendlyError(err)); }
    });
  });
  delta();
}

/* ------------------------------------------------------- exportação -- */

function exportProducts() {
  const rows = [];
  for (const p of Data.products()) {
    const cat = Data.category(p.categoryId)?.name || '';
    const vs = Data.variantsOf(p.id);
    if (!vs.length) {
      rows.push({ Codigo: p.code, Modelo: p.name, Categoria: cat, Variacao: '', Condicao: '', Preco: '', Custo: '', Estoque: '', Ativo: p.active ? 'sim' : 'não' });
      continue;
    }
    for (const v of vs) {
      rows.push({
        Codigo: p.code, SKU: v.code, Modelo: p.name, Categoria: cat,
        Variacao: [v.size, v.storage, v.color].filter(Boolean).join(' '), Condicao: v.condition,
        Preco: v.price.toFixed(2).replace('.', ','), Custo: v.cost.toFixed(2).replace('.', ','),
        Estoque: v.stock, Minimo: v.minStock, Catalogo: v.showInCatalog && p.showInCatalog ? 'sim' : 'não',
        Ativo: v.active && p.active ? 'sim' : 'não',
      });
    }
  }
  if (!rows.length) { toast('Nada para exportar.', { kind: 'warn' }); return; }
  downloadFile(`produtos-i7even-${todayISO()}.csv`, toCSV(rows, ['Codigo', 'SKU', 'Modelo', 'Categoria', 'Variacao', 'Condicao', 'Preco', 'Custo', 'Estoque', 'Minimo', 'Catalogo', 'Ativo']), 'text/csv;charset=utf-8');
  toast(`${rows.length} linhas exportadas`);
}

export { round2 };
