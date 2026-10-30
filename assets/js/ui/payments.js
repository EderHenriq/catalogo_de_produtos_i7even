/**
 * Pagamentos de um pedido: sinal, parcelas, complementos.
 *
 * A loja recebe em pedaços - um sinal no PIX, o resto em duas vezes, às vezes
 * um complemento em dinheiro na entrega. Guardar só "quanto já recebi" perde a
 * informação de quando e por onde entrou. Aqui cada entrada é um lançamento.
 *
 * O total recebido NUNCA é digitado: é sempre a soma desta lista, calculada
 * pelo banco no momento de gravar.
 *
 * Aparelho na troca: o cliente dá o aparelho dele como (parte do) pagamento.
 * O lançamento leva o aparelho (modelo, cor, IMEI, bateria) e, ao gravar,
 * o banco põe o aparelho no estoque com o valor da troca de custo.
 */

import { newPaymentDraft } from '../core/store.js';
import * as Data from '../core/data.js';
import { PAYMENT_METHODS, TRADE_METHOD, CONDITIONS } from '../core/constants.js';
import { openModal, confirmDialog } from './kit.js';
import { pref, setPref } from './common.js';
import { icon } from './icons.js';
import { esc, money, parseMoney, moneyInputValue, formatDate, todayISO } from '../core/utils.js';

/** "iPhone 13 · 128GB · Azul · Seminovo · IMEI 3599… · bateria 84%" */
export function tradeText(t) {
  if (!t) return '';
  return [t.productName, t.storage, t.color, t.condition, t.serial ? `IMEI ${t.serial}` : '',
    t.battery != null && t.battery !== '' ? `bateria ${t.battery}%` : '', t.notes].filter(Boolean).join(' · ');
}

/** Formas de receber dinheiro (as outras descrevem o combinado, não a entrada). */
const RECEIVE_METHODS = PAYMENT_METHODS.filter((m) => m !== TRADE_METHOD && m !== 'Parcelado na loja' && m !== 'Entrada + saldo');

/** Soma dos lançamentos. */
export function totalPago(order) {
  return (order.payments || []).reduce((a, p) => a + (Number(p.amount) || 0), 0);
}

/** Quanto ainda falta receber (nunca negativo). */
export function saldoAberto(order, total) {
  return Math.max(Math.round((total - totalPago(order)) * 100) / 100, 0);
}

/** Quanto passou do total - troco a devolver, ou erro de lançamento. */
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
              ${p.method ? `<span class="tag${p.trade ? ' tone-indigo' : ''}">${p.trade ? `${icon('device')} ` : ''}${esc(p.method)}</span>` : ''}
              ${p.trade ? `<span class="pay-note">${esc(tradeText(p.trade))}${p.tradeUnitId || p.trade.toStock ? ' · <span class="tone-green">no estoque</span>' : ''}</span>`
                : p.note ? `<span class="pay-note">${esc(p.note)}</span>` : ''}
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

      ${editavel && saldo > 0 ? `
        <div class="pay-quick">
          <span class="xs dim">Recebeu tudo agora (${esc(money(saldo))})?</span>
          <div class="chips">
            ${['PIX', 'Dinheiro', 'Cartão de crédito', 'Cartão de débito'].map((m) => `<button type="button" class="chip sm" data-quick-pay="${esc(m)}">${esc(m.replace('Cartão de ', 'Cartão '))}</button>`).join('')}
            <button type="button" class="chip sm" data-quick-pay="${esc(TRADE_METHOD)}">${icon('device')} Aparelho na troca</button>
          </div>
        </div>` : ''}
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
export function openPaymentDialog({ payment = null, saldo = 0, metodoPadrao = '', troca = false, onConfirm }) {
  const editando = !!payment;
  // "Como recebeu" já vem com uma forma de receber de verdade: a combinada do
  // pedido, ou a última usada quando a combinada é "Parcelado na loja",
  // "Entrada + saldo" ou não foi informada (o relatório deixa de ter "-").
  const metodo = RECEIVE_METHODS.includes(metodoPadrao) ? metodoPadrao : pref('pay.method', 'PIX');
  const p = payment
    ? { ...payment }
    : newPaymentDraft({ amount: saldo > 0 ? saldo : 0, method: metodo, date: todayISO() });
  const isTrade = () => (editando ? !!p.trade : modal.panel.querySelector('#pay-method').value === TRADE_METHOD);
  // aparelhos do cadastro (iPhone e o que tem IMEI primeiro) para escolher o modelo da troca
  const models = Data.products().filter((x) => x.active !== false)
    .sort((x, y) => Number(y.tracksSerial) - Number(x.tracksSerial) || (y.year || 0) - (x.year || 0) || x.name.localeCompare(y.name, 'pt-BR', { numeric: true }));

  const modal = openModal({
    title: editando ? (p.trade ? 'Aparelho na troca' : 'Editar pagamento') : 'Registrar pagamento',
    subtitle: !editando && saldo > 0 ? `Falta receber ${money(saldo)}` : '',
    body: `
      <div class="form-grid">
        ${editando && p.trade ? `
          <div class="span-12 alert" data-kind="info">${icon('device')}<div><b>${esc(tradeText(p.trade))}</b>
            <div class="xs dim" style="margin-top:2px">O valor da troca virou o custo do aparelho no estoque: para mudar, exclua este pagamento e lance a troca de novo.</div></div></div>` : `
          <div class="field span-12">
            <label class="label" for="pay-method">Como recebeu</label>
            <select class="select" id="pay-method">
              <option value="">-</option>
              ${PAYMENT_METHODS.map((m) => `<option ${m === p.method ? 'selected' : ''}>${esc(m)}</option>`).join('')}
            </select>
          </div>`}
      </div>
      ${editando ? '' : `
      <div class="trade-box" data-trade hidden>
        <div class="form-grid">
          <div class="field span-12"><label class="label" for="tr-model">Aparelho que o cliente deu</label>
            <input class="input" id="tr-model" list="tr-models" maxlength="120" placeholder="ex.: iPhone 13" autocomplete="off">
            <datalist id="tr-models">${models.map((m) => `<option value="${esc(m.name)}">`).join('')}</datalist></div>
          <div class="field span-6 span-half-mobile"><label class="label" for="tr-storage">Capacidade</label>
            <input class="input" id="tr-storage" list="tr-storages" maxlength="40" placeholder="128GB" autocomplete="off"><datalist id="tr-storages"></datalist></div>
          <div class="field span-6 span-half-mobile"><label class="label" for="tr-color">Cor</label>
            <input class="input" id="tr-color" list="tr-colors" maxlength="40" placeholder="Preto" autocomplete="off"><datalist id="tr-colors"></datalist></div>
          <div class="field span-6 span-half-mobile"><label class="label" for="tr-cond">Condição</label>
            <select class="select" id="tr-cond">${CONDITIONS.map((c) => `<option ${c === 'Seminovo' ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
          <div class="field span-6 span-half-mobile"><label class="label" for="tr-bat">Bateria % <span class="dim">(opcional)</span></label>
            <input class="input" id="tr-bat" type="number" inputmode="numeric" min="0" max="100" placeholder="85"></div>
          <div class="field span-12"><label class="label" for="tr-serial">IMEI <span class="dim">(opcional)</span></label>
            <input class="input mono" id="tr-serial" maxlength="40" inputmode="numeric" autocomplete="off"></div>
          <div class="field span-12"><label class="label" for="tr-notes">Estado <span class="dim">(opcional)</span></label>
            <input class="input" id="tr-notes" maxlength="300" placeholder="ex.: tela trincada, sem caixa, Face ID ok"></div>
          <label class="check span-12"><input type="checkbox" id="tr-stock" checked><span class="box"></span>
            <span>Entra no estoque como seminovo <span class="xs dim block">o custo dele é o valor da troca - aparece no Estoque para vender</span></span></label>
        </div>
      </div>`}
      <div class="form-grid">
        <div class="field span-6">
          <label class="label" for="pay-amount" data-amount-label>${p.trade ? 'Valor dado no aparelho' : 'Valor recebido'}</label>
          <div class="money-input">
            <input class="input" id="pay-amount" inputmode="numeric" autocomplete="off" ${editando ? '' : 'data-autofocus'} ${editando && p.trade ? 'disabled' : ''}
                   value="${esc(moneyInputValue(p.amount))}" placeholder="0,00">
          </div>
        </div>
        <div class="field span-6">
          <label class="label" for="pay-date">Quando entrou</label>
          <input class="input" id="pay-date" type="date" value="${esc(p.date)}">
        </div>
      </div>


      <div class="field" data-note-field ${p.trade ? 'hidden' : ''}>
        <label class="label" for="pay-note">Observação <span class="dim">(opcional)</span></label>
        <input class="input" id="pay-note" maxlength="160" value="${esc(p.trade ? '' : p.note)}"
               placeholder="ex.: sinal, 1ª parcela, pago pela mãe">
      </div>

      ${!editando && saldo > 0 ? `
        <div class="chips" data-atalhos>
          <button type="button" class="chip sm" data-atalho="${saldo}">Tudo · ${esc(money(saldo))}</button>
          <button type="button" class="chip sm" data-atalho="${Math.round(saldo / 2 * 100) / 100}">Metade</button>
          <button type="button" class="chip sm" data-atalho="${Math.round(saldo / 3 * 100) / 100}">Um terço</button>
        </div>` : ''}
      <p class="small" data-troco hidden></p>

      <div class="alert hide" data-erro data-kind="warn">${icon('alert')}<div data-erro-txt></div></div>`,
    footer: `
      <button class="btn btn-ghost" data-close>Cancelar</button>
      <button class="btn btn-primary" data-ok>${editando ? 'Salvar' : 'Registrar'}</button>`,
  });

  const $ = (sel) => modal.panel.querySelector(sel);
  const erro = $('[data-erro]');
  const erroTxt = $('[data-erro-txt]');
  const fail = (msg, el) => { erroTxt.textContent = msg; erro.classList.remove('hide'); el?.focus(); };

  /** Troca: muda os campos (aparelho no lugar da observação) e avisa o troco. */
  function syncMode() {
    if (editando) return;
    const trade = isTrade();
    $('[data-trade]').hidden = !trade;
    $('[data-note-field]').hidden = trade;
    $('[data-amount-label]').textContent = trade ? 'Valor dado no aparelho' : 'Valor recebido';
    const atalhos = $('[data-atalhos]');
    if (atalhos) atalhos.hidden = trade;
    syncTroco();
  }
  function syncTroco() {
    const el = $('[data-troco]');
    const v = parseMoney($('#pay-amount').value);
    const over = Math.round((v - saldo) * 100) / 100;
    el.hidden = !(isTrade() && saldo > 0 && over > 0);
    if (!el.hidden) el.innerHTML = `${icon('wallet')} A troca vale mais que o que falta: <b>devolva ${esc(money(over))}</b> ao cliente (fica como "recebido a mais").`;
  }
  /** Modelo escolhido: capacidades e cores dele aparecem para escolher. */
  function syncModel() {
    const name = String($('#tr-model').value || '').trim().toLowerCase();
    const prod = models.find((m) => m.name.toLowerCase() === name);
    $('#tr-storages').innerHTML = (prod?.storages || []).map((x) => `<option value="${esc(x)}">`).join('');
    $('#tr-colors').innerHTML = (prod?.colors || []).filter((c) => !/^outra cor$/i.test(c)).map((x) => `<option value="${esc(x)}">`).join('');
    return prod || null;
  }

  modal.body.addEventListener('click', (e) => {
    const atalho = e.target.closest('[data-atalho]');
    if (!atalho) return;
    $('#pay-amount').value = moneyInputValue(atalho.dataset.atalho);
    $('#pay-amount').focus();
  });
  modal.body.addEventListener('change', (e) => {
    if (e.target.id === 'pay-method') {
      syncMode();
      if (isTrade()) { $('#pay-amount').value = ''; $('#tr-model').focus(); }
    }
    if (e.target.id === 'tr-model') syncModel();
  });
  modal.body.addEventListener('input', (e) => {
    if (e.target.id === 'pay-amount') syncTroco();
  });

  modal.foot.querySelector('[data-ok]').addEventListener('click', () => {
    if (editando && p.trade) {
      // troca já gravada: só a data muda
      onConfirm({ ...p, date: $('#pay-date').value || todayISO() });
      modal.close();
      return;
    }
    const valor = parseMoney($('#pay-amount').value);
    if (isTrade()) {
      const prod = syncModel();
      const nome = String($('#tr-model').value || '').trim();
      if (!nome) { fail('Qual aparelho o cliente deu? Escolha o modelo.', $('#tr-model')); return; }
      if (!(valor > 0)) { fail('Quanto vale o aparelho na troca?', $('#pay-amount')); return; }
      const bat = String($('#tr-bat').value || '').trim();
      if (bat && !(Number(bat) >= 0 && Number(bat) <= 100)) { fail('Bateria entre 0 e 100%.', $('#tr-bat')); return; }
      const trade = {
        productId: prod?.id || null, productName: prod?.name || nome,
        storage: $('#tr-storage').value.trim(), color: $('#tr-color').value.trim(), condition: $('#tr-cond').value,
        serial: $('#tr-serial').value.trim(), battery: bat === '' ? null : Number(bat), notes: $('#tr-notes').value.trim(),
        toStock: $('#tr-stock').checked && !!prod,
      };
      onConfirm({ ...p, amount: valor, date: $('#pay-date').value || todayISO(), method: TRADE_METHOD, note: tradeText(trade).slice(0, 160), trade });
      modal.close();
      return;
    }
    if (!(valor > 0)) { fail('Informe um valor maior que zero.', $('#pay-amount')); return; }
    if (!editando && RECEIVE_METHODS.includes($('#pay-method').value)) setPref('pay.method', $('#pay-method').value);
    onConfirm({
      ...p,
      amount: valor,
      date: $('#pay-date').value || todayISO(),
      method: $('#pay-method').value,
      note: $('#pay-note').value,
    });
    modal.close();
  });

  if (troca && !editando) { $('#pay-method').value = TRADE_METHOD; syncMode(); $('#pay-amount').value = ''; $('#tr-model').focus(); } else syncMode();
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

    // atalho: recebeu o que falta de uma vez (sem abrir o diálogo); troca abre o do aparelho
    const quick = e.target.closest('[data-quick-pay]');
    if (quick && estado.saldo > 0) {
      if (quick.dataset.quickPay === TRADE_METHOD) {
        openPaymentDialog({ saldo: estado.saldo, troca: true, onConfirm: (novo) => onChange([...lista, novo]) });
        return;
      }
      onChange([...lista, newPaymentDraft({ amount: estado.saldo, method: quick.dataset.quickPay, date: todayISO() })]);
      return;
    }

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
