/**
 * Ficha de um item do pedido.
 *
 * Abre por cima do seletor ao tocar num modelo (ou ao tocar num item já
 * lançado). Tudo do aparelho num lugar só:
 *   - capacidade, cor, tamanho e condição (as opções do modelo + o que já
 *     tem cadastrado);
 *   - a combinação escolhida mostra o preço e quanto tem em estoque;
 *   - aparelho com IMEI: a lista das unidades na loja para escolher QUAL
 *     sai (IMEI, bateria, origem). Sem escolher, fica como encomenda - o
 *     pedido só pode ir para "Em entrega" depois de escolher;
 *   - combinação que ainda não existe é cadastrada junto com o pedido
 *     (encomenda), já com o preço digitado aqui.
 */

import * as Data from '../core/data.js';
import { CONDITIONS, ORIGINS } from '../core/constants.js';
import { variantLabel, marginPct } from '../core/calc.js';
import { openModal, confirmDialog } from './kit.js';
import { icon } from './icons.js';
import { esc, money, parseMoney, moneyInputValue, isMobile } from '../core/utils.js';
import { moneyHTML } from './common.js';

const MONEY_ATTRS = 'inputmode="numeric" autocomplete="off" placeholder="0,00"';

/** Opções do modelo + valores das variações cadastradas + o valor atual (item antigo). */
function optionsFor(list, variants, field, current) {
  const out = [...(list || [])];
  for (const v of variants) if (v[field] && !out.includes(v[field])) out.push(v[field]);
  if (current && !out.includes(current)) out.push(current);
  return out;
}

/**
 * @param {{item?: object, productId?: string, orderId?: string, takenUnitIds?: Set<string>,
 *          onSave: (item: object) => void}} opts
 *   item:         edita um item existente (devolve uma cópia alterada)
 *   productId:    começa um item novo a partir do modelo
 *   sem nenhum:   item avulso, digitado à mão
 *   orderId:      pedido já gravado (os aparelhos dele aparecem como escolhíveis)
 *   takenUnitIds: aparelhos já escolhidos em OUTROS itens deste pedido
 */
export function openItemEditor({ item = null, productId = null, orderId = null, takenUnitIds = new Set(), onSave }) {
  const editing = !!item;
  const product = Data.product(item?.productId ?? productId);
  const cat = product ? Data.category(product.categoryId) : null;
  const settings = Data.settings();
  const allVariants = product ? Data.variantsOf(product.id) : [];
  const activeVariants = allVariants.filter((v) => v.active);

  const it = item ? structuredClone(item) : Data.newItemDraft({
    productId: product?.id || '',
    categoryId: product?.categoryId || '',
    productName: product?.name || '',
  });
  if (!it.unitIds) it.unitIds = [];

  // Item novo do modelo: começa pela variação com estoque (a mais provável de vender).
  if (!editing && product) {
    const start = activeVariants.find((v) => v.stock > 0) || activeVariants[0];
    if (start) {
      Object.assign(it, { variant: start.storage, color: start.color, size: start.size, condition: start.condition });
    } else {
      Object.assign(it, {
        variant: product.storages.length === 1 ? product.storages[0] : '',
        color: product.colors.length === 1 ? product.colors[0] : '',
        size: product.sizes.length === 1 ? product.sizes[0] : '',
        condition: CONDITIONS[0],
      });
    }
  }

  const initial = JSON.stringify(it);
  const initialVariantKey = [it.size, it.variant, it.color, it.condition].join('|');
  const initialUnits = [...it.unitIds].sort().join(',');
  let priceTouched = editing && it.unitPrice > 0;
  let warrantyTouched = editing;
  let costManual = it.costSource === 'manual';

  const groups = product ? [
    { field: 'size', label: cat?.sizeLabel || 'Tamanho', options: optionsFor(product.sizes, activeVariants, 'size', it.size) },
    { field: 'variant', vfield: 'storage', label: cat?.variantLabel || 'Capacidade', options: optionsFor(product.storages, activeVariants, 'storage', it.variant) },
    { field: 'color', label: cat?.colorLabel || 'Cor', options: optionsFor(product.colors, activeVariants, 'color', it.color) },
    { field: 'condition', label: 'Condição', options: optionsFor(CONDITIONS, activeVariants, 'condition', it.condition) },
  ].filter((g) => g.options.length) : [];
  const bands = cat?.bands?.length ? [...cat.bands, ...(it.band && !cat.bands.includes(it.band) ? [it.band] : [])] : [];
  const extrasFilled = !!(it.note || (it.origin && !product?.tracksSerial) || (!product?.tracksSerial && it.serial));

  const modal = openModal({
    title: product ? product.name : (it.productName || 'Item avulso'),
    subtitle: product ? [cat?.name, product.needsReview ? 'especificações a confirmar' : ''].filter(Boolean).join(' · ') : 'Fora do cadastro',
    size: 'lg',
    sheet: true,
    body: `
      <div class="item-editor">
        ${!product ? `
          <div class="field">
            <label class="label" for="ie-name">Nome do produto *</label>
            <input class="input" id="ie-name" data-f="productName" maxlength="120" autocomplete="off"
                   value="${esc(it.productName)}" placeholder="ex.: Película de privacidade">
          </div>
          <div class="form-grid">
            <div class="field span-6 span-half-mobile"><label class="label" for="ie-variant">Detalhe <span class="dim">(opcional)</span></label>
              <input class="input" id="ie-variant" data-f="variant" maxlength="60" value="${esc(it.variant)}" placeholder="ex.: 128GB"></div>
            <div class="field span-6 span-half-mobile"><label class="label" for="ie-color">Cor <span class="dim">(opcional)</span></label>
              <input class="input" id="ie-color" data-f="color" maxlength="60" value="${esc(it.color)}" placeholder="-"></div>
          </div>` : ''}

        ${groups.map((g) => `
          <div class="config-field" data-group="${g.field}">
            <span class="label">${esc(g.label)}</span>
            <div class="chips">
              ${g.options.map((opt) => `<button type="button" class="chip sm" data-set="${g.field}" data-value="${esc(opt)}"
                aria-pressed="${opt === it[g.field]}">${esc(opt)}</button>`).join('')}
            </div>
          </div>`).join('')}

        ${bands.length ? `
          <div class="config-field" data-optional>
            <span class="label">Pulseira <span class="dim">(opcional)</span></span>
            <div class="chips">${bands.map((b) => `<button type="button" class="chip sm" data-set="band" data-value="${esc(b)}" aria-pressed="${b === it.band}">${esc(b)}</button>`).join('')}</div>
          </div>` : ''}

        ${product ? '<div class="variant-status" data-vstatus></div><div data-units></div>' : ''}

        <div class="form-grid">
          <div class="field span-3 span-half-mobile">
            <label class="label" for="ie-qty">Quantidade</label>
            <div class="stepper">
              <button type="button" class="icon-btn" data-step="-1" aria-label="Diminuir">${icon('minus')}</button>
              <input class="input" id="ie-qty" data-f="qty" type="number" inputmode="numeric" min="1" max="999" step="1" value="${esc(it.qty)}">
              <button type="button" class="icon-btn" data-step="1" aria-label="Aumentar">${icon('plus')}</button>
            </div>
          </div>
          <div class="field span-5 span-half-mobile">
            <label class="label" for="ie-price">Valor de venda</label>
            <div class="money-input"><input class="input" id="ie-price" data-f="unitPrice" ${MONEY_ATTRS} value="${esc(moneyInputValue(it.unitPrice))}"></div>
          </div>
          <div class="field span-4" data-cost-field></div>
        </div>

        <details class="ie-extras" ${extrasFilled || !isMobile() ? 'open' : ''}>
          <summary>${product?.tracksSerial ? 'Garantia e observação' : 'Origem, IMEI, garantia e observação'}
            <span class="summary-chev">${icon('chevronDown')}</span></summary>
          <div class="form-grid">
            ${product?.tracksSerial ? '' : `
              <div class="field span-6"><label class="label" for="ie-origin">Origem</label>
                <select class="select" id="ie-origin" data-f="origin"><option value="">-</option>
                  ${[...new Set([...ORIGINS, it.origin].filter(Boolean))].map((op) => `<option ${op === it.origin ? 'selected' : ''}>${esc(op)}</option>`).join('')}
                </select></div>
              <div class="field span-6"><label class="label" for="ie-serial">IMEI / série <span class="dim">(opcional)</span></label>
                <input class="input" id="ie-serial" data-f="serial" maxlength="40" autocomplete="off" value="${esc(it.serial)}" placeholder="-"></div>`}
            <div class="field span-4"><label class="label" for="ie-warranty">Garantia (dias)</label>
              <input class="input" id="ie-warranty" data-f="warrantyDays" type="number" inputmode="numeric" min="0" max="3650" value="${esc(it.warrantyDays)}"></div>
            <div class="field span-8"><label class="label" for="ie-note">Observação do item</label>
              <input class="input" id="ie-note" data-f="note" maxlength="240" value="${esc(it.note)}" placeholder="ex.: com nota fiscal, película de brinde"></div>
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
        confirmText: 'Descartar', cancelText: 'Continuar editando', danger: true,
      });
    },
  });

  const $ = (sel) => modal.panel.querySelector(sel);
  const $erro = $('[data-erro]');
  const $qty = $('#ie-qty');
  let zeroOk = false;

  const currentVariant = () => (product ? Data.findVariant(product.id, {
    storage: it.variant, color: it.color, size: it.size, condition: it.condition || CONDITIONS[0],
  }) : null);

  /** Aparelhos escolhíveis: os da loja + os que já são deste pedido (edição). */
  function selectableUnits(v) {
    if (!v || !product?.tracksSerial) return [];
    return Data.unitsOf(v.id).filter((u) => (u.status === 'estoque' || (orderId && u.orderId === orderId && u.status === 'vendido'))
      && !takenUnitIds.has(u.id));
  }

  function unitCostPreview(v) {
    if (product?.tracksSerial && it.unitIds.length) {
      const units = it.unitIds.map((id) => Data.unit(id)).filter(Boolean);
      return units.length ? units.reduce((a, u) => a + u.cost, 0) / units.length : 0;
    }
    // Sem estoque e com oferta de encomenda: o custo previsto é o do fornecedor.
    if (v && !(v.cost > 0) && v.stock <= 0 && v.onOrder) return v.orderCost || 0;
    return v?.cost || 0;
  }

  /** Preço sugerido: sem estoque e com oferta de encomenda vale o valor da encomenda. */
  const suggested = (v) => (v.stock <= 0 && v.onOrder && v.orderPrice > 0 ? v.orderPrice : v.price);

  function renderVariant() {
    if (!product) return;
    const v = currentVariant();
    // Trocou de combinação: os aparelhos escolhidos eram da outra.
    if (it.variantId && v?.id !== it.variantId) it.unitIds = [];
    it.variantId = v?.id || null;
    if (v && !priceTouched) {
      it.unitPrice = suggested(v);
      $('#ie-price').value = moneyInputValue(it.unitPrice);
    }
    if (!warrantyTouched) {
      const w = Number(settings.warrantyDays?.[it.condition]);
      if (Number.isFinite(w)) { it.warrantyDays = w; $('#ie-warranty').value = String(w); }
    }

    const $st = $('[data-vstatus]');
    if (!v) {
      $st.innerHTML = `<div class="alert" data-kind="info">${icon('info')}<div><b>Combinação ainda não cadastrada.</b>
        Ela entra no cadastro junto com o pedido, sem estoque (encomenda), com o preço que você digitar.</div></div>`;
    } else {
      const m = marginPct(it.unitPrice, unitCostPreview(v));
      $st.innerHTML = `
        <div class="variant-pill ${v.stock > 0 ? '' : 'is-out'}">
          <span class="grow"><b>${esc(variantLabel(v))}</b>
            <span class="xs dim block">${v.price > 0 ? `tabela ${moneyHTML(v.price)}` : 'sem preço na tabela'}${v.onOrder && v.orderPrice > 0 ? ` · encomenda ${moneyHTML(v.orderPrice)}${v.orderLead ? ` (${esc(v.orderLead)})` : ''}` : ''}${m != null && unitCostPreview(v) > 0 ? ` · margem ${m.toFixed(0)}%` : ''}</span></span>
          <span class="badge" data-tone="${v.stock > 0 ? 'green' : 'amber'}">${v.stock > 0 ? `${v.stock} em estoque` : 'sem estoque · encomenda'}</span>
        </div>
        ${!v.active ? '<p class="xs tone-amber">Variação desativada no cadastro.</p>' : ''}`;
    }
    renderUnits();
    renderCost();
    renderTotal();
  }

  function renderUnits() {
    const box = $('[data-units]');
    if (!box) return;
    const v = currentVariant();
    if (!product.tracksSerial || !v) { box.innerHTML = ''; return; }
    const list = selectableUnits(v);
    it.unitIds = it.unitIds.filter((id) => list.some((u) => u.id === id));
    if (!list.length) {
      box.innerHTML = `<p class="xs dim">${icon('device')} Nenhum aparelho desta combinação na loja. O pedido fica como encomenda:
        escolha o IMEI quando o aparelho chegar (obrigatório antes de "Em entrega").</p>`;
      return;
    }
    box.innerHTML = `
      <div class="config-field">
        <span class="label">Qual aparelho sai? <span class="dim">(${list.length} na loja)</span></span>
        <div class="unit-pick">
          ${list.map((u) => `
            <label class="unit-option${it.unitIds.includes(u.id) ? ' is-on' : ''}">
              <input type="checkbox" data-unit="${esc(u.id)}" ${it.unitIds.includes(u.id) ? 'checked' : ''}>
              <span class="u-main"><span class="mono">${esc(u.serial || 'sem IMEI')}</span>
                <span class="xs dim">${[u.origin, u.batteryHealth != null ? `bateria ${u.batteryHealth}%` : '', u.notes].filter(Boolean).map(esc).join(' · ') || '&nbsp;'}</span></span>
              <span class="num xs money-sensitive dim">${esc(money(u.cost))}</span>
            </label>`).join('')}
        </div>
        <span class="xs dim">${it.unitIds.length ? `${it.unitIds.length} escolhido(s).` : 'Nenhum escolhido: fica como encomenda (dá para escolher depois).'}</span>
      </div>`;
  }

  function renderCost() {
    const box = $('[data-cost-field]');
    if (!product) {
      box.innerHTML = `<label class="label" for="ie-cost">Custo <span class="dim">(opcional - calcula o lucro)</span></label>
        <div class="money-input"><input class="input" id="ie-cost" data-f="unitCost" ${MONEY_ATTRS} value="${esc(moneyInputValue(it.unitCost))}"></div>`;
      return;
    }
    if (costManual) {
      box.innerHTML = `<label class="label" for="ie-cost">Custo <span class="dim">(digitado)</span></label>
        <div class="money-input"><input class="input" id="ie-cost" data-f="unitCost" ${MONEY_ATTRS} value="${esc(moneyInputValue(it.unitCost))}"></div>
        <button type="button" class="link-btn xs" data-cost-auto>usar o custo do estoque</button>`;
      return;
    }
    const keepDb = it.costSource === 'db' && unchanged();
    const cost = keepDb ? it.unitCost : unitCostPreview(currentVariant());
    box.innerHTML = `<span class="label">Custo</span>
      <div class="cost-readonly"><span class="num money-sensitive">${cost > 0 ? esc(money(cost)) : '-'}</span>
        <span class="xs dim">${keepDb ? 'gravado no pedido' : product.tracksSerial && it.unitIds.length ? 'do aparelho' : 'custo médio'}</span></div>
      <button type="button" class="link-btn xs" data-cost-manual>digitar outro</button>`;
  }

  /** Item gravado que não mudou de variação nem de aparelho mantém o custo da época. */
  const unchanged = () => [it.size, it.variant, it.color, it.condition].join('|') === initialVariantKey
    && [...it.unitIds].sort().join(',') === initialUnits;

  function renderTotal() {
    $('[data-total]').textContent = money((Number(it.unitPrice) || 0) * (Number(it.qty) || 1));
  }

  function showError(text, focusSel) {
    $('[data-erro-txt]').textContent = text;
    $erro.classList.remove('hide');
    $erro.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (focusSel) $(focusSel)?.focus();
  }

  function setQty(n) {
    it.qty = Math.min(Math.max(Math.round(Number(n)) || 1, 1, it.unitIds.length), 999);
    $qty.value = String(it.qty);
    renderTotal();
  }

  modal.body.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-set]');
    if (chip) {
      const field = chip.dataset.set;
      const optional = !!chip.closest('[data-optional]');
      const off = optional && it[field] === chip.dataset.value;
      it[field] = off ? '' : chip.dataset.value;
      chip.parentElement.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(!off && c === chip)));
      if (field !== 'band') renderVariant();
      return;
    }
    const step = e.target.closest('[data-step]');
    if (step) { setQty((Number(it.qty) || 1) + Number(step.dataset.step)); return; }
    if (e.target.closest('[data-cost-manual]')) {
      costManual = true;
      it.unitCost = unitCostPreview(currentVariant()) || it.unitCost;
      renderCost();
      $('#ie-cost')?.focus();
      return;
    }
    if (e.target.closest('[data-cost-auto]')) { costManual = false; renderCost(); }
  });

  modal.body.addEventListener('change', (e) => {
    const box = e.target.closest('[data-unit]');
    if (box) {
      const id = box.dataset.unit;
      it.unitIds = box.checked ? [...new Set([...it.unitIds, id])] : it.unitIds.filter((x) => x !== id);
      box.closest('.unit-option')?.classList.toggle('is-on', box.checked);
      if (it.unitIds.length > it.qty) setQty(it.unitIds.length);
      // A origem do item segue a do aparelho escolhido.
      const first = Data.unit(it.unitIds[0]);
      if (first?.origin) it.origin = first.origin;
      renderUnits();
      renderCost();
      return;
    }
    if (e.target.matches('[data-f="origin"]')) it.origin = e.target.value;
    if (e.target === $qty) setQty($qty.value);
  });

  modal.body.addEventListener('input', (e) => {
    const el = e.target.closest('[data-f]');
    if (!el) return;
    const f = el.dataset.f;
    if (f === 'qty') {
      if (el.value !== '') it.qty = Math.min(Math.max(Math.round(Number(el.value)) || 1, 1), 999);
    } else if (f === 'unitPrice') {
      it.unitPrice = parseMoney(el.value);
      priceTouched = true;
      zeroOk = false;
    } else if (f === 'unitCost') {
      it.unitCost = parseMoney(el.value);
    } else if (f === 'warrantyDays') {
      it.warrantyDays = Math.min(Math.max(Number(el.value) || 0, 0), 3650);
      warrantyTouched = true;
    } else {
      it[f] = el.value;
    }
    if (f === 'qty' || f === 'unitPrice') renderTotal();
    if (!$erro.classList.contains('hide')) $erro.classList.add('hide');
  });

  modal.foot.querySelector('[data-ok]').addEventListener('click', () => {
    it.productName = String(it.productName || '').trim() || product?.name || '';
    if (!it.productName) { showError('Dê um nome ao item.', '#ie-name'); return; }
    if (product && groups.some((g) => g.field !== 'condition' && g.options.length > 1 && !it[g.field])) {
      const g = groups.find((x) => x.field !== 'condition' && x.options.length > 1 && !it[x.field]);
      showError(`Escolha: ${g.label.toLowerCase()}.`);
      return;
    }
    if (!(Number(it.unitPrice) > 0) && !zeroOk) {
      zeroOk = true;
      showError('O valor de venda está em branco. Digite o valor ou toque de novo para lançar sem valor.', '#ie-price');
      return;
    }
    if (product) {
      it.productId = product.id;
      it.categoryId = product.categoryId || '';
      it.variantId = currentVariant()?.id || null;
      it.condition = it.condition || CONDITIONS[0];
      if (costManual) it.costSource = 'manual';
      else if (it.costSource === 'db' && unchanged()) it.costSource = 'db';
      else { it.costSource = 'auto'; it.unitCost = unitCostPreview(currentVariant()); }
      if (product.tracksSerial) {
        it.serial = it.unitIds.map((id) => Data.unit(id)?.serial).filter(Boolean).join(', ');
      }
    } else {
      it.costSource = 'manual';
      it.variantId = null;
      it.unitIds = [];
    }
    modal.close();
    onSave(structuredClone(it));
  });

  if (product) renderVariant();
  else { renderCost(); renderTotal(); }
  return modal;
}
