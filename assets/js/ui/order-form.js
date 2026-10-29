/** Formulário de cadastro / edição de pedido. */

import { newOrderDraft } from '../core/data.js';
import {
  STATUSES, PAYMENT_METHODS, CHANNELS, SHIPPING_METHODS, UFS,
} from '../core/constants.js';
import * as Data from '../core/data.js';
import { orderTotals } from '../core/calc.js';
import { friendlyError, isConflict } from '../core/errors.js';
import { openProductPicker, itemsFooter, countsByProduct } from './product-picker.js';
import { openItemEditor } from './item-editor.js';
import { paymentsHTML, wirePayments } from './payments.js';
import { mountPlanEditor } from './plan-editor.js';
import { openModal, toast, toastError, confirmDialog, withLoading } from './kit.js';
import { icon } from './icons.js';
import {
  esc, money, parseMoney, moneyInputValue, maskPhone, maskCEP, onlyDigits, todayISO, isMobile, uid,
} from '../core/utils.js';

/** Atributos comuns dos campos de dinheiro: teclado só de números no celular. */
const MONEY_ATTRS = 'inputmode="numeric" autocomplete="off" placeholder="0,00"';

/**
 * Totais do jeito que o banco calcula - a tela nunca mente. Uma fórmula só
 * (calc.orderTotals): quantidade nunca menor que os IMEIs escolhidos, lucro
 * com o frete cobrado, centavos arredondados igual ao banco.
 */
export function computeTotals(order) {
  return orderTotals(order || {});
}

/**
 * @param {{order?: object, prefill?: object, onSaved?: (o: object) => void}} opts
 *   prefill: campos de um pedido novo já preenchidos (ex.: pedido do catálogo)
 */
export function openOrderForm({ order = null, prefill = null, onSaved } = {}) {
  const draft = order ? structuredClone(order) : { ...newOrderDraft(), ...(prefill || {}) };
  const editing = !!draft.id;
  const initial = JSON.stringify(draft);

  const modal = openModal({
    title: editing ? `Pedido #${String(draft.code).padStart(4, '0')}` : 'Novo pedido',
    subtitle: editing ? 'Alterações são salvas no fim da tela' : 'Preencha o essencial - o resto dá para completar depois',
    size: 'xl',
    body: bodyHTML(draft),
    footer: `
      <button class="btn btn-ghost" data-close>Cancelar</button>
      <button class="btn btn-primary" data-save>${editing ? 'Salvar alterações' : 'Criar pedido'}</button>`,
    // Um toque errado no X (ou o "voltar" do Android) não pode jogar fora
    // um pedido inteiro já digitado.
    beforeClose: async () => {
      if (JSON.stringify(draft) === initial) return true;
      return confirmDialog({
        title: editing ? 'Descartar as alterações?' : 'Descartar este pedido?',
        message: editing
          ? 'O que você mudou neste pedido ainda não foi salvo.'
          : 'O pedido ainda não foi criado. Tudo o que foi preenchido será perdido.',
        confirmText: 'Descartar',
        cancelText: 'Continuar editando',
        danger: true,
      });
    },
  });

  const panel = modal.panel;
  const $items = panel.querySelector('[data-items]');
  const $totals = panel.querySelector('[data-totals]');
  const $payments = panel.querySelector('[data-payments]');
  if (!Array.isArray(draft.plan)) draft.plan = [];

  /* -------------------------------------------------------- pagamentos */

  function renderPayments() {
    const t = computeTotals(draft);
    $payments.innerHTML = paymentsHTML(draft, t.total);
    plan?.refresh();
    renderStatusHint();
    renderSaleHint();
  }

  /** Venda de balcão: quitou e o cliente já levou → "Finalizar venda" num toque. */
  function renderSaleHint() {
    const el = panel.querySelector('[data-sale-hint]');
    if (!el) return;
    const t = computeTotals(draft);
    const show = draft.items.length && t.total > 0 && t.balance <= 0 && ['novo', 'pago', 'preparo'].includes(draft.status);
    el.innerHTML = show ? `
      <div class="alert" data-kind="success" style="margin-top:10px">${icon('checkCircle')}<div class="grow">Quitado. O cliente já levou?</div>
        <button type="button" class="btn btn-sm btn-primary" data-finish-sale>Finalizar venda</button></div>` : '';
  }

  /* ---------------------------------------------------- fiado / parcelas */

  const $planBox = panel.querySelector('[data-plan-box]');
  const plan = mountPlanEditor(panel.querySelector('[data-plan]'), {
    plan: draft.plan,
    total: () => computeTotals(draft).total,
    paid: () => computeTotals(draft).paid,
    onChange: (list) => { draft.plan = list; },
  });
  if (draft.plan.length) $planBox.open = true;

  /** "Pago"/"Finalizado" com saldo: avisa o que o banco vai fazer. */
  function renderStatusHint() {
    const el = panel.querySelector('[data-status-hint]');
    if (!el) return;
    const t = computeTotals(draft);
    const open = t.total > 0 && t.balance > 0;
    el.hidden = !(open && ['pago', 'entregue'].includes(draft.status));
    el.innerHTML = draft.status === 'entregue'
      ? `${icon('wallet')}<div>Falta receber <b>${esc(money(t.balance))}</b>: o cliente leva no <b>fiado</b> e o pedido fica <b>Aguardando pagamento</b> até quitar (finaliza sozinho).</div>`
      : `${icon('alert')}<div>Falta receber <b>${esc(money(t.balance))}</b>: sem o pagamento o pedido fica <b>Aguardando pagamento</b>.</div>`;
  }

  wirePayments(
    $payments,
    () => ({
      payments: draft.payments,
      saldo: computeTotals(draft).balance,
      metodoPadrao: draft.paymentMethod,
    }),
    (lista) => {
      draft.payments = lista;
      renderPayments();
      renderTotals();
    },
  );

  /* ------------------------------------------------------------- itens */

  function renderItems() {
    if (!draft.items.length) {
      $items.innerHTML = `
        <button type="button" class="btn btn-outline btn-block" data-pick style="padding:18px;border-style:dashed">
          ${icon('plus')} Adicionar produtos
        </button>`;
      renderTotals();
      return;
    }

    $items.innerHTML = `
      ${draft.items.map((it, i) => `
        <div class="item-row" data-index="${i}">
          <div class="grow" data-edit-item="${i}" role="button" tabindex="0" aria-label="Editar item">
            <div class="item-title">${esc(it.productName || 'Item')}</div>
            <div class="item-meta">
              ${[it.size, it.variant, it.color, it.condition, it.band, it.origin]
                .filter(Boolean).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}
              ${it.serial ? `<span class="tag mono">${icon('device')} ${esc(it.serial)}</span>` : ''}
              ${it.qty > 1 ? `<span class="tag">${esc(it.qty)}×</span>` : ''}
              ${needsSerial(it) ? `<span class="tag">${icon('device')} aparelho do estoque (IMEI opcional)</span>` : ''}
              ${!it.variantId && !Data.product(it.productId) ? '<span class="tag">avulso</span>' : ''}
            </div>
            ${it.note ? `<div class="xs dim" style="margin-top:5px">${esc(it.note)}</div>` : ''}
          </div>
          <div class="item-numbers">
            <div class="right">
              <div class="strong mono money-sensitive">${esc(money((Number(it.unitPrice) || 0) * (Number(it.qty) || 1)))}</div>
              ${it.qty > 1 ? `<div class="xs dim mono money-sensitive">${esc(it.qty)} × ${esc(money(it.unitPrice))}</div>` : ''}
              ${it.unitCost ? `<div class="xs dim mono money-sensitive">custo ${esc(money(it.unitCost * (it.qty || 1)))}</div>` : ''}
              ${!(Number(it.unitPrice) > 0) ? `<div class="xs neg">sem valor</div>` : ''}
            </div>
            <div class="item-actions">
              <button type="button" class="icon-btn sm" data-edit-item="${i}" aria-label="Editar item">${icon('edit')}</button>
              <button type="button" class="icon-btn sm" data-dup-item="${i}" aria-label="Duplicar item">${icon('copy')}</button>
              <button type="button" class="icon-btn sm" data-del-item="${i}" aria-label="Remover item">${icon('trash')}</button>
            </div>
          </div>
        </div>`).join('')}
      <button type="button" class="btn btn-outline btn-sm" data-pick style="margin-top:12px">
        ${icon('plus')} Adicionar mais
      </button>`;
    renderTotals();
  }

  function renderTotals() {
    const t = computeTotals(draft);
    $totals.innerHTML = `
      <div class="totals-row"><span class="muted">Produtos (${draft.items.length})</span>
        <span class="num money-sensitive">${esc(money(t.subtotal))}</span></div>
      ${t.discount ? `<div class="totals-row"><span class="muted">Desconto</span>
        <span class="num neg money-sensitive">- ${esc(money(t.discount))}</span></div>` : ''}
      ${t.shipping ? `<div class="totals-row"><span class="muted">Frete cobrado</span>
        <span class="num money-sensitive">${esc(money(t.shipping))}</span></div>` : ''}
      <div class="totals-row grand"><span>Total</span>
        <span class="num money-sensitive ${t.total < 0 ? 'neg' : ''}">${esc(money(t.total))}</span></div>
      ${t.total < 0 ? `<div class="totals-row"><span class="small tone-red">${icon('alert')} O desconto passou do valor do pedido</span></div>` : ''}
      ${t.costTotal || draft.shippingExpense ? `
        <div class="totals-row"><span class="muted small">Lucro estimado</span>
          <span class="num small ${t.profit >= 0 ? 'pos' : 'neg'} money-sensitive">${esc(money(t.profit))}</span></div>` : ''}
      ${t.paid > 0 ? `
        <div class="totals-row"><span class="muted small">Já recebido</span>
          <span class="num small money-sensitive">${esc(money(t.paid))}</span></div>
        <div class="totals-row"><span class="muted small">Falta receber</span>
          <span class="num small strong money-sensitive">${esc(money(t.balance))}</span></div>` : ''}`;
  }

  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-finish-sale]')) {
      draft.status = 'entregue';
      const sel = panel.querySelector('[data-field="status"]');
      if (sel) sel.value = 'entregue';
      renderSaleHint();
      renderStatusHint();
      toast('Situação: Finalizado', { text: 'É só tocar em "Criar pedido".', duration: 2200 });
      return;
    }
    if (e.target.closest('[data-pick]')) {
      openProductPicker({
        defaultCategory: draft.items.at(-1)?.categoryId || '',
        counts: () => countsByProduct(draft.items),
        footer: () => `${itemsFooter(draft.items)} no pedido`,
        onPick: (product, picker) => {
          openItemEditor({
            productId: product?.id || null,
            orderId: draft.id,
            takenUnitIds: takenUnits(),
            onSave: (item) => {
              draft.items.push(item);
              renderItems();
              renderPayments();
              picker.refresh();
              if (item.productId) picker.bump(item.productId);
            },
          });
        },
      });
      return;
    }

    const del = e.target.closest('[data-del-item]');
    if (del) {
      const index = Number(del.dataset.delItem);
      const [removed] = draft.items.splice(index, 1);
      renderItems();
      renderPayments();
      if (removed) toast(`${removed.productName || 'Item'} removido`, { kind: 'info', duration: 2200 });
      return;
    }

    const dup = e.target.closest('[data-dup-item]');
    if (dup) {
      const index = Number(dup.dataset.dupItem);
      const src = draft.items[index];
      if (!src) return;
      // Cópia para o segundo aparelho igual: mesmo modelo e valor, outro IMEI.
      draft.items.splice(index + 1, 0, {
        ...structuredClone(src), id: uid(), unitIds: [],
        serial: Data.product(src.productId)?.tracksSerial ? '' : src.serial,
        costSource: src.costSource === 'manual' ? 'manual' : 'auto',
      });
      renderItems();
      renderPayments();
      return;
    }

    const edit = e.target.closest('[data-edit-item]');
    if (edit) editItem(Number(edit.dataset.editItem));
  });

  panel.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-edit-item][role="button"]')) {
      e.preventDefault();
      editItem(Number(e.target.dataset.editItem));
    }
  });

  function editItem(index) {
    const it = draft.items[index];
    if (!it) return;
    openItemEditor({
      item: it,
      orderId: draft.id,
      takenUnitIds: takenUnits(index),
      onSave: (novo) => {
        draft.items[index] = novo;
        renderItems();
        renderPayments();
      },
    });
  }

  /** Aparelhos já escolhidos nos outros itens do pedido (não aparecem de novo). */
  function takenUnits(exceptIndex = -1) {
    return new Set(draft.items.flatMap((x, i) => (i === exceptIndex ? [] : x.unitIds || [])));
  }

  /** Aparelho com IMEI ainda sem a unidade escolhida (encomenda). */
  function needsSerial(it) {
    return !!(it.variantId && Data.product(it.productId)?.tracksSerial && (it.unitIds || []).length < (Number(it.qty) || 1));
  }

  /* --------------------------------------------------- campos do pedido */

  panel.addEventListener('input', (e) => {
    const f = e.target.closest('[data-field]');
    if (!f) return;
    const name = f.dataset.field;

    if (name === 'customerPhone') f.value = maskPhone(f.value);
    if (name === 'shipCep') f.value = maskCEP(f.value);

    if (['discount', 'shippingCost', 'shippingExpense'].includes(name)) {
      draft[name] = parseMoney(f.value);
      f.removeAttribute('aria-invalid');
      renderTotals();
      renderPayments();   // o saldo em aberto muda junto
      return;
    }
    if (name === 'installments') { draft[name] = Number(f.value) || 1; return; }
    if (f.type === 'checkbox') { draft[name] = f.checked; return; }
    draft[name] = f.value;
  });

  panel.addEventListener('change', (e) => {
    const f = e.target.closest('[data-field]');
    if (!f) return;
    if (f.type === 'checkbox') draft[f.dataset.field] = f.checked;
    else draft[f.dataset.field] = f.value;
    if (f.dataset.field === 'customerName') fillFromCustomer(f.value);
    if (f.dataset.field === 'status') { renderStatusHint(); renderSaleHint(); }
  });

  // Busca de CEP pelos Correios (ViaCEP) - preenche o endereço sozinho.
  panel.querySelector('[data-field="shipCep"]')?.addEventListener('blur', async (e) => {
    const cep = onlyDigits(e.target.value);
    if (cep.length !== 8) return;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = await res.json();
      if (data.erro) { toast('CEP não encontrado.', { kind: 'warn' }); return; }
      const set = (field, value) => {
        const el = panel.querySelector(`[data-field="${field}"]`);
        if (el && value && !el.value) { el.value = value; draft[field] = value; }
      };
      set('shipStreet', data.logradouro);
      set('shipDistrict', data.bairro);
      set('shipCity', data.localidade);
      set('shipUf', data.uf);
      panel.querySelector('[data-field="shipNumber"]')?.focus();
    } catch {
      /* sem internet ou serviço fora do ar: o usuário digita à mão */
    }
  });

  /** Ao repetir um cliente já cadastrado, puxa telefone e endereço. */
  function fillFromCustomer(name) {
    if (editing) return;
    const found = Data.customersList().find(
      (c) => c.name.toLowerCase() === String(name).trim().toLowerCase(),
    );
    draft.customerId = found?.id || null;
    if (!found) return;
    const map = {
      customerPhone: found.phone, customerEmail: found.email, customerDoc: found.doc,
      shipCep: found.cep, shipStreet: found.street, shipNumber: found.number,
      shipComplement: found.complement, shipDistrict: found.district,
      shipCity: found.city, shipUf: found.uf,
    };
    let touched = false;
    for (const [field, value] of Object.entries(map)) {
      const el = panel.querySelector(`[data-field="${field}"]`);
      if (el && value && !el.value) { el.value = value; draft[field] = value; touched = true; }
    }
    if (touched) toast('Dados do cliente preenchidos', { kind: 'info', duration: 2200 });
  }

  /* ------------------------------------------------------------- salvar */

  const $save = modal.foot.querySelector('[data-save]');
  const $name = panel.querySelector('[data-field="customerName"]');

  // O aviso de "falta o nome" some assim que a pessoa começa a digitar.
  $name.addEventListener('input', () => $name.removeAttribute('aria-invalid'));

  $save.addEventListener('click', async () => {
    if ($save.disabled) return;
    if (!String(draft.customerName).trim()) {
      $name.setAttribute('aria-invalid', 'true');
      $name.scrollIntoView({ block: 'center', behavior: 'smooth' });
      $name.focus({ preventScroll: true });
      toast('Informe o nome do cliente.', { kind: 'warn' });
      return;
    }
    // desconto maior que itens + frete: o banco recusaria (total negativo)
    const t0 = computeTotals(draft);
    if (t0.total < 0) {
      const $d = panel.querySelector('[data-field="discount"]');
      $d?.setAttribute('aria-invalid', 'true');
      $d?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      $d?.focus({ preventScroll: true });
      toast(`O desconto (${money(t0.discount)}) é maior que o pedido (${money(t0.subtotal + t0.shipping)}).`, { kind: 'warn' });
      return;
    }
    if (!draft.items.length) {
      const ok = await confirmDialog({
        title: 'Pedido sem itens',
        message: 'Você ainda não adicionou nenhum produto. Quer salvar assim mesmo?',
        confirmText: 'Salvar assim',
      });
      if (!ok) return;
    }

    // `$save` e não `e.currentTarget`: depois de um `await` o evento já
    // terminou e o currentTarget vira null - o salvamento quebrava em
    // silêncio quando passava pela confirmação acima.
    // Encomenda chegando a "Em entrega"/"Finalizado" sem o IMEI: avisa antes do banco recusar.
    // IMEI é opcional: sem o aparelho escolhido, o sistema separa um do estoque.

    // Parcelas que não fecham com o total (o pedido mudou depois de montar).
    if (draft.status !== 'orcamento' && draft.status !== 'cancelado' && !plan.fits()) {
      const t = computeTotals(draft);
      const fix = await confirmDialog({
        title: 'As parcelas não fecham com o total',
        message: `O pedido agora é de ${money(t.total)}. Ajustar as parcelas que ainda estão abertas para fechar?`,
        confirmText: 'Ajustar parcelas',
      });
      if (!fix) { $planBox.open = true; $planBox.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
      plan.fit();
    }
    // Fiado: finalizar sem receber tudo = entrega no fiado (o banco deixa aguardando).
    const tt = computeTotals(draft);
    if (draft.status === 'entregue' && tt.total > 0 && tt.balance > 0 && !(order && order.status === 'aguardando' && order.handedOverAt)) {
      const go = await confirmDialog({
        title: 'Entregar no fiado?',
        message: `Falta receber ${money(tt.balance)}. O cliente leva agora e o pedido fica "Aguardando pagamento" até quitar - aí finaliza sozinho.${draft.plan.length ? '' : '\n\nDica: monte as parcelas em "Fiado / parcelas" para receber os avisos de vencimento.'}`,
        confirmText: 'Entregar no fiado',
      });
      if (!go) return;
    }

    const save = async () => {
      // Aparelho na troca lançado aqui: entra depois que o pedido existe -
      // o banco grava o pagamento e o aparelho no estoque juntos.
      const trades = draft.payments.filter((p) => p.trade && !p.tradeUnitId && !(order?.payments || []).some((x) => x.id === p.id));
      let saved = await Data.saveOrder({ ...draft, payments: draft.payments.filter((p) => !trades.includes(p)) });
      for (const t of trades) {
        try { saved = await Data.registerTradeIn(saved.id, t); } catch (err) { toastError('O pedido foi salvo, mas o aparelho da troca não entrou', friendlyError(err)); }
      }
      toast(editing ? 'Pedido atualizado' : `Pedido #${String(saved.code).padStart(4, '0')} criado`);
      modal.close();
      onSaved?.(saved);
    };

    await withLoading($save, async () => {
      try {
        await save();
      } catch (err) {
        console.error(err);
        if (isConflict(err)) {
          toastError('Pedido alterado em outro aparelho', friendlyError(err));
          return;
        }
        // Falta estoque: oferecer guardar como orçamento (não tira do estoque).
        if (/Estoque insuficiente/.test(err?.message || '') && draft.status !== 'orcamento') {
          const asQuote = await confirmDialog({
            title: 'Falta estoque',
            message: `${friendlyError(err)}

Quer salvar como orçamento? Ele não mexe no estoque e vira pedido depois.`,
            confirmText: 'Salvar como orçamento',
          });
          if (asQuote) {
            draft.status = 'orcamento';
            const sel = panel.querySelector('[data-field="status"]');
            if (sel) sel.value = 'orcamento';
            try { await save(); } catch (e2) { toastError('Não foi possível salvar', friendlyError(e2)); }
          }
          return;
        }
        toastError('Não foi possível salvar', friendlyError(err));
      }
    });
  });

  renderItems();
  renderPayments();
  return modal;
}

/* ----------------------------------------------------------- template -- */

function options(list, current) {
  return list.map((o) => {
    const value = typeof o === 'string' ? o : o.key;
    const label = typeof o === 'string' ? o : o.label;
    return `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(label)}</option>`;
  }).join('');
}

function bodyHTML(d) {
  const names = Data.customersList().filter((c) => c.active).map((c) => c.name).slice(0, 500);

  return `
    <section class="fieldset">
      <div class="fieldset-title">Cliente</div>
      <div class="form-grid">
        <div class="field span-6">
          <label class="label" for="f-name">Nome *</label>
          <input class="input" id="f-name" data-field="customerName" list="clientes" maxlength="120"
                 value="${esc(d.customerName)}" placeholder="Nome do cliente" autocomplete="off" data-autofocus>
          <datalist id="clientes">${names.map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>
        </div>
        <div class="field span-3 span-half-mobile">
          <label class="label" for="f-phone">WhatsApp</label>
          <input class="input" id="f-phone" data-field="customerPhone" inputmode="tel" maxlength="16"
                 value="${esc(maskPhone(d.customerPhone))}" placeholder="(00) 00000-0000">
        </div>
        <div class="field span-3 span-half-mobile">
          <label class="label" for="f-channel">Veio de</label>
          <select class="select" id="f-channel" data-field="channel">
            <option value="">-</option>${options(CHANNELS, d.channel)}
          </select>
        </div>
        <div class="field span-6">
          <label class="label" for="f-email">E-mail <span class="dim">(opcional)</span></label>
          <input class="input" id="f-email" data-field="customerEmail" type="email" maxlength="160"
                 value="${esc(d.customerEmail)}" placeholder="-">
        </div>
        <div class="field span-6">
          <label class="label" for="f-doc">CPF / documento <span class="dim">(opcional)</span></label>
          <input class="input" id="f-doc" data-field="customerDoc" maxlength="30"
                 value="${esc(d.customerDoc)}" placeholder="-">
        </div>
      </div>
    </section>

    <section class="fieldset">
      <div class="fieldset-title">Itens do pedido</div>
      <div data-items></div>
    </section>

    <section class="fieldset">
      <div class="fieldset-title">Valores e pagamento</div>
      <div class="form-grid">
        <div class="field span-3 span-half-mobile">
          <label class="label" for="f-discount">Desconto</label>
          <div class="money-input"><input class="input" id="f-discount" data-field="discount"
            ${MONEY_ATTRS} value="${esc(moneyInputValue(d.discount))}"></div>
        </div>
        <div class="field span-3 span-half-mobile">
          <label class="label" for="f-ship-cost">Frete cobrado</label>
          <div class="money-input"><input class="input" id="f-ship-cost" data-field="shippingCost"
            ${MONEY_ATTRS} value="${esc(moneyInputValue(d.shippingCost))}"></div>
        </div>
        <div class="field span-3 span-half-mobile">
          <label class="label" for="f-ship-exp">Frete que você pagou</label>
          <div class="money-input"><input class="input" id="f-ship-exp" data-field="shippingExpense"
            ${MONEY_ATTRS} value="${esc(moneyInputValue(d.shippingExpense))}"></div>
        </div>
        <div class="field span-3 span-half-mobile">
          <label class="label" for="f-installments">Parcelas combinadas</label>
          <input class="input" id="f-installments" data-field="installments" type="number" min="1" max="24"
                 value="${esc(d.installments)}">
        </div>

        <div class="field span-6">
          <label class="label" for="f-pay-method">Forma de pagamento combinada</label>
          <select class="select" id="f-pay-method" data-field="paymentMethod">
            <option value="">-</option>${options(PAYMENT_METHODS, d.paymentMethod)}
          </select>
        </div>

        <div class="span-12"><div class="totals" data-totals></div></div>
      </div>
    </section>

    <section class="fieldset">
      <div class="fieldset-title">Pagamentos recebidos</div>
      <p class="hint">
        Lance cada entrada conforme o cliente paga - sinal, parcelas, complemento.
        O “falta receber” se ajusta sozinho.
      </p>
      <div data-payments></div>
      <div data-sale-hint></div>
    </section>

    <details class="fieldset" data-plan-box>
      <summary class="fieldset-title">
        Fiado / parcelas
        <span class="summary-chev">${icon('chevronDown')}</span>
      </summary>
      <p class="hint">Cliente vai pagar o resto depois? Monte a entrada e as parcelas: o sistema avisa no dia do vencimento, mostra quem está atrasado
        em <b>A receber</b> e o pedido só finaliza quando tudo for pago.</p>
      <div data-plan></div>
    </details>

    <!-- No celular a entrega começa fechada: menos rolagem no cadastro. -->
    <details class="fieldset" ${isMobile() ? '' : 'open'}>
      <summary class="fieldset-title">
        Entrega
        <span class="summary-chev">${icon('chevronDown')}</span>
      </summary>
      <div class="form-grid">
        <div class="field span-5">
          <label class="label" for="f-ship-method">Como vai entregar</label>
          <select class="select" id="f-ship-method" data-field="shippingMethod">
            <option value="">-</option>${options(SHIPPING_METHODS, d.shippingMethod)}
          </select>
        </div>
        <div class="field span-4">
          <label class="label" for="f-tracking">Código de rastreio</label>
          <input class="input" id="f-tracking" data-field="trackingCode" maxlength="60"
                 value="${esc(d.trackingCode)}" placeholder="-">
        </div>
        <div class="field span-3">
          <label class="label" for="f-due">Previsão</label>
          <input class="input" id="f-due" data-field="dueDate" type="date" value="${esc(d.dueDate || '')}">
        </div>

        <div class="field span-3 span-half-mobile">
          <label class="label" for="f-cep">CEP</label>
          <input class="input" id="f-cep" data-field="shipCep" inputmode="numeric" maxlength="9"
                 value="${esc(maskCEP(d.shipCep))}" placeholder="00000-000">
        </div>
        <div class="field span-6">
          <label class="label" for="f-street">Rua</label>
          <input class="input" id="f-street" data-field="shipStreet" maxlength="160" value="${esc(d.shipStreet)}">
        </div>
        <div class="field span-3 span-half-mobile">
          <label class="label" for="f-number">Número</label>
          <input class="input" id="f-number" data-field="shipNumber" maxlength="20" value="${esc(d.shipNumber)}">
        </div>
        <div class="field span-4">
          <label class="label" for="f-complement">Complemento</label>
          <input class="input" id="f-complement" data-field="shipComplement" maxlength="80" value="${esc(d.shipComplement)}">
        </div>
        <div class="field span-3">
          <label class="label" for="f-district">Bairro</label>
          <input class="input" id="f-district" data-field="shipDistrict" maxlength="80" value="${esc(d.shipDistrict)}">
        </div>
        <div class="field span-3 span-half-mobile">
          <label class="label" for="f-city">Cidade</label>
          <input class="input" id="f-city" data-field="shipCity" maxlength="80" value="${esc(d.shipCity)}">
        </div>
        <div class="field span-2 span-half-mobile">
          <label class="label" for="f-uf">UF</label>
          <select class="select" id="f-uf" data-field="shipUf">
            <option value="">-</option>${options(UFS, d.shipUf)}
          </select>
        </div>
      </div>
    </details>

    <section class="fieldset">
      <div class="fieldset-title">Situação e anotações</div>
      <div class="form-grid">
        <div class="field span-4">
          <label class="label" for="f-status">Status do pedido</label>
          <select class="select" id="f-status" data-field="status">${options(STATUSES, d.status)}</select>
        </div>
        <div class="span-12 alert" data-kind="warn" data-status-hint hidden></div>
        <div class="field span-4 span-half-mobile">
          <label class="label" for="f-date">Data do pedido</label>
          <input class="input" id="f-date" data-field="orderDate" type="date" value="${esc(d.orderDate || todayISO())}">
        </div>
        <div class="field span-4 span-half-mobile" style="justify-content:flex-end">
          <label class="check" style="padding-bottom:9px">
            <input type="checkbox" data-field="priority" ${d.priority ? 'checked' : ''}>
            <span class="box"></span>
            <span>Marcar como urgente</span>
          </label>
        </div>
        <div class="field span-12">
          <label class="label" for="f-notes">Observações</label>
          <textarea class="textarea" id="f-notes" data-field="notes" maxlength="4000"
            placeholder="Combinado com o cliente, troca, garantia, o que for…">${esc(d.notes)}</textarea>
        </div>
      </div>
    </section>`;
}
