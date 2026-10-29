/**
 * Seletor de modelos - a grade que torna o cadastro rápido.
 *
 * Categoria → toque no modelo → abre por cima a ficha que o fluxo precisa
 * (no pedido: capacidade, cor, condição, aparelho e valor; na entrada: os
 * IMEIs e o custo). A grade continua aberta para o próximo, e o número no
 * cartão mostra quantos daquele modelo já estão no pedido/na nota.
 *
 * Os modelos vêm do cadastro (Produtos). Modelos com estoque aparecem
 * primeiro; os desativados não aparecem.
 */

import * as Data from '../core/data.js';
import { openModal } from './kit.js';
import { icon } from './icons.js';
import { esc, money, debounce } from '../core/utils.js';
import { matches, productThumb, priceRangeHTML } from './common.js';

const FREE = { id: 'outro', name: 'Item avulso', emoji: '✏️' };

/**
 * @param {{
 *   title?: string, subtitle?: string, defaultCategory?: string,
 *   allowFree?: boolean,                     // mostra "Item avulso" (pedido)
 *   counts?: () => Map<string, number>,      // productId → quantas unidades já estão na lista
 *   footer?: () => string,                   // resumo no rodapé (HTML)
 *   onPick: (product: object|null, picker: object) => void,   // null = item avulso
 * }} opts
 */
export function openProductPicker({
  title = 'Adicionar itens', subtitle = 'Toque no modelo para escolher capacidade, cor e valor',
  defaultCategory = '', allowFree = true, counts = () => new Map(), footer = () => '', onPick,
}) {
  const cats = Data.categories().filter((c) => c.active && Data.products().some((p) => p.active && p.categoryId === c.id));
  let activeCat = cats.some((c) => c.id === defaultCategory) ? defaultCategory : (cats[0]?.id || '');
  let term = '';

  const modal = openModal({
    title,
    subtitle,
    size: 'xl',
    body: `
      <div class="picker">
        <div class="picker-head">
          <div class="picker-cats chips" data-cats></div>
          <div class="search">
            ${icon('search')}
            <input class="input" type="search" placeholder="Buscar modelo… (ex.: 15 pro max)"
                   data-search autocomplete="off" enterkeyhint="search" data-autofocus>
          </div>
        </div>
        <div class="picker-grid grid grid-3" data-grid></div>
      </div>`,
    footer: `
      <span class="small dim grow" data-count></span>
      <button class="btn btn-primary" data-close data-done>Concluir</button>`,
  });

  const $cats = modal.panel.querySelector('[data-cats]');
  const $grid = modal.panel.querySelector('[data-grid]');
  const $search = modal.panel.querySelector('[data-search]');
  const $count = modal.panel.querySelector('[data-count]');

  function renderCats() {
    $cats.innerHTML = [
      ...cats.map((c) => `
        <button type="button" class="chip" data-cat="${esc(c.id)}" aria-pressed="${!term && c.id === activeCat}">
          <span aria-hidden="true">${esc(c.emoji || '')}</span>${esc(c.name)}
        </button>`),
      allowFree ? `<button type="button" class="chip" data-free><span aria-hidden="true">${FREE.emoji}</span>${FREE.name}</button>` : '',
    ].join('');
  }

  function list() {
    const rank = Data.salesRank(90);
    return Data.products()
      .filter((p) => p.active && (term ? matches(term, p.name, p.brand, Data.category(p.categoryId)?.name) : (!activeCat || p.categoryId === activeCat)))
      .sort((a, b) => (Data.productStock(b.id) > 0) - (Data.productStock(a.id) > 0)
        || (rank.get(b.id) || 0) - (rank.get(a.id) || 0)
        || Number(!!a.needsReview) - Number(!!b.needsReview)
        || (b.year || 0) - (a.year || 0)
        || a.name.localeCompare(b.name, 'pt-BR'));
  }

  function renderGrid() {
    const items = list();
    if (!items.length) {
      $grid.innerHTML = `
        <div class="picker-empty">
          <p class="small dim">${Data.products().length ? 'Nenhum modelo encontrado.' : 'Nenhum modelo cadastrado ainda (Produtos → Modelo).'}</p>
          ${allowFree ? `<button type="button" class="btn btn-outline btn-sm" data-free>${icon('edit')} Lançar como item avulso</button>` : ''}
        </div>`;
      return;
    }
    const n = counts();
    $grid.innerHTML = items.map((p) => {
      const qty = n.get(p.id) || 0;
      const stock = Data.productStock(p.id);
      const hasVariants = Data.variantsOf(p.id).some((v) => v.active);
      return `
        <button type="button" class="pick pick-product" data-product="${esc(p.id)}" aria-pressed="${qty > 0}">
          ${qty ? `<span class="pick-count" aria-label="${qty} na lista">${qty}</span>` : ''}
          ${productThumb(p, 'sm')}
          <span class="pick-body">
            <span class="pick-name">${esc(p.name)}${p.needsReview ? ' <span class="dim">· a confirmar</span>' : ''}</span>
            <span class="pick-meta">
              ${term ? `${esc(Data.category(p.categoryId)?.name || '')} · ` : ''}
              ${stock > 0 ? `<span class="pos">${stock} em estoque</span>` : '<span class="dim">sem estoque</span>'}
              ${hasVariants ? ` · ${priceRangeHTML(p.id)}` : ''}
            </span>
          </span>
        </button>`;
    }).join('');
  }

  function renderFooter() {
    $count.innerHTML = footer() || '';
  }

  const api = {
    modal,
    refresh() {
      renderGrid();
      renderFooter();
    },
    /** Retorno discreto no cartão do modelo que acabou de entrar. */
    bump(productId) {
      $grid.querySelector(`[data-product="${CSS.escape(productId)}"] .pick-count`)?.classList.add('bump');
    },
    close: () => modal.close(),
  };

  $cats.addEventListener('click', (e) => {
    if (e.target.closest('[data-free]')) { onPick(null, api); return; }
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    activeCat = btn.dataset.cat;
    term = '';
    $search.value = '';
    renderCats();
    renderGrid();
    $grid.scrollTop = 0;
  });

  $grid.addEventListener('click', (e) => {
    if (e.target.closest('[data-free]')) { onPick(null, api); return; }
    const btn = e.target.closest('[data-product]');
    if (btn) onPick(Data.product(btn.dataset.product), api);
  });

  $search.addEventListener('input', debounce((e) => {
    term = e.target.value;
    renderCats();
    renderGrid();
  }, 160));

  renderCats();
  api.refresh();
  return api;
}

/** Resumo padrão do rodapé: "3 itens · R$ 9.700,00". */
export function itemsFooter(items) {
  const units = items.reduce((a, it) => a + (Number(it.qty) || 1), 0);
  const total = items.reduce((a, it) => a + (Number(it.unitPrice) || 0) * (Number(it.qty) || 1), 0);
  return items.length
    ? `${units} ${units === 1 ? 'item' : 'itens'} · <span class="mono money-sensitive">${esc(money(total))}</span>`
    : 'Nenhum item ainda';
}

/** Quantas unidades de cada modelo já estão na lista. */
export function countsByProduct(items) {
  const map = new Map();
  for (const it of items) if (it.productId) map.set(it.productId, (map.get(it.productId) || 0) + (Number(it.qty) || 1));
  return map;
}
