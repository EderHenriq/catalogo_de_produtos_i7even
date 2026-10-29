/**
 * Trocar a situação do pedido respeitando o fiado:
 *   "Pago" e "Finalizado" só com o valor todo recebido. Faltando dinheiro,
 *   a tela pergunta: registrar o pagamento agora, ou (para "Finalizado")
 *   entregar no fiado - o cliente leva e o pedido fica "Aguardando
 *   pagamento" até quitar, quando finaliza sozinho.
 * O banco aplica a mesma regra (orders_compute_totals); aqui é para a
 * pessoa entender o que vai acontecer antes.
 */

import * as Data from '../core/data.js';
import { STATUS_MAP } from '../core/constants.js';
import { friendlyError } from '../core/errors.js';
import { money } from '../core/utils.js';
import { openModal, toast, toastError } from './kit.js';
import { icon } from './icons.js';
import { openPaymentDialog } from './payments.js';
import { openPlanDialog } from './plan-editor.js';

const label = (s) => STATUS_MAP[s]?.label || s;

/** Falta receber algo? */
export const missing = (o) => (o && o.total > 0 ? Math.max(Math.round((o.total - o.paidAmount) * 100) / 100, 0) : 0);

/**
 * @returns {Promise<boolean>} true se alguma coisa mudou.
 */
export async function changeStatus(orderId, next) {
  const o = Data.order(orderId);
  if (!o || o.status === next) return false;
  const falta = missing(o);
  if (!['pago', 'entregue'].includes(next) || falta <= 0) {
    try {
      await Data.setOrderStatus(orderId, next);
      toast(`#${String(o.code).padStart(4, '0')} → ${label(next)}`);
      return true;
    } catch (err) {
      toastError('Não foi possível mudar o status', friendlyError(err));
      return false;
    }
  }
  // Já está aguardando e quer "Pago": a única saída é receber.
  const choice = next !== 'entregue' && o.status === 'aguardando' ? 'pagar' : await ask(o, next, falta);
  if (!choice) return false;
  try {
    if (choice === 'pagar') {
      const p = await new Promise((resolve) => {
        const m = openPaymentDialog({ saldo: falta, metodoPadrao: o.paymentMethod, onConfirm: resolve });
        const prev = m?.el;
        prev?.addEventListener('close', () => setTimeout(() => resolve(null), 0), { once: true });
      });
      if (!p) return false;
      await Data.savePayment(orderId, p);
      const after = Data.order(orderId);
      if (missing(after) > 0) {
        toast('Pagamento registrado', { text: `Ainda falta ${money(missing(after))} - o pedido segue aguardando pagamento.` });
        if (after.status !== 'aguardando' && next === 'pago') await Data.setOrderStatus(orderId, 'aguardando');
        return true;
      }
      if (after.status !== next) await Data.setOrderStatus(orderId, next);
      toast(`Quitado · #${String(o.code).padStart(4, '0')} → ${label(next)}`);
      return true;
    }
    if (choice === 'fiado') {
      await Data.setOrderStatus(orderId, 'entregue');   // o banco deixa em "Aguardando pagamento"
      toast('Entregue no fiado', { text: `Aguardando ${money(falta)}. Finaliza sozinho quando quitar.` });
      if (!Data.order(orderId)?.plan?.length) openPlanDialog(orderId, { title: 'Quando o cliente vai pagar?' });
      return true;
    }
    if (choice === 'aguardando') {
      await Data.setOrderStatus(orderId, 'aguardando');
      toast(`#${String(o.code).padStart(4, '0')} → Aguardando pagamento`);
      return true;
    }
  } catch (err) {
    toastError('Não foi possível mudar o status', friendlyError(err));
  }
  return false;
}

function ask(o, next, falta) {
  return new Promise((resolve) => {
    let answered = false;
    const m = openModal({
      title: `Falta receber ${money(falta)}`,
      subtitle: `#${String(o.code).padStart(4, '0')} · ${o.customerName} · recebido ${money(o.paidAmount)} de ${money(o.total)}`,
      body: `
        <p class="muted" style="margin:0 0 14px">${next === 'entregue'
          ? 'O pedido só fica <b>Finalizado</b> com tudo pago. O cliente vai levar agora e pagar depois?'
          : 'O pedido só fica <b>Pago</b> com o valor todo recebido.'}</p>
        <div class="choice-list">
          <button type="button" class="choice" data-c="pagar">${icon('cash')}<span><b>Registrar pagamento agora</b><small>Recebeu o que falta (ou parte)</small></span></button>
          ${next === 'entregue' ? `<button type="button" class="choice" data-c="fiado">${icon('wallet')}<span><b>Entregar no fiado</b><small>Fica "Aguardando pagamento" e finaliza sozinho quando quitar</small></span></button>` : ''}
          ${o.status !== 'aguardando' ? `<button type="button" class="choice" data-c="aguardando">${icon('clock')}<span><b>Deixar aguardando pagamento</b><small>O cliente ainda não levou</small></span></button>` : ''}
        </div>`,
      footer: '<button class="btn btn-ghost" data-close>Voltar</button>',
      onClose: () => { if (!answered) resolve(null); },
    });
    m.body.addEventListener('click', (e) => {
      const c = e.target.closest('[data-c]');
      if (!c) return;
      answered = true;
      m.close();
      resolve(c.dataset.c);
    });
  });
}

/** Rótulo do botão "avançar" na lista: aguardando com saldo vira "Receber". */
export function advanceLabel(o, next) {
  if (['pago', 'entregue'].includes(next) && missing(o) > 0) return { text: 'Receber', icon: 'cash' };
  return { text: label(next), icon: 'arrowRight' };
}

