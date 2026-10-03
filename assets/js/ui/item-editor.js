/**
 * Ficha de um item do pedido.
 *
 * Abre por cima do seletor ao tocar num modelo (ou no lápis de um item já
 * lançado): tamanho, capacidade, cor, condição, quantidade e valores ficam
 * todos num lugar só. Antes a configuração aparecia no fim do seletor e, no
 * celular, era preciso rolar a grade inteira para chegar nela.
 *
 * O mesmo diálogo serve para criar e para editar, então editar um item
 * permite trocar cor/capacidade/condição - não só o valor.
 */

import { CONDITIONS, ORIGINS, FREE_CATEGORY, findProduct } from '../data/catalog.js';
import { newItemDraft } from '../core/store.js';
import { openModal, confirmDialog } from './kit.js';
import { icon } from './icons.js';
import { esc, money, parseMoney, moneyInputValue, uid, isMobile } from '../core/utils.js';

const MONEY_ATTRS = 'inputmode="numeric" autocomplete="off" placeholder="0,00"';

/** Opções do catálogo + o valor gravado, se ele não estiver na lista (item antigo). */
function withCurrent(list, current) {
  const base = Array.isArray(list) ? list : [];
  return current && !base.includes(current) ? [...base, current] : base;
}

/** Item novo já com as escolhas mais comuns marcadas: o caso típico é só digitar o valor. */
function draftFromProduct(product) {
  if (!product) {
    return newItemDraft({ categoryId: FREE_CATEGORY.id, productId: `livre-${uid()}`, condition: CONDITIONS[0] });
  }
  return newItemDraft({
    categoryId: product.categoryId,
    productId: product.id,
    // Produto "digite a marca" (ex.: perfume genérico) começa sem nome.
    productName: product.freeName ? '' : product.name,
    variant: product.storages?.[0] || '',
    color: product.colors?.[0] || '',
    size: product.sizes?.[0] || '',
    condition: CONDITIONS[0],
  });
}

/**
 * @param {{item?: object, productId?: string, onSave: (item: object) => void}} opts
 *   item:      edita um item existente (devolve uma cópia alterada)
 *   productId: começa um item novo do catálogo
 *   sem nenhum dos dois: item avulso, digitado à mão
 */
export function openItemEditor({ item = null, productId = null, onSave }) {
  const editing = !!item;
  const product = findProduct(item?.productId ?? productId);
  const it = item ? structuredClone(item) : draftFromProduct(product);
  const cat = product?.category;
  const freeName = !product || !!product.freeName;
  const initial = JSON.stringify(it);

  // Chips: só os grupos que existem para este produto. A pulseira é opcional
  // (toque de novo desmarca); os outros funcionam como "escolha uma".
  const groups = [
    { field: 'size', label: cat?.sizeLabel || 'Tamanho', options: withCurrent(product?.sizes, it.size) },
    { field: 'variant', label: cat?.variantLabel || 'Variação', options: withCurrent(product?.storages, it.variant) },
    { field: 'color', label: cat?.colorLabel || 'Cor', options: withCurrent(product?.colors, it.color) },
    { field: 'band', label: 'Pulseira', options: withCurrent(cat?.bands, it.band), optional: true },
  ].filter((g) => product && g.options.length);

  const extrasFilled = !!(it.origin || it.serial || it.note || (editing && it.warrantyDays !== 90));

  const modal = openModal({
    title: product && !product.freeName ? product.name : (it.productName || (product ? product.name : 'Item avulso')),
    subtitle: [cat?.label || (product ? '' : 'Fora do catálogo'), product?.todo ? 'especificações a confirmar' : '']
      .filter(Boolean).join(' · '),
    size: 'lg',
    sheet: true,
    body: `
      <div class="item-editor">
        ${freeName ? `
          <div class="field">
            <label class="label" for="ie-name">Nome do produto${product ? '' : ' *'}</label>
            <input class="input" id="ie-name" data-f="productName" maxlength="120" autocomplete="off"
                   value="${esc(it.productName)}"
                   placeholder="${product ? `ex.: ${esc(product.name.replace(/\s*\(.*\)$/, ''))} - marca e nome` : 'ex.: Perfume Lattafa Khamrah 100ml'}">
          </div>` : ''}

        ${groups.map((g) => `
          <div class="config-field" data-group="${g.field}" ${g.optional ? 'data-optional' : ''}>
            <span class="label">${esc(g.label)}${g.optional ? ' <span class="dim">(opcional)</span>' : ''}</span>
            <div class="chips">
              ${g.options.map((opt) => `
                <button type="button" class="chip sm" data-set="${g.field}" data-value="${esc(opt)}"
                        aria-pressed="${opt === it[g.field]}">${esc(opt)}</button>`).join('')}
            </div>
          </div>`).join('')}

        ${!product ? `
          <div class="form-grid">
            <div class="field span-6 span-half-mobile">
              <label class="label" for="ie-variant">Detalhe <span class="dim">(opcional)</span></label>
              <input class="input" id="ie-variant" data-f="variant" maxlength="60" value="${esc(it.variant)}" placeholder="ex.: 128GB">
            </div>
            <div class="field span-6 span-half-mobile">
              <label class="label" for="ie-color">Cor <span class="dim">(opcional)</span></label>
              <input class="input" id="ie-color" data-f="color" maxlength="60" value="${esc(it.color)}" placeholder="-">
            </div>
          </div>` : ''}

        <div class="config-field" data-group="condition">
          <span class="label">Condição</span>
          <div class="chips">
            ${withCurrent(CONDITIONS, it.condition).map((opt) => `
              <button type="button" class="chip sm" data-set="condition" data-value="${esc(opt)}"
                      aria-pressed="${opt === it.condition}">${esc(opt)}</button>`).join('')}
          </div>
        </div>

        <div class="form-grid">
          <div class="field span-3 span-half-mobile">
            <label class="label" for="ie-qty">Quantidade</label>
            <div class="stepper">
              <button type="button" class="icon-btn" data-step="-1" aria-label="Diminuir">${icon('minus')}</button>
              <input class="input" id="ie-qty" data-f="qty" type="number" inputmode="numeric"
                     min="1" max="999" step="1" value="${esc(it.qty)}">
              <button type="button" class="icon-btn" data-step="1" aria-label="Aumentar">${icon('plus')}</button>
            </div>
          </div>
          <div class="field span-5 span-half-mobile">
            <label class="label" for="ie-price">Valor de venda</label>
            <div class="money-input"><input class="input" id="ie-price" data-f="unitPrice" ${MONEY_ATTRS}
              value="${esc(moneyInputValue(it.unitPrice))}"></div>
          </div>
          <div class="field span-4">
            <label class="label" for="ie-cost">Custo <span class="dim">(opcional - calcula o lucro)</span></label>
            <div class="money-input"><input class="input" id="ie-cost" data-f="unitCost" ${MONEY_ATTRS}
              value="${esc(moneyInputValue(it.unitCost))}"></div>
          </div>
        </div>

        <details class="ie-extras" ${extrasFilled || !isMobile() ? 'open' : ''}>
          <summary>
            Origem, IMEI, garantia e observação
            <span class="summary-chev">${icon('chevronDown')}</span>
          </summary>
          <div class="form-grid">
            <div class="field span-6">
              <label class="label" for="ie-origin">Origem</label>
              <select class="select" id="ie-origin" data-f="origin">
                <option value="">-</option>
                ${withCurrent(ORIGINS, it.origin).map((op) => `<option ${op === it.origin ? 'selected' : ''}>${esc(op)}</option>`).join('')}
              </select>
            </div>
            <div class="field span-6">
              <label class="label" for="ie-serial">IMEI / série</label>
              <input class="input" id="ie-serial" data-f="serial" maxlength="40" autocomplete="off"
                     value="${esc(it.serial)}" placeholder="-">
            </div>
            <div class="field span-4">
              <label class="label" for="ie-warranty">Garantia (dias)</label>
              <input class="input" id="ie-warranty" data-f="warrantyDays" type="number" inputmode="numeric"
                     min="0" max="3650" value="${esc(it.warrantyDays)}">
            </div>
            <div class="field span-8">
              <label class="label" for="ie-note">Observação do item</label>
              <input class="input" id="ie-note" data-f="note" maxlength="240" value="${esc(it.note)}"
                     placeholder="ex.: bateria 92%, com nota">
            </div>
          </div>
        </details>

        <div class="alert hide" data-erro data-kind="warn">${icon('alert')}<div data-erro-txt></div></div>
      </div>`,
    footer: `
      <div class="ie-total grow">
        <span class="xs dim">Total do item</span>
        <span class="strong mono money-sensitive" data-total></span>
      </div>
      <button class="btn btn-ghost" data-close>Cancelar</button>
      <button class="btn btn-primary" data-ok>${editing ? 'Salvar item' : 'Adicionar'}</button>`,
    beforeClose: async () => {
      if (JSON.stringify(it) === initial) return true;
      return confirmDialog({
        title: editing ? 'Descartar as alterações?' : 'Descartar este item?',
        message: editing ? 'O item continua como estava.' : 'Ele ainda não foi adicionado ao pedido.',
        confirmText: 'Descartar',
        cancelText: 'Continuar editando',
        danger: true,
      });
    },
  });

  const $ = (sel) => modal.panel.querySelector(sel);
  const $total = $('[data-total]');
  const $erro = $('[data-erro]');
  const $erroTxt = $('[data-erro-txt]');
  const $qty = $('#ie-qty');
  let zeroOk = false;   // já avisou do valor zerado uma vez?

  function renderTotal() {
    $total.textContent = money((Number(it.unitPrice) || 0) * (Number(it.qty) || 1));
  }

  function showError(text, focusSel) {
    $erroTxt.textContent = text;
    $erro.classList.remove('hide');
    $erro.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (focusSel) $(focusSel)?.focus();
  }

  function setQty(n) {
    it.qty = Math.min(Math.max(Math.round(Number(n)) || 1, 1), 999);
    $qty.value = String(it.qty);
    renderTotal();
  }

  modal.body.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-set]');
    if (chip) {
      const field = chip.dataset.set;
      const optional = chip.closest('[data-optional]');
      const turnOff = optional && it[field] === chip.dataset.value;
      it[field] = turnOff ? '' : chip.dataset.value;
      // Repinta só o grupo: o resto do formulário (e o foco) fica intacto.
      chip.parentElement.querySelectorAll('.chip').forEach((c) => {
        c.setAttribute('aria-pressed', String(!turnOff && c === chip));
      });
      return;
    }
    const step = e.target.closest('[data-step]');
    if (step) setQty((Number(it.qty) || 1) + Number(step.dataset.step));
  });

  modal.body.addEventListener('input', (e) => {
    const el = e.target.closest('[data-f]');
    if (!el) return;
    const f = el.dataset.f;
    if (f === 'qty') {
      // Campo vazio enquanto digita não vira "1" na cara da pessoa.
      if (el.value !== '') it.qty = Math.min(Math.max(Math.round(Number(el.value)) || 1, 1), 999);
    } else if (f === 'unitPrice' || f === 'unitCost') {
      it[f] = parseMoney(el.value);
      if (f === 'unitPrice') zeroOk = false;
    } else if (f === 'warrantyDays') {
      it.warrantyDays = Math.min(Math.max(Number(el.value) || 0, 0), 3650);
    } else {
      it[f] = el.value;
    }
    if (f === 'qty' || f === 'unitPrice') renderTotal();
    if (!$erro.classList.contains('hide')) $erro.classList.add('hide');
  });

  modal.body.addEventListener('change', (e) => {
    if (e.target.matches('[data-f="origin"]')) it.origin = e.target.value;
    if (e.target === $qty) setQty($qty.value);
  });

  modal.foot.querySelector('[data-ok]').addEventListener('click', () => {
    it.productName = String(it.productName || '').trim();
    if (!it.productName) {
      if (product) it.productName = product.name;
      else { showError('Dê um nome ao item.', '#ie-name'); return; }
    }
    if (!(Number(it.unitPrice) > 0) && !zeroOk) {
      zeroOk = true;
      showError('O valor de venda está em branco. Digite o valor ou toque de novo para lançar sem valor.', '#ie-price');
      return;
    }
    modal.close();
    onSave(structuredClone(it));
  });

  renderTotal();
  return modal;
}
