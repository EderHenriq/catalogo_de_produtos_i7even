/**
 * Pagamentos de um pedido: sinal, parcelas, complementos.
 *
 * A loja recebe em pedaços — um sinal no PIX, o resto em duas vezes, às vezes
 * um complemento em dinheiro na entrega. Guardar só "quanto já recebi" perde a
 * informação de quando e por onde entrou. Aqui cada entrada é um lançamento.
 *
 * O total recebido NUNCA é digitado: é sempre a soma desta lista, calculada
 * pelo banco no momento de gravar.
 */

import { newPaymentDraft } from '../core/store.js';
import { PAYMENT_METHODS } from '../core/constants.js';
import { openModal, confirmDialog } from './kit.js';
import { icon } from './icons.js';
import { esc, money, parseMoney, formatDate, todayISO } from '../core/utils.js';

/** Soma dos lançamentos. */
export function totalPago(order) {
  return (order.payments || []).reduce((a, p) => a + (Number(p.amount) || 0), 0);
}

/** Quanto ainda falta receber (nunca negativo). */
export function saldoAberto(order, total) {
  return Math.max(Math.round((total - totalPago(order)) * 100) / 100, 0);
}

/** Quanto passou do total — troco a devolver, ou erro de lançamento. */
export function excedente(order, total) {
  return Math.max(Math.round((totalPago(order) - total) * 100) / 100, 0);
}

/* ------------------------------------------------------------- listagem -- */

/**
 * Bloco de pagamentos: lista, saldo e botão de registrar.
 * @param {object} order
 * @param {number} total valor total do pedido
 * @param {{editavel?: boolean}} [opts]
 */
export function paymentsHTML(order, total, { editavel = true } = {}) {
  const lista = [...(order.payments || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const pago = totalPago(order);
  const saldo = saldoAberto(order, total);
  const sobra = excedente(order, total);

  const linhas = lista.length
    ? lista.map((p, i) => `
        <div class="pay-row" data-pay="${esc(p.id)}">
          <span class="pay-index">${i + 1}</span>
          <div class="grow">
            <div class="pay-top">
              <span class="pay-amount money-sensitive">${esc(money(p.amount))}</span>
              <span class="pay-date">${esc(formatDate(p.date))}</span>
            </div>
            <div class="pay-meta">
              ${p.method ? `<span class="tag">${esc(p.method)}</span>` : ''}
              ${p.note ? `<span class="pay-note">${esc(p.note)}</span>` : ''}
            </div>
          </div>
          ${editavel ? `
            <div class="row gap-1">
              <button type="button" class="icon-btn sm" data-edit-pay="${esc(p.id)}"
                      aria-label="Editar pagamento">${icon('edit')}</button>
              <button type="button" class="icon-btn sm" data-del-pay="${esc(p.id)}"
                      aria-label="Remover pagamento">${icon('trash')}</button>
            </div>` : ''}
        </div>`).join('')
    : `<p class="small dim" style="padding:2px 0">Nenhum pagamento lançado ainda.</p>`;

  return `
    <div class="pay-block">
      ${linhas}

      <div class="pay-summary">
        <div class="totals-row">
          <span class="muted">Já recebido${lista.length ? ` (${lista.length}×)` : ''}</span>
          <span class="num money-sensitive">${esc(money(pago))}</span>
        </div>
        <div class="totals-row ${saldo > 0 ? 'pay-open' : ''}">
          <span class="${saldo > 0 ? 'strong' : 'muted'}">${saldo > 0 ? 'Falta receber' : 'Quitado'}</span>
          <span class="num money-sensitive ${saldo > 0 ? 'strong' : 'pos'}">${esc(money(saldo))}</span>
        </div>
        ${sobra > 0 ? `
          <div class="totals-row">
            <span class="muted small">Recebido a mais</span>
            <span class="num small neg money-sensitive">${esc(money(sobra))}</span>
          </div>` : ''}
      </div>

      ${editavel ? `
        <button type="button" class="btn btn-outline btn-block" data-add-pay>
          ${icon('plus')} Registrar pagamento
        </button>` : ''}
    </div>`;
}

/* ------------------------------------------------- formulário de um item -- */

/**
 * Abre o diálogo de um lançamento. Já vem preenchido com o saldo em aberto,
 * porque o caso mais comum é quitar o que falta de uma vez.
 *
 * @param {{payment?: object, saldo: number, metodoPadrao?: string,
 *          onConfirm: (p: object) => void}} spec
 */
export function openPaymentDialog({ payment = null, saldo = 0, metodoPadrao = '', onConfirm }) {
  const editando = !!payment;
  const p = payment
    ? { ...payment }
    : newPaymentDraft({ amount: saldo > 0 ? saldo : 0, method: metodoPadrao, date: todayISO() });

  const modal = openModal({
    title: editando ? 'Editar pagamento' : 'Registrar pagamento',
    subtitle: !editando && saldo > 0 ? `Falta receber ${money(saldo)}` : '',
    body: `
      <div class="form-grid">
        <div class="field span-6">
          <label class="label" for="pay-amount">Valor recebido</label>
          <div class="money-input">
            <input class="input" id="pay-amount" inputmode="decimal" data-autofocus
                   value="${p.amount ? esc(String(p.amount.toFixed(2)).replace('.', ',')) : ''}"
                   placeholder="0,00">
          </div>
        </div>
        <div class="field span-6">
          <label class="label" for="pay-date">Quando entrou</label>
          <input class="input" id="pay-date" type="date" value="${esc(p.date)}">
        </div>
        <div class="field span-12">
          <label class="label" for="pay-method">Como recebeu</label>
          <select class="select" id="pay-method">
            <option value="">—</option>
            ${PAYMENT_METHODS.map((m) => `<option ${m === p.method ? 'selected' : ''}>${esc(m)}</option>`).join('')}
          </select>
        </div>
        <div class="field span-12">
          <label class="label" for="pay-note">Observação <span class="dim">(opcional)</span></label>
          <input class="input" id="pay-note" maxlength="160" value="${esc(p.note)}"
                 placeholder="ex.: sinal, 1ª parcela, pago pela mãe">
        </div>
      </div>

      ${!editando && saldo > 0 ? `
        <div class="chips">
          <button type="button" class="chip sm" data-atalho="${saldo}">Tudo · ${esc(money(saldo))}</button>
          <button type="button" class="chip sm" data-atalho="${Math.round(saldo / 2 * 100) / 100}">Metade</button>
          <button type="button" class="chip sm" data-atalho="${Math.round(saldo / 3 * 100) / 100}">Um terço</button>
        </div>` : ''}

      <div class="alert hide" data-erro data-kind="warn">${icon('alert')}<div data-erro-txt></div></div>`,
    footer: `
      <button class="btn btn-ghost" data-close>Cancelar</button>
      <button class="btn btn-primary" data-ok>${editando ? 'Salvar' : 'Registrar'}</button>`,
  });

  const $ = (sel) => modal.panel.querySelector(sel);
  const erro = $('[data-erro]');
  const erroTxt = $('[data-erro-txt]');

  modal.body.addEventListener('click', (e) => {
    const atalho = e.target.closest('[data-atalho]');
    if (!atalho) return;
    $('#pay-amount').value = Number(atalho.dataset.atalho).toFixed(2).replace('.', ',');
    $('#pay-amount').focus();
  });

  modal.foot.querySelector('[data-ok]').addEventListener('click', () => {
    const valor = parseMoney($('#pay-amount').value);
    if (!(valor > 0)) {
      erroTxt.textContent = 'Informe um valor maior que zero.';
      erro.classList.remove('hide');
      $('#pay-amount').focus();
      return;
    }
    onConfirm({
      ...p,
      amount: valor,
      date: $('#pay-date').value || todayISO(),
      method: $('#pay-method').value,
      note: $('#pay-note').value,
    });
    modal.close();
  });

  return modal;
}

/* ------------------------------------------- ligar os botões a uma lista -- */

/**
 * Liga adicionar / editar / remover num contêiner que contenha o
 * `paymentsHTML`. Chama `onChange` com a nova lista a cada alteração.
 *
 * @param {HTMLElement} host
 * @param {() => {payments: object[], saldo: number, metodoPadrao: string}} lerEstado
 * @param {(payments: object[]) => void} onChange
 */
export function wirePayments(host, lerEstado, onChange) {
  host.addEventListener('click', async (e) => {
    const estado = lerEstado();
    const lista = [...(estado.payments || [])];

    if (e.target.closest('[data-add-pay]')) {
      openPaymentDialog({
        saldo: estado.saldo,
        metodoPadrao: estado.metodoPadrao,
        onConfirm: (novo) => onChange([...lista, novo]),
      });
      return;
    }

    const editar = e.target.closest('[data-edit-pay]');
    if (editar) {
      const alvo = lista.find((p) => p.id === editar.dataset.editPay);
      if (!alvo) return;
      openPaymentDialog({
        payment: alvo,
        saldo: estado.saldo,
        onConfirm: (novo) => onChange(lista.map((p) => (p.id === novo.id ? novo : p))),
      });
      return;
    }

    const remover = e.target.closest('[data-del-pay]');
    if (remover) {
      const alvo = lista.find((p) => p.id === remover.dataset.delPay);
      if (!alvo) return;
      const ok = await confirmDialog({
        title: 'Remover este pagamento?',
        message: `${money(alvo.amount)} de ${formatDate(alvo.date)} será apagado do histórico.`,
        confirmText: 'Remover',
        danger: true,
      });
      if (ok) onChange(lista.filter((p) => p.id !== alvo.id));
    }
  });
}
