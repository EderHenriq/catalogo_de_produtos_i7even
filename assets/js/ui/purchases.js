/**
 * Entradas de mercadoria: compra do fornecedor ou importação.
 *
 * A nota é lançada como ela é: cada linha um produto (variação), o custo na
 * moeda da nota (R$ ou US$ × câmbio), e o frete/taxas rateados no custo real
 * de cada unidade (proporcional ao valor). Aparelho com IMEI entra unidade
 * por unidade - cada um com o seu IMEI, e se quiser, custo e bateria próprios.
 * A prévia na tela usa as mesmas contas do banco (core/calc.js ↔ post_purchase).
 */

import * as Data from '../core/data.js';
import { apportionCosts, suggestPrice, variantLabel, round2 } from '../core/calc.js';
import { CONDITIONS, ORIGINS } from '../core/constants.js';
import { friendlyError } from '../core/errors.js';
import { esc, money, parseMoney, moneyInputValue, formatDate, todayISO } from '../core/utils.js';
import { openModal, confirmDialog, toast, toastError, withLoading, emptyState } from './kit.js';
import { icon } from './icons.js';
import { productThumb, moneyHTML, matches } from './common.js';
import { openProductPicker } from './product-picker.js';

const MONEY_ATTRS = 'inputmode="numeric" autocomplete="off" placeholder="0,00"';

/* =================================================================== */
/*  Lista                                                               */
/* =================================================================== */

export function mount(host) {
  let q = '';
  host.innerHTML = `
    <div class="view">
      <div class="section-head">
        <div><h2>Entradas</h2><p class="small dim" data-count></p></div>
        <button class="btn btn-primary" data-new-purchase>${icon('plus')} Nova entrada</button>
      </div>
      <div class="grid grid-kpi" data-kpis></div>
      <div data-list></div>
    </div>`;

  function render() {
    const month = todayISO().slice(0, 7);
    const all = Data.purchases();
    const live = all.filter((p) => p.status === 'lancada');
    const inMonth = live.filter((p) => String(p.date).startsWith(month));
    const devices = inMonth.reduce((a, p) => a + p.items.reduce((x, i) => x + i.serials.length, 0), 0);
    host.querySelector('[data-kpis]').innerHTML = `
      <div class="kpi"><div class="kpi-label">${icon('truck')} Compras no mês</div>
        <div class="kpi-value sm">${moneyHTML(inMonth.reduce((a, p) => a + p.total, 0))}</div>
        <div class="kpi-foot">${inMonth.length} ${inMonth.length === 1 ? 'entrada' : 'entradas'}</div></div>
      <div class="kpi"><div class="kpi-label">${icon('device')} Aparelhos recebidos no mês</div>
        <div class="kpi-value num">${devices}</div><div class="kpi-foot">com IMEI cadastrado</div></div>`;

    const list = all.filter((p) => matches(q, p.supplierName, p.invoiceRef, String(p.number),
      p.items.map((i) => `${i.description} ${i.serials.join(' ')}`).join(' ')));
    host.querySelector('[data-count]').textContent = `${list.length} ${list.length === 1 ? 'entrada' : 'entradas'}`;
    const $list = host.querySelector('[data-list]');
    if (!list.length) {
      $list.innerHTML = `<div class="card">${emptyState({
        emoji: '🚚', title: all.length ? 'Nada encontrado' : 'Nenhuma entrada ainda',
        text: 'Lance aqui o que chega do fornecedor: o estoque sobe e o custo real (com frete e câmbio) fica certo para o lucro.',
        action: `<button class="btn btn-primary" data-new-purchase>${icon('plus')} Lançar entrada</button>`,
      })}</div>`;
      return;
    }
    $list.innerHTML = `<div class="card mobile-list">${list.map((p) => {
      const units = p.items.reduce((a, i) => a + i.qty, 0);
      return `
        <button type="button" class="m-row${p.status === 'cancelada' ? ' is-muted' : ''}" data-open="${esc(p.id)}">
          <span class="m-main">
            <span class="m-title">${esc(p.supplierName || 'Sem fornecedor')} <span class="dim mono xs">#${p.number}</span></span>
            <span class="m-sub">${esc(formatDate(p.date))} · ${units} ${units === 1 ? 'unidade' : 'unidades'}${p.currency === 'USD' ? ` · US$ × ${p.exchangeRate.toFixed(2).replace('.', ',')}` : ''}
              ${p.status === 'cancelada' ? ' · <span class="neg">cancelada</span>' : ''}</span>
          </span>
          <span class="m-side"><span class="strong">${moneyHTML(p.total)}</span></span>
        </button>`;
    }).join('')}</div>`;
  }

  host.addEventListener('click', (e) => {
    if (e.target.closest('[data-new-purchase]')) { openPurchaseForm({}); return; }
    const o = e.target.closest('[data-open]');
    if (o) openPurchaseSheet(o.dataset.open);
  });

  const unsub = Data.subscribe((c) => { if (c.has('purchases')) render(); });
  render();
  return { onSearch(v) { q = v; render(); }, refresh: render, destroy: unsub };
}

/* =================================================================== */
/*  Ficha da entrada                                                    */
/* =================================================================== */

export function openPurchaseSheet(id) {
  const p = Data.purchase(id);
  if (!p) return;
  const modal = openModal({
    title: `Entrada #${p.number}`,
    subtitle: [p.supplierName, formatDate(p.date), p.invoiceRef].filter(Boolean).join(' · '),
    size: 'lg',
    body: `
      ${p.status === 'cancelada' ? `<div class="alert" data-kind="warn">${icon('alert')}<div>Entrada cancelada - não conta no estoque.</div></div>` : ''}
      <div class="variant-list">
        ${p.items.map((i) => `
          <div class="variant-row">
            <span class="v-main"><span class="v-title">${esc(i.description)}</span>
              <span class="v-sub">${i.qty} × ${p.currency === 'USD' ? `US$ ${esc(i.unitCostInput.toFixed(2).replace('.', ','))} → ` : ''}custo real ${moneyHTML(i.unitCost)}
                ${i.salePrice ? ` · venda ${moneyHTML(i.salePrice)}` : ''}</span>
              ${i.serials.length ? `<span class="v-sub mono">${i.serials.map(esc).join(' · ')}</span>` : ''}</span>
            <span class="v-side strong">${moneyHTML(i.unitCost * i.qty)}</span>
          </div>`).join('')}
      </div>
      <div class="totals">
        <div class="totals-row"><span class="muted">Produtos</span>${moneyHTML(p.itemsTotal)}</div>
        ${p.freight ? `<div class="totals-row"><span class="muted">Frete</span>${moneyHTML(p.freight)}</div>` : ''}
        ${p.otherCosts ? `<div class="totals-row"><span class="muted">Taxas / impostos</span>${moneyHTML(p.otherCosts)}</div>` : ''}
        <div class="totals-row grand"><span>Total</span>${moneyHTML(p.total)}</div>
      </div>
      ${p.notes ? `<div class="alert">${icon('info')}<div>${esc(p.notes)}</div></div>` : ''}`,
    footer: p.status === 'lancada'
      ? `<button class="btn btn-ghost" data-cancel-purchase>${icon('x')} Cancelar entrada</button><span class="grow"></span><button class="btn" data-close>Fechar</button>`
      : '<button class="btn" data-close>Fechar</button>',
  });
  modal.foot.querySelector('[data-cancel-purchase]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const ok = await confirmDialog({
      title: 'Cancelar esta entrada?',
      message: 'O que ela pôs no estoque sai, e o custo médio volta ao de antes. Se algum aparelho dela já foi vendido, não dá para cancelar.',
      confirmText: 'Cancelar entrada', cancelText: 'Voltar', danger: true,
    });
    if (!ok) return;
    await withLoading(btn, async () => {
      try {
        await Data.cancelPurchase(p.id);
        toast('Entrada cancelada');
        modal.close();
      } catch (err) { toastError('Não foi possível cancelar', friendlyError(err)); }
    });
  });
}

/* =================================================================== */
/*  Nova entrada                                                        */
/* =================================================================== */

/** @param {{ variantId?: string }} opts  variantId: já começa com essa variação na nota */
export function openPurchaseForm({ variantId = null } = {}) {
  const d = {
    supplierName: '', date: todayISO(), invoiceRef: '', currency: 'BRL', exchangeRate: 5.5,
    freight: 0, otherCosts: 0, notes: '', lines: [],
  };
  if (variantId) {
    const v = Data.variant(variantId);
    if (v) d.lines.push(lineFromVariant(v));
  }
  const markup = Data.settings().defaultMarkupPct;

  const modal = openModal({
    title: 'Nova entrada',
    subtitle: 'O que chegou do fornecedor: o estoque sobe e o custo fica certo',
    size: 'xl',
    body: `
      <div class="form-grid">
        <div class="field span-6"><label class="label" for="pu-sup">Fornecedor</label>
          <input class="input" id="pu-sup" name="supplierName" list="pu-sups" maxlength="120" autocomplete="off" placeholder="ex.: Fornecedor Paraguai">
          <datalist id="pu-sups">${Data.suppliers().map((s) => `<option value="${esc(s.name)}">`).join('')}</datalist></div>
        <div class="field span-3 span-half-mobile"><label class="label" for="pu-date">Data</label>
          <input class="input" id="pu-date" name="date" type="date" value="${esc(d.date)}"></div>
        <div class="field span-3 span-half-mobile"><label class="label" for="pu-ref">Nota / referência</label>
          <input class="input" id="pu-ref" name="invoiceRef" maxlength="60" placeholder="-"></div>
        <div class="field span-4 span-half-mobile"><span class="label">Moeda dos custos</span>
          <div class="segmented" role="group">
            <button type="button" data-cur="BRL" aria-pressed="true">R$</button>
            <button type="button" data-cur="USD" aria-pressed="false">US$</button>
          </div></div>
        <div class="field span-4 span-half-mobile" data-rate-field hidden><label class="label" for="pu-rate">Câmbio (R$ por US$)</label>
          <input class="input" id="pu-rate" name="exchangeRate" type="text" inputmode="decimal" value="5,50"></div>
        <div class="field span-4 span-half-mobile"><label class="label" for="pu-freight">Frete (R$)</label>
          <div class="money-input"><input class="input" id="pu-freight" name="freight" ${MONEY_ATTRS}></div></div>
        <div class="field span-4 span-half-mobile"><label class="label" for="pu-other">Taxas / impostos (R$)</label>
          <div class="money-input"><input class="input" id="pu-other" name="otherCosts" ${MONEY_ATTRS}></div></div>
      </div>

      <div class="fieldset">
        <div class="fieldset-title">Itens da nota</div>
        <div data-lines></div>
        <button type="button" class="btn btn-outline btn-block" data-add-line style="border-style:dashed">${icon('plus')} Adicionar produto</button>
      </div>

      <div class="totals" data-totals></div>
      <div class="field"><label class="label" for="pu-notes">Observação</label>
        <input class="input" id="pu-notes" name="notes" maxlength="500"></div>
      <div class="alert hide" data-erro data-kind="warn">${icon('alert')}<div data-erro-txt></div></div>`,
    footer: `<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Lançar entrada</button>`,
    beforeClose: async () => {
      if (!d.lines.length) return true;
      return confirmDialog({ title: 'Descartar a entrada?', message: 'Os itens ainda não foram lançados.', confirmText: 'Descartar', cancelText: 'Continuar', danger: true });
    },
  });
  const $ = (s) => modal.body.querySelector(s);

  function preview() {
    return apportionCosts(d.lines.map((l) => ({ qty: l.qty, unitCost: l.unitCost, units: l.serial ? l.units : null })),
      { freight: d.freight, otherCosts: d.otherCosts, exchangeRate: d.exchangeRate, currency: d.currency });
  }

  function renderLines() {
    const pv = preview();
    const cur = d.currency === 'USD' ? 'US$' : 'R$';
    $('[data-lines]').innerHTML = d.lines.length ? d.lines.map((l, i) => {
      const v = Data.variant(l.variantId);
      const p = Data.product(l.productId);
      const real = pv.lines[i]?.unitCost || 0;
      const sugg = suggestPrice(real, markup);
      return `
        <div class="purchase-line" data-li="${i}">
          <div class="row gap-3">
            ${productThumb(p, 'sm', v)}
            <div class="grow" style="min-width:0">
              <div class="item-title">${esc(p?.name || '')}</div>
              <div class="xs dim">${esc(variantLabel(l) || 'Padrão')}${v ? ` · hoje ${v.stock} em estoque` : ' · <span class="tone-amber">variação nova</span>'}</div>
            </div>
            <button type="button" class="icon-btn sm" data-rm-line="${i}" aria-label="Remover">${icon('trash')}</button>
          </div>
          <div class="form-grid">
            ${l.serial ? '' : `<div class="field span-3 span-half-mobile"><label class="label">Quantidade</label>
              <input class="input" data-lf="qty" type="number" inputmode="numeric" min="1" max="9999" value="${esc(l.qty)}"></div>`}
            <div class="field span-3 span-half-mobile"><label class="label">Custo unitário (${cur})</label>
              <div class="money-input" data-cur-label="${cur}"><input class="input" data-lf="unitCost" ${MONEY_ATTRS} value="${esc(moneyInputValue(l.unitCost))}"></div></div>
            <div class="field span-3 span-half-mobile"><label class="label">Preço de venda <span class="dim">(opcional)</span></label>
              <div class="money-input"><input class="input" data-lf="salePrice" ${MONEY_ATTRS} value="${esc(moneyInputValue(l.salePrice))}" placeholder="${esc(moneyInputValue(sugg))}"></div></div>
            <div class="field span-3 span-half-mobile"><span class="label">Custo real (R$)</span>
              <div class="cost-readonly"><span class="num money-sensitive strong">${esc(money(real))}</span>
                <span class="xs dim">${sugg ? `sugestão ${esc(money(sugg))}` : ''}</span></div></div>
          </div>
          ${l.serial ? `
            <div class="imei-list">
              <span class="label">Aparelhos (${l.units.length}) - IMEI obrigatório</span>
              ${l.units.map((u, j) => `
                <div class="unit-form-row" data-uj="${j}">
                  <div class="field grow-2"><input class="input mono" data-uf="serial" maxlength="40" inputmode="numeric" autocomplete="off" value="${esc(u.serial)}" placeholder="IMEI ${j + 1}" aria-label="IMEI ${j + 1}"></div>
                  <div class="field"><select class="select" data-uf="origin" aria-label="Origem"><option value="">Origem</option>
                    ${ORIGINS.map((o) => `<option ${o === u.origin ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>
                  ${/seminovo|vitrine|cpo/i.test(l.condition) ? `<div class="field field-sm"><input class="input" data-uf="batteryHealth" type="number" inputmode="numeric" min="0" max="100" value="${esc(u.batteryHealth)}" placeholder="Bat. %" aria-label="Bateria %"></div>` : ''}
                  <div class="field"><div class="money-input"><input class="input" data-uf="cost" ${MONEY_ATTRS} value="${esc(u.cost === '' ? '' : moneyInputValue(u.cost))}" placeholder="mesmo custo" aria-label="Custo próprio"></div></div>
                  ${l.units.length > 1 ? `<button type="button" class="icon-btn sm" data-rm-unit="${j}" aria-label="Remover">${icon('x')}</button>` : ''}
                </div>`).join('')}
              <button type="button" class="btn btn-sm" data-add-unit>${icon('plus')} Outro aparelho</button>
              <span class="xs dim">Cole vários IMEIs (um por linha) no primeiro campo.</span>
            </div>` : ''}
        </div>`;
    }).join('') : '<p class="small dim">Nenhum item ainda. Toque em "Adicionar produto".</p>';
    renderTotals(pv);
  }

  function renderTotals(pv = preview()) {
    $('[data-totals]').innerHTML = `
      <div class="totals-row"><span class="muted">Produtos ${d.currency === 'USD' ? '(convertido)' : ''}</span>${moneyHTML(pv.itemsTotal)}</div>
      ${d.freight ? `<div class="totals-row"><span class="muted">Frete</span>${moneyHTML(d.freight)}</div>` : ''}
      ${d.otherCosts ? `<div class="totals-row"><span class="muted">Taxas</span>${moneyHTML(d.otherCosts)}</div>` : ''}
      <div class="totals-row grand"><span>Total da nota</span>${moneyHTML(pv.total)}</div>`;
  }

  function addFromPicker() {
    const picker = openProductPicker({
      title: 'O que chegou?', subtitle: 'Toque no modelo e escolha a variação',
      allowFree: false,
      counts: () => {
        const m = new Map();
        d.lines.forEach((l) => m.set(l.productId, (m.get(l.productId) || 0) + (l.serial ? l.units.length : l.qty)));
        return m;
      },
      footer: () => `${d.lines.length} ${d.lines.length === 1 ? 'linha' : 'linhas'} na nota`,
      onPick: (product) => {
        if (!product) return;
        pickVariant(product, (line) => {
          d.lines.push(line);
          renderLines();
          picker.refresh();
          picker.bump(product.id);
        });
      },
    });
  }

  modal.body.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-add-line]')) { addFromPicker(); return; }
    const cur = t.closest('[data-cur]');
    if (cur) {
      d.currency = cur.dataset.cur;
      modal.body.querySelectorAll('[data-cur]').forEach((b) => b.setAttribute('aria-pressed', String(b === cur)));
      $('[data-rate-field]').hidden = d.currency !== 'USD';
      renderLines();
      return;
    }
    const li = t.closest('[data-li]');
    if (!li) return;
    const l = d.lines[Number(li.dataset.li)];
    if (t.closest('[data-rm-line]')) { d.lines.splice(Number(li.dataset.li), 1); renderLines(); return; }
    if (t.closest('[data-add-unit]')) {
      l.units.push({ serial: '', origin: l.units.at(-1)?.origin || '', batteryHealth: '', cost: '' });
      l.qty = l.units.length;
      renderLines();
      modal.body.querySelector(`[data-li="${li.dataset.li}"] [data-uj="${l.units.length - 1}"] [data-uf="serial"]`)?.focus();
      return;
    }
    const rmu = t.closest('[data-rm-unit]');
    if (rmu) { l.units.splice(Number(rmu.dataset.rmUnit), 1); l.qty = l.units.length; renderLines(); }
  });

  modal.body.addEventListener('input', (e) => {
    const t = e.target;
    const field = t.name;
    if (['freight', 'otherCosts'].includes(field)) { d[field] = parseMoney(t.value); renderTotals(); refreshReal(); return; }
    if (field === 'exchangeRate') { d.exchangeRate = Number(String(t.value).replace(',', '.')) || 0; refreshReal(); renderTotals(); return; }
    if (field) { d[field] = t.value; return; }
    const li = t.closest('[data-li]');
    if (!li) return;
    const l = d.lines[Number(li.dataset.li)];
    const lf = t.dataset.lf;
    if (lf === 'qty') l.qty = Math.max(Math.trunc(Number(t.value)) || 1, 1);
    if (lf === 'unitCost') l.unitCost = parseMoney(t.value);
    if (lf === 'salePrice') l.salePrice = parseMoney(t.value);
    const uf = t.dataset.uf;
    if (uf) {
      const j = Number(t.closest('[data-uj]').dataset.uj);
      if (uf === 'serial' && /[\n,;]/.test(t.value)) {
        const list = t.value.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
        l.units.splice(j, 1, ...list.map((serial) => ({ ...l.units[j], serial })));
        l.qty = l.units.length;
        renderLines();
        return;
      }
      l.units[j][uf] = uf === 'cost' ? (t.value.trim() ? parseMoney(t.value) : '') : t.value;
      if (uf === 'cost') refreshReal();
      return;
    }
    if (lf === 'qty' || lf === 'unitCost') refreshReal();
  });
  modal.body.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('select[data-uf]')) {
      const l = d.lines[Number(t.closest('[data-li]').dataset.li)];
      l.units[Number(t.closest('[data-uj]').dataset.uj)][t.dataset.uf] = t.value;
    }
  });

  /** Atualiza só os números calculados (não redesenha os campos onde a pessoa digita). */
  function refreshReal() {
    const pv = preview();
    d.lines.forEach((l, i) => {
      const box = modal.body.querySelector(`[data-li="${i}"] .cost-readonly`);
      if (!box) return;
      const real = pv.lines[i]?.unitCost || 0;
      const sugg = suggestPrice(real, markup);
      box.innerHTML = `<span class="num money-sensitive strong">${esc(money(real))}</span><span class="xs dim">${sugg ? `sugestão ${esc(money(sugg))}` : ''}</span>`;
      const sp = modal.body.querySelector(`[data-li="${i}"] [data-lf="salePrice"]`);
      if (sp) sp.placeholder = moneyInputValue(sugg);
    });
    renderTotals(pv);
  }

  const showError = (msg) => { $('[data-erro-txt]').textContent = msg; $('[data-erro]').classList.remove('hide'); $('[data-erro]').scrollIntoView({ block: 'nearest' }); };

  modal.foot.querySelector('[data-ok]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!d.lines.length) { showError('Adicione pelo menos um produto.'); return; }
    if (d.currency === 'USD' && !(d.exchangeRate > 0)) { showError('Informe o câmbio (quantos reais vale 1 dólar).'); return; }
    const seen = new Set();
    for (const l of d.lines) {
      if (!l.serial) continue;
      l.units = l.units.filter((u) => u.serial.trim());
      if (!l.units.length) { showError(`Informe o IMEI dos aparelhos de ${Data.product(l.productId)?.name}.`); renderLines(); return; }
      for (const u of l.units) {
        const s = u.serial.trim().toUpperCase();
        if (seen.has(s)) { showError(`O IMEI ${u.serial} aparece duas vezes na nota.`); return; }
        seen.add(s);
      }
      l.qty = l.units.length;
    }
    if (d.lines.some((l) => !(l.unitCost > 0) && !(l.units || []).every((u) => u.cost > 0))) {
      const go = await confirmDialog({ title: 'Item sem custo', message: 'Algum item está sem custo - o lucro dos pedidos vai sair errado. Lançar assim mesmo?', confirmText: 'Lançar assim' });
      if (!go) return;
    }
    await withLoading(btn, async () => {
      try {
        let supplierId = null;
        const name = d.supplierName.trim();
        if (name) {
          supplierId = Data.suppliers().find((s) => s.name.toLowerCase() === name.toLowerCase())?.id
            || (await Data.saveSupplier({ name })).id;
        }
        const saved = await Data.postPurchase({
          ...d, supplierId, supplierName: name,
          items: d.lines.map((l) => ({
            variantId: l.variantId, productId: l.productId, storage: l.storage, color: l.color, size: l.size,
            condition: l.condition, qty: l.qty, unitCost: l.unitCost, salePrice: l.salePrice,
            units: l.serial ? l.units : null,
          })),
        });
        d.lines = [];
        modal.close();
        toast(`Entrada #${saved.number} lançada`, { text: 'Estoque e custos atualizados.' });
      } catch (err) {
        showError(friendlyError(err));
      }
    });
  });

  renderLines();
  if (!d.lines.length) setTimeout(addFromPicker, 0);
  return modal;
}

function lineFromVariant(v) {
  const p = Data.product(v.productId);
  return {
    productId: v.productId, variantId: v.id, storage: v.storage, color: v.color, size: v.size, condition: v.condition,
    serial: !!p?.tracksSerial, qty: 1, unitCost: 0, salePrice: 0,
    units: p?.tracksSerial ? [{ serial: '', origin: '', batteryHealth: '', cost: '' }] : [],
  };
}

/** Escolhe (ou cria) a variação que chegou: chips das opções do modelo. */
function pickVariant(product, onPick) {
  const cat = Data.category(product.categoryId);
  const vs = Data.variantsOf(product.id).filter((v) => v.active);
  const opt = (list, field) => [...new Set([...(list || []), ...vs.map((v) => v[field]).filter(Boolean)])];
  const groups = [
    { field: 'size', label: cat?.sizeLabel || 'Tamanho', options: opt(product.sizes, 'size') },
    { field: 'storage', label: cat?.variantLabel || 'Capacidade', options: opt(product.storages, 'storage') },
    { field: 'color', label: cat?.colorLabel || 'Cor', options: opt(product.colors, 'color') },
    { field: 'condition', label: 'Condição', options: [...new Set([...CONDITIONS, ...vs.map((v) => v.condition)])] },
  ].filter((g) => g.options.length);
  const sel = { size: '', storage: '', color: '', condition: 'Lacrado' };
  for (const g of groups) if (g.options.length === 1) sel[g.field] = g.options[0];

  const modal = openModal({
    title: product.name, subtitle: 'Qual variação chegou?', sheet: true, size: 'lg',
    body: `
      ${vs.length ? `<div class="config-field"><span class="label">Já cadastradas</span><div class="chips">
        ${vs.map((v) => `<button type="button" class="chip sm" data-existing="${esc(v.id)}">${esc(variantLabel(v) || 'Padrão')}</button>`).join('')}</div></div>` : ''}
      ${groups.map((g) => `<div class="config-field"><span class="label">${esc(g.label)}</span><div class="chips">
        ${g.options.map((o) => `<button type="button" class="chip sm" data-set="${g.field}" data-value="${esc(o)}" aria-pressed="${sel[g.field] === o}">${esc(o)}</button>`).join('')}</div></div>`).join('')}
      <p class="small" data-vstate></p>`,
    footer: '<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Adicionar à nota</button>',
  });
  const state = () => {
    const v = Data.findVariant(product.id, sel);
    modal.body.querySelector('[data-vstate]').innerHTML = v
      ? `<span class="pos">${icon('check')} ${esc(variantLabel(v))}</span> · hoje ${v.stock} em estoque`
      : `<span class="tone-amber">${icon('plus')} Variação nova</span> - será cadastrada com a entrada.`;
    modal.body.querySelectorAll('[data-existing]').forEach((b) => b.setAttribute('aria-pressed', String(v?.id === b.dataset.existing)));
  };
  modal.body.addEventListener('click', (e) => {
    const ex = e.target.closest('[data-existing]');
    if (ex) {
      const v = Data.variant(ex.dataset.existing);
      Object.assign(sel, { size: v.size, storage: v.storage, color: v.color, condition: v.condition });
      modal.body.querySelectorAll('[data-set]').forEach((b) => b.setAttribute('aria-pressed', String(sel[b.dataset.set] === b.dataset.value)));
      state();
      return;
    }
    const c = e.target.closest('[data-set]');
    if (!c) return;
    sel[c.dataset.set] = c.dataset.value;
    c.parentElement.querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-pressed', String(b === c)));
    state();
  });
  modal.foot.querySelector('[data-ok]').addEventListener('click', () => {
    const missing = groups.find((g) => g.options.length > 1 && !sel[g.field]);
    if (missing) { modal.body.querySelector('[data-vstate]').innerHTML = `<span class="neg">Escolha: ${esc(missing.label.toLowerCase())}.</span>`; return; }
    const v = Data.findVariant(product.id, sel);
    modal.close();
    onPick(v ? lineFromVariant(v) : {
      productId: product.id, variantId: null, ...sel, serial: product.tracksSerial, qty: 1, unitCost: 0, salePrice: 0,
      units: product.tracksSerial ? [{ serial: '', origin: '', batteryHealth: '', cost: '' }] : [],
    });
  });
  state();
}

export { round2 };
