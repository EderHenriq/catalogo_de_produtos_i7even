/**
 * Seletor de produtos - a tela que torna o cadastro rápido.
 *
 * Fluxo: escolhe a categoria → toca no modelo → abre a ficha do aparelho
 * (capacidade, cor, condição, quantidade, valor) → "Adicionar" lança o item
 * no pedido na hora e volta para a grade, pronta para o próximo.
 *
 * O mesmo modelo pode entrar quantas vezes precisar (ex.: dois iPhone 15 de
 * cores diferentes): cada toque abre uma ficha nova. O número no cartão
 * mostra quantos daquele modelo já estão no pedido.
 */

import { CATALOG, FREE_CATEGORY, searchProducts } from '../data/catalog.js';
import { openModal } from './kit.js';
import { openItemEditor } from './item-editor.js';
import { icon } from './icons.js';
import { esc, money, debounce } from '../core/utils.js';

/**
 * @param {{onAdd: (items: object[]) => void, items?: () => object[], defaultCategory?: string}} opts
 *   items: itens que já estão no pedido (para o contador dos cartões e o resumo).
 */
export function openProductPicker({ onAdd, items = () => [], defaultCategory = 'iphone' }) {
  let activeCat = CATALOG.some((c) => c.id === defaultCategory) ? defaultCategory : 'iphone';
  let term = '';
  let addedNow = 0;

  const modal = openModal({
    title: 'Adicionar itens',
    subtitle: 'Toque no modelo para escolher capacidade, cor e valor',
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
  const $done = modal.panel.querySelector('[data-done]');

  /** Quantas unidades de cada modelo já estão no pedido. */
  function countsByProduct() {
    const map = new Map();
    for (const it of items()) map.set(it.productId, (map.get(it.productId) || 0) + (Number(it.qty) || 1));
    return map;
  }

  /* --------------------------------------------------------- categorias */

  function renderCats() {
    const all = [...CATALOG, FREE_CATEGORY];
    $cats.innerHTML = all
      .map((c) => `
        <button type="button" class="chip" data-cat="${esc(c.id)}"
                aria-pressed="${!term && c.id === activeCat}">
          <span aria-hidden="true">${c.emoji}</span>${esc(c.label)}
        </button>`)
      .join('');
  }

  $cats.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    if (btn.dataset.cat === FREE_CATEGORY.id) { configure(null); return; }
    activeCat = btn.dataset.cat;
    term = '';
    $search.value = '';
    renderCats();
    renderGrid();
    $grid.scrollTop = 0;
  });

  /* ------------------------------------------------------------- grade */

  function renderGrid() {
    // Lançados primeiro (os "a confirmar" vão para o fim) e, dentro disso,
    // do mais novo para o mais antigo - é a ordem em que a loja mais vende.
    const list = searchProducts(term, term ? null : activeCat)
      .sort((a, b) => Number(!!a.todo) - Number(!!b.todo)
        || b.year - a.year
        || a.name.localeCompare(b.name, 'pt-BR'));

    if (!list.length) {
      $grid.innerHTML = `
        <div class="picker-empty">
          <p class="small dim">Nenhum modelo encontrado.</p>
          <button type="button" class="btn btn-outline btn-sm" data-free>${icon('edit')} Lançar como item avulso</button>
        </div>`;
      return;
    }

    const counts = countsByProduct();
    $grid.innerHTML = list
      .map((p) => {
        const n = counts.get(p.id) || 0;
        const meta = [p.storages?.[0], p.storages?.length > 1 ? `+${p.storages.length - 1}` : '']
          .filter(Boolean).join(' ');
        return `
          <button type="button" class="pick" data-product="${esc(p.id)}" aria-pressed="${n > 0}">
            ${n ? `<span class="pick-count" aria-label="${n} no pedido">${n}</span>` : ''}
            <span class="pick-name">${esc(p.name)}${p.todo ? ' <span class="dim">· a confirmar</span>' : ''}</span>
            <span class="pick-meta">${esc(term ? p.category.label : '')}${term ? ' · ' : ''}${esc(meta || '-')}</span>
          </button>`;
      })
      .join('');
  }

  $grid.addEventListener('click', (e) => {
    if (e.target.closest('[data-free]')) { configure(null); return; }
    const btn = e.target.closest('[data-product]');
    if (btn) configure(btn.dataset.product);
  });

  $search.addEventListener('input', debounce((e) => {
    term = e.target.value;
    renderCats();
    renderGrid();
  }, 160));

  /* ----------------------------------------------------- ficha do item */

  function configure(productId) {
    openItemEditor({
      productId,
      onSave: (item) => {
        addedNow += 1;
        onAdd([item]);
        renderGrid();
        renderFooter();
        // Retorno discreto no próprio cartão: um aviso por cima cobriria as
        // categorias justo quando a pessoa vai tocar no próximo modelo.
        $grid.querySelector(`[data-product="${CSS.escape(item.productId)}"] .pick-count`)?.classList.add('bump');
      },
    });
  }

  /* ------------------------------------------------------------ rodapé */

  function renderFooter() {
    const list = items();
    const units = list.reduce((a, it) => a + (Number(it.qty) || 1), 0);
    const total = list.reduce((a, it) => a + (Number(it.unitPrice) || 0) * (Number(it.qty) || 1), 0);
    $count.innerHTML = list.length
      ? `${units} ${units === 1 ? 'item' : 'itens'} no pedido · <span class="mono money-sensitive">${esc(money(total))}</span>`
      : 'Nenhum item no pedido ainda';
    $done.textContent = addedNow ? 'Concluir' : 'Fechar';
  }

  renderCats();
  renderGrid();
  renderFooter();

  return modal;
}
