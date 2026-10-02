/** Formulário de cadastro / edição de pedido. */

import * as Store from '../core/store.js';
import { newOrderDraft } from '../core/store.js';
import {
  STATUSES, PAYMENT_METHODS, CHANNELS, SHIPPING_METHODS, UFS,
} from '../core/constants.js';
import { openProductPicker } from './product-picker.js';
import { paymentsHTML, wirePayments } from './payments.js';
import { openModal, toast, toastError, confirmDialog, withLoading } from './kit.js';
import { icon } from './icons.js';
import {
  esc, money, parseMoney, moneyInputValue, maskPhone, maskCEP, onlyDigits, todayISO, isMobile,
} from '../core/utils.js';

/** Atributos comuns dos campos de dinheiro: teclado só de números no celular. */
const MONEY_ATTRS = 'inputmode="numeric" autocomplete="off" placeholder="0,00"';

/** Soma os totais do jeito que o banco calcula - a tela nunca mente. */
export function computeTotals(order) {
  const subtotal = (order.items || []).reduce((acc, it) => acc + (Number(it.unitPrice) || 0) * (Number(it.qty) || 1), 0);
  const costTotal = (order.items || []).reduce((acc, it) => acc + (Number(it.unitCost) || 0) * (Number(it.qty) || 1), 0);
  const discount = Number(order.discount) || 0;
  const shipping = Number(order.shippingCost) || 0;
  const shipExp = Number(order.shippingExpense) || 0;
  const total = subtotal - discount + shipping;
  // Recebido é sempre a soma dos lançamentos - igualzinho ao que o banco faz.
  const paid = (order.payments || []).reduce((a, p) => a + (Number(p.amount) || 0), 0);
  return {
    subtotal,
    costTotal,
    discount,
    shipping,
    total,
    paid,
    profit: subtotal - discount - costTotal - shipExp,
    balance: Math.max(Math.round((total - paid) * 100) / 100, 0),
  };
}

/**
 * @param {{order?: object, onSaved?: (o: object) => void}} opts
 */
export function openOrderForm({ order = null, onSaved } = {}) {
  const draft = order ? structuredClone(order) : newOrderDraft();
  const editing = !!draft.id;

  const modal = openModal({
    title: editing ? `Pedido #${String(draft.code).padStart(4, '0')}` : 'Novo pedido',
    subtitle: editing ? 'Alterações são salvas no fim da tela' : 'Preencha o essencial - o resto dá para completar depois',
    size: 'xl',
    body: bodyHTML(draft),
    footer: `
      <button class="btn btn-ghost" data-close>Cancelar</button>
      <button class="btn btn-primary" data-save>${editing ? 'Salvar alterações' : 'Criar pedido'}</button>`,
  });

  const panel = modal.panel;
  const $items = panel.querySelector('[data-items]');
  const $totals = panel.querySelector('[data-totals]');
  const $payments = panel.querySelector('[data-payments]');

  /* -------------------------------------------------------- pagamentos */

  function renderPayments() {
    const t = computeTotals(draft);
    $payments.innerHTML = paymentsHTML(draft, t.total);
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
          <div class="grow">
            <div class="item-title">${esc(it.productName || 'Item')}</div>
            <div class="item-meta">
              ${[it.size, it.variant, it.color, it.condition, it.origin]
                .filter(Boolean).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}
              ${it.serial ? `<span class="tag">${icon('tag')} ${esc(it.serial)}</span>` : ''}
              ${it.qty > 1 ? `<span class="tag">${esc(it.qty)}×</span>` : ''}
            </div>
          </div>
          <div class="item-numbers">
            <div class="right">
              <div class="strong mono money-sensitive">${esc(money((Number(it.unitPrice) || 0) * (Number(it.qty) || 1)))}</div>
              ${it.unitCost ? `<div class="xs dim mono money-sensitive">custo ${esc(money(it.unitCost * (it.qty || 1)))}</div>` : ''}
            </div>
            <button type="button" class="icon-btn sm" data-edit-item="${i}" aria-label="Editar valor">${icon('edit')}</button>
            <button type="button" class="icon-btn sm" data-del-item="${i}" aria-label="Remover item">${icon('trash')}</button>
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
        <span class="num money-sensitive">${esc(money(t.total))}</span></div>
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
    if (e.target.closest('[data-pick]')) {
      openProductPicker({
        defaultCategory: draft.items.at(-1)?.categoryId || 'iphone',
        onAdd: (items) => {
          draft.items.push(...items);
          renderItems();
          toast(`${items.length} ${items.length === 1 ? 'item adicionado' : 'itens adicionados'}`);
        },
      });
      return;
    }

    const del = e.target.closest('[data-del-item]');
    if (del) {
      draft.items.splice(Number(del.dataset.delItem), 1);
      renderItems();
      return;
    }

    const edit = e.target.closest('[data-edit-item]');
    if (edit) editItemValues(Number(edit.dataset.editItem));
  });

  function editItemValues(index) {
    const it = draft.items[index];
    if (!it) return;
    const sub = openModal({
      title: it.productName || 'Item',
      subtitle: [it.variant, it.color].filter(Boolean).join(' · '),
      body: `
        <div class="form-grid">
          <div class="field span-4"><label class="label" for="e-qty">Quantidade</label>
            <input class="input" id="e-qty" type="number" min="1" max="999" value="${esc(it.qty)}"></div>
          <div class="field span-4"><label class="label" for="e-price">Valor unitário</label>
            <div class="money-input"><input class="input" id="e-price" ${MONEY_ATTRS}
              value="${esc(moneyInputValue(it.unitPrice))}"></div></div>
          <div class="field span-4"><label class="label" for="e-cost">Custo unitário</label>
            <div class="money-input"><input class="input" id="e-cost" ${MONEY_ATTRS}
              value="${esc(moneyInputValue(it.unitCost))}"></div></div>
          <div class="field span-6"><label class="label" for="e-serial">IMEI / série</label>
            <input class="input" id="e-serial" maxlength="40" value="${esc(it.serial)}"></div>
          <div class="field span-6"><label class="label" for="e-warranty">Garantia (dias)</label>
            <input class="input" id="e-warranty" type="number" min="0" max="3650" value="${esc(it.warrantyDays)}"></div>
          <div class="field span-12"><label class="label" for="e-note">Observação do item</label>
            <input class="input" id="e-note" maxlength="240" value="${esc(it.note)}" placeholder="ex.: bateria 92%, com nota"></div>
        </div>`,
      footer: `<button class="btn" data-close>Cancelar</button>
               <button class="btn btn-primary" data-ok>Aplicar</button>`,
    });
    sub.foot.querySelector('[data-ok]').addEventListener('click', () => {
      const g = (id) => sub.panel.querySelector(`#${id}`).value;
      it.qty = Math.min(Math.max(Number(g('e-qty')) || 1, 1), 999);
      it.unitPrice = parseMoney(g('e-price'));
      it.unitCost = parseMoney(g('e-cost'));
      it.serial = g('e-serial');
      it.warrantyDays = Number(g('e-warranty')) || 0;
      it.note = g('e-note');
      sub.close();
      renderItems();
    });
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
    const found = Store.customers().find(
      (c) => c.name.toLowerCase() === String(name).trim().toLowerCase(),
    );
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

  modal.foot.querySelector('[data-save]').addEventListener('click', async (e) => {
    if (!String(draft.customerName).trim()) {
      toast('Informe o nome do cliente.', { kind: 'warn' });
      panel.querySelector('[data-field="customerName"]')?.focus();
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

    await withLoading(e.currentTarget, async () => {
      try {
        const saved = await Store.save(draft);
        toast(editing ? 'Pedido atualizado' : `Pedido #${String(saved.code).padStart(4, '0')} criado`);
        modal.close();
        onSaved?.(saved);
      } catch (err) {
        console.error(err);
        toastError('Não foi possível salvar', err.message || 'Tente novamente.');
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
  const names = [...new Set(Store.all().map((o) => o.customerName).filter(Boolean))].slice(0, 300);

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
    </section>

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
