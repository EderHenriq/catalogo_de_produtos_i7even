/**
 * Seletor de produtos - a tela que torna o cadastro rápido.
 *
 * Fluxo: escolhe a categoria → marca um ou vários modelos (checkbox) →
 * cada marcado abre uma linha de configuração (capacidade, cor, condição,
 * quantidade, valor) → adiciona tudo de uma vez ao pedido.
 */

import { CATALOG, CONDITIONS, ORIGINS, searchProducts, findProduct } from '../data/catalog.js';
import { newItemDraft } from '../core/store.js';
import { openModal, toast } from './kit.js';
import { icon } from './icons.js';
import { esc, parseMoney, moneyInputValue, debounce, uid } from '../core/utils.js';

/**
 * @param {{onAdd: (items: object[]) => void, defaultCategory?: string}} opts
 */
export function openProductPicker({ onAdd, defaultCategory = 'iphone' }) {
  /** @type {Map<string, object>} produtoId → item em configuração */
  const selected = new Map();
  let activeCat = defaultCategory;
  let term = '';

  const modal = openModal({
    title: 'Adicionar itens',
    subtitle: 'Marque os modelos e ajuste capacidade, cor e valor',
    size: 'xl',
    body: `
      <div class="picker">
        <div class="picker-cats chips" data-cats></div>
        <div class="field">
          <div class="search" style="max-width:none">
            ${icon('search')}
            <input class="input" type="search" placeholder="Buscar modelo… (ex.: 15 pro max)"
                   data-search autocomplete="off" data-autofocus>
          </div>
        </div>
        <div class="picker-grid grid grid-3" data-grid></div>
      </div>
      <div class="picker-tray" data-tray hidden></div>`,
    footer: `
      <span class="small dim grow" data-count>Nenhum item marcado</span>
      <button class="btn" data-close>Cancelar</button>
      <button class="btn btn-primary" data-add disabled>Adicionar</button>`,
  });

  const $cats = modal.panel.querySelector('[data-cats]');
  const $grid = modal.panel.querySelector('[data-grid]');
  const $tray = modal.panel.querySelector('[data-tray]');
  const $search = modal.panel.querySelector('[data-search]');
  const $count = modal.panel.querySelector('[data-count]');
  const $add = modal.panel.querySelector('[data-add]');

  /* --------------------------------------------------------- categorias */

  function renderCats() {
    const all = [...CATALOG, { id: 'outro', label: 'Item avulso', emoji: '✏️' }];
    $cats.innerHTML = all
      .map((c) => `
        <button type="button" class="chip" data-cat="${esc(c.id)}"
                aria-pressed="${c.id === activeCat}">
          <span aria-hidden="true">${c.emoji}</span>${esc(c.label)}
        </button>`)
      .join('');
  }

  $cats.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cat]');
    if (!btn) return;
    if (btn.dataset.cat === 'outro') { addFreeItem(); return; }
    activeCat = btn.dataset.cat;
    term = '';
    $search.value = '';
    renderCats();
    renderGrid();
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
      $grid.innerHTML = `<p class="small dim" style="grid-column:1/-1">Nenhum modelo encontrado. Use “Item avulso” para cadastrar algo fora do catálogo.</p>`;
      return;
    }

    $grid.innerHTML = list
      .map((p) => {
        const on = selected.has(p.id);
        const meta = [p.storages?.[0], p.storages?.length > 1 ? `+${p.storages.length - 1}` : '']
          .filter(Boolean).join(' ');
        return `
          <button type="button" class="pick" data-product="${esc(p.id)}" aria-pressed="${on}">
            <span class="pick-check" aria-hidden="true">${icon('check')}</span>
            <span class="pick-name">${esc(p.name)}${p.todo ? ' <span class="dim">·  a confirmar</span>' : ''}</span>
            <span class="pick-meta">${esc(p.category.label)} · ${esc(meta || '-')}</span>
          </button>`;
      })
      .join('');
  }

  $grid.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-product]');
    if (!btn) return;
    const id = btn.dataset.product;
    if (selected.has(id)) selected.delete(id);
    else selected.set(id, buildItem(id));
    // Só o botão tocado muda: redesenhar a grade inteira travava no celular.
    btn.setAttribute('aria-pressed', String(selected.has(id)));
    renderTray();
  });

  $search.addEventListener('input', debounce((e) => {
    term = e.target.value;
    renderGrid();
  }, 160));

  /* -------------------------------------------------- item a partir do */
  /* ------------------------------------------------------------ catálogo */

  function buildItem(productId) {
    const p = findProduct(productId);
    if (!p) return newItemDraft();
    return newItemDraft({
      categoryId: p.categoryId,
      productId: p.id,
      productName: p.name,
      variant: p.storages?.[0] || '',
      color: p.colors?.[0] || '',
      size: p.sizes?.[0] || '',
      condition: CONDITIONS[0],
      _options: { storages: p.storages || [], colors: p.colors || [], sizes: p.sizes || [] },
      _labels: {
        variant: p.category.variantLabel || 'Variação',
        color: p.category.colorLabel || 'Cor',
        size: p.category.sizeLabel || 'Tamanho',
      },
      _freeName: !!p.freeName,
    });
  }

  function addFreeItem() {
    const id = `livre-${uid()}`;
    selected.set(id, newItemDraft({
      categoryId: 'outro',
      productId: id,
      productName: '',
      condition: CONDITIONS[0],
      _options: { storages: [], colors: [], sizes: [] },
      _labels: { variant: 'Detalhe', color: 'Cor', size: 'Tamanho' },
      _freeName: true,
      _free: true,
    }));
    renderTray();
    requestAnimationFrame(() => {
      $tray.querySelector(`[data-key="${CSS.escape(id)}"] input[data-f="productName"]`)?.focus();
    });
  }

  /* -------------------------------------------------------- configuração */

  function renderTray() {
    const entries = [...selected.entries()];
    $tray.hidden = entries.length === 0;
    $count.textContent = entries.length
      ? `${entries.length} ${entries.length === 1 ? 'item marcado' : 'itens marcados'}`
      : 'Nenhum item marcado';
    $add.disabled = entries.length === 0;
    $add.textContent = entries.length ? `Adicionar ${entries.length}` : 'Adicionar';

    if (!entries.length) { $tray.innerHTML = ''; return; }

    $tray.innerHTML = `
      <div class="fieldset-title">Configurar itens</div>
      ${entries.map(([key, it]) => configRow(key, it)).join('')}`;
  }

  function chipGroup(key, field, options, current) {
    if (!options?.length) return '';
    return `
      <div class="chips">
        ${options.map((opt) => `
          <button type="button" class="chip sm" data-key="${esc(key)}" data-set="${esc(field)}"
                  data-value="${esc(opt)}" aria-pressed="${opt === current}">${esc(opt)}</button>`).join('')}
      </div>`;
  }

  function configRow(key, it) {
    const o = it._options || {};
    const l = it._labels || {};
    return `
      <div class="config-row" data-key="${esc(key)}">
        <div class="row-between">
          <div class="grow">
            ${it._freeName
              ? `<input class="input" data-f="productName" value="${esc(it.productName)}"
                        placeholder="Nome do produto (ex.: Perfume Lattafa Khamrah 100ml)" maxlength="120">`
              : `<div class="item-title">${esc(it.productName)}</div>`}
          </div>
          <button type="button" class="icon-btn sm" data-remove="${esc(key)}" aria-label="Remover">${icon('x')}</button>
        </div>

        ${o.sizes?.length ? `<div class="config-field"><span class="label">${esc(l.size)}</span>${chipGroup(key, 'size', o.sizes, it.size)}</div>` : ''}
        ${o.storages?.length ? `<div class="config-field"><span class="label">${esc(l.variant)}</span>${chipGroup(key, 'variant', o.storages, it.variant)}</div>` : ''}
        ${o.colors?.length ? `<div class="config-field"><span class="label">${esc(l.color)}</span>${chipGroup(key, 'color', o.colors, it.color)}</div>` : ''}

        <div class="config-field">
          <span class="label">Condição</span>
          ${chipGroup(key, 'condition', CONDITIONS, it.condition)}
        </div>

        <div class="form-grid">
          <div class="field span-3 span-half-mobile">
            <label class="label" for="qty-${esc(key)}">Qtd.</label>
            <input class="input" id="qty-${esc(key)}" type="number" min="1" max="999" step="1"
                   data-f="qty" value="${esc(it.qty)}">
          </div>
          <div class="field span-4 span-half-mobile">
            <label class="label" for="price-${esc(key)}">Valor de venda</label>
            <div class="money-input">
              <input class="input" id="price-${esc(key)}" inputmode="numeric" autocomplete="off" data-f="unitPrice"
                     value="${esc(moneyInputValue(it.unitPrice))}" placeholder="0,00">
            </div>
          </div>
          <div class="field span-5">
            <label class="label" for="cost-${esc(key)}">Custo <span class="dim">(opcional - calcula o lucro)</span></label>
            <div class="money-input">
              <input class="input" id="cost-${esc(key)}" inputmode="numeric" autocomplete="off" data-f="unitCost"
                     value="${esc(moneyInputValue(it.unitCost))}" placeholder="0,00">
            </div>
          </div>
          <div class="field span-6">
            <label class="label" for="origin-${esc(key)}">Origem</label>
            <select class="select" id="origin-${esc(key)}" data-f="origin">
              <option value="">-</option>
              ${ORIGINS.map((op) => `<option ${op === it.origin ? 'selected' : ''}>${esc(op)}</option>`).join('')}
            </select>
          </div>
          <div class="field span-6">
            <label class="label" for="serial-${esc(key)}">IMEI / série <span class="dim">(opcional)</span></label>
            <input class="input" id="serial-${esc(key)}" data-f="serial" value="${esc(it.serial)}"
                   maxlength="40" placeholder="-">
          </div>
        </div>
      </div>`;
  }

  /* ------------------------------------------------ eventos da bandeja  */

  $tray.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-set]');
    if (chip) {
      const it = selected.get(chip.dataset.key);
      if (!it) return;
      it[chip.dataset.set] = chip.dataset.value;
      // Repinta só o grupo, para não perder o foco dos campos numéricos.
      chip.parentElement.querySelectorAll('.chip').forEach((c) => {
        c.setAttribute('aria-pressed', String(c === chip));
      });
      return;
    }
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      selected.delete(rm.dataset.remove);
      renderGrid();
      renderTray();
    }
  });

  $tray.addEventListener('input', (e) => {
    const input = e.target.closest('[data-f]');
    if (!input) return;
    const key = input.closest('[data-key]')?.dataset.key;
    const it = selected.get(key);
    if (!it) return;
    const field = input.dataset.f;
    if (field === 'qty') it.qty = Math.min(Math.max(Number(input.value) || 1, 1), 999);
    else if (field === 'unitPrice' || field === 'unitCost') it[field] = parseMoney(input.value);
    else it[field] = input.value;
  });

  /* ----------------------------------------------------------- concluir */

  $add.addEventListener('click', () => {
    const items = [...selected.values()];
    const semNome = items.find((it) => !String(it.productName).trim());
    if (semNome) {
      toast('Dê um nome ao item avulso antes de adicionar.', { kind: 'warn' });
      return;
    }
    // Remove os campos auxiliares de UI antes de devolver.
    const clean = items.map(({ _options, _labels, _freeName, _free, ...rest }) => rest);
    onAdd(clean);
    modal.close();
  });

  renderCats();
  renderGrid();
  renderTray();

  return modal;
}
