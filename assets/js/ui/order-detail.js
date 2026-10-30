/** Ficha completa do pedido, com troca de status em um toque. */

import * as Store from '../core/store.js';
import * as Data from '../core/data.js';
import { friendlyError } from '../core/errors.js';
import { fromOrder } from '../docs/order-doc.js';
import { preloadPdf } from '../docs/pdf.js';
import { openPdfDialog, openWhatsappDialog } from './doc-preview.js';
import { STATUSES, STATUS_MAP, PAYMENT_STATUSES } from '../core/constants.js';
import { openModal, toast, toastError, confirmDialog, withLoading } from './kit.js';
import { openOrderForm, computeTotals } from './order-form.js';
import { paymentsHTML, wirePayments, openPaymentDialog } from './payments.js';
import { openPlanDialog, instLabel, instName, INST_TONE } from './plan-editor.js';
import { changeStatus } from './status-flow.js';
import { remind, remindedText } from './reminders.js';
import { icon } from './icons.js';
import {
  esc, money, formatDate, formatDateTime, maskPhone, whatsappLink, relativeDate,
} from '../core/utils.js';

const PIPELINE = STATUSES.filter((s) => s.key !== 'cancelado');

export function openOrderDetail(orderId, { onChanged } = {}) {
  let order = Store.byId(orderId);
  if (!order) { toastError('Pedido não encontrado.'); return null; }

  const modal = openModal({
    title: `Pedido #${String(order.code).padStart(4, '0')}`,
    subtitle: `${order.customerName} · criado ${relativeDate(order.createdAt)}`,
    size: 'lg',
    body: '<div class="col gap-5" data-detail></div>',
    footer: `
      <button class="btn btn-ghost" data-delete>${icon('trash')} Excluir</button>
      <span class="grow"></span>
      <button class="btn" data-wa-summary title="Mandar resumo no WhatsApp">${icon('whatsapp')}<span class="hide-mobile">WhatsApp</span></button>
      <button class="btn" data-pdf title="Pedido em PDF">${icon('receipt')}<span class="hide-mobile">PDF</span></button>
      <button class="btn" data-print>${icon('print')}<span class="hide-mobile">Imprimir</span></button>
      <button class="btn btn-primary" data-edit>${icon('edit')} Editar</button>`,
  });

  const host = modal.panel.querySelector('[data-detail]');

  function render() {
    order = Store.byId(orderId) || order;
    const t = computeTotals(order);
    const st = STATUS_MAP[order.status];
    const pay = PAYMENT_STATUSES.find((p) => p.key === order.paymentStatus);
    const currentIdx = PIPELINE.findIndex((s) => s.key === order.status);
    const wa = whatsappLink(
      order.customerPhone,
      `Olá ${order.customerName.split(' ')[0]}! Sobre seu pedido #${String(order.code).padStart(4, '0')}: `,
    );
    const address = [
      [order.shipStreet, order.shipNumber].filter(Boolean).join(', '),
      order.shipComplement,
      order.shipDistrict,
      [order.shipCity, order.shipUf].filter(Boolean).join(' - '),
      order.shipCep,
    ].filter(Boolean).join(' · ');

    host.innerHTML = `
      <div class="row wrap gap-2">
        <span class="badge" data-tone="${esc(st?.tone || 'gray')}">${esc(st?.label || order.status)}</span>
        <span class="badge no-dot" data-tone="${esc(pay?.tone || 'gray')}">Pgto.: ${esc(pay?.label || '-')}</span>
        ${order.priority ? `<span class="badge" data-tone="red">Urgente</span>` : ''}
        ${order.handedOverAt && order.status === 'aguardando' ? `<span class="badge no-dot" data-tone="indigo">${icon('wallet')} Fiado · levou em ${esc(formatDate(order.handedOverAt))}</span>` : ''}
        ${order.channel ? `<span class="tag">${esc(order.channel)}</span>` : ''}
      </div>

      <div class="fieldset">
        <div class="fieldset-title">Andamento</div>
        <div class="steps">
          ${PIPELINE.map((s, i) => `
            <button class="step ${i < currentIdx ? 'done' : ''} ${s.key === order.status ? 'current' : ''}"
                    data-status="${esc(s.key)}">${esc(s.label)}</button>`).join('')}
          <button class="step step-cancel ${order.status === 'cancelado' ? 'current' : ''}"
                  data-status="cancelado">Cancelar pedido</button>
        </div>
      </div>

      <div class="fieldset">
        <div class="fieldset-title">Itens (${order.items.length})</div>
        ${order.items.length
          ? order.items.map((it) => `
            <div class="item-row">
              <div class="grow">
                <div class="item-title">${esc(it.productName)}</div>
                <div class="item-meta">
                  ${[it.size, it.variant, it.color, it.condition, it.origin]
                    .filter(Boolean).map((x) => `<span class="tag">${esc(x)}</span>`).join('')}
                  ${it.band ? `<span class="tag">${esc(it.band)}</span>` : ''}
                  ${it.serial ? `<span class="tag mono">${icon('device')} ${esc(it.serial)}</span>` : ''}
                  ${needsSerial(it) ? `<span class="tag">${icon('device')} sem IMEI anotado</span>` : ''}
                  ${it.warrantyDays ? `<span class="tag">${esc(warrantyText(it, order))}</span>` : ''}
                </div>
                ${it.note ? `<div class="xs dim" style="margin-top:5px">${esc(it.note)}</div>` : ''}
              </div>
              <div class="right">
                <div class="strong mono money-sensitive">${esc(money((it.unitPrice || 0) * (it.qty || 1)))}</div>
                ${it.qty > 1 ? `<div class="xs dim">${esc(it.qty)} × ${esc(money(it.unitPrice))}</div>` : ''}
              </div>
            </div>`).join('')
          : '<p class="small dim">Nenhum item cadastrado neste pedido.</p>'}
      </div>

      <div class="totals">
        <div class="totals-row"><span class="muted">Produtos</span>
          <span class="num money-sensitive">${esc(money(t.subtotal))}</span></div>
        ${t.discount ? `<div class="totals-row"><span class="muted">Desconto</span>
          <span class="num neg money-sensitive">- ${esc(money(t.discount))}</span></div>` : ''}
        ${t.shipping ? `<div class="totals-row"><span class="muted">Frete</span>
          <span class="num money-sensitive">${esc(money(t.shipping))}</span></div>` : ''}
        <div class="totals-row grand"><span>Total</span>
          <span class="num money-sensitive">${esc(money(t.total))}</span></div>
        ${order.costTotal ? `<div class="totals-row"><span class="muted small">Lucro</span>
          <span class="num small ${t.profit >= 0 ? 'pos' : 'neg'} money-sensitive">${esc(money(t.profit))}</span></div>` : ''}
      </div>

      <div class="fieldset">
        <div class="fieldset-title">Pagamentos</div>
        <div data-payments></div>
      </div>

      ${planHTML()}

      <div class="fieldset">
        <div class="fieldset-title">Dados</div>
        <dl class="detail-grid">
          ${detail('Cliente', order.customerName)}
          ${order.customerPhone ? detail('WhatsApp', wa
            ? `<a href="${esc(wa)}" target="_blank" rel="noopener noreferrer">${esc(maskPhone(order.customerPhone))}</a>`
            : esc(maskPhone(order.customerPhone)), true) : ''}
          ${order.customerEmail ? detail('E-mail', order.customerEmail) : ''}
          ${order.customerDoc ? detail('Documento', order.customerDoc) : ''}
          ${detail('Data do pedido', formatDate(order.orderDate))}
          ${order.dueDate ? detail('Previsão', formatDate(order.dueDate)) : ''}
          ${order.paymentMethod ? detail('Pagamento', `${order.paymentMethod}${order.installments > 1 ? ` · ${order.installments}×` : ''}`) : ''}
          ${order.shippingMethod ? detail('Envio', order.shippingMethod) : ''}
          ${order.trackingCode ? detail('Rastreio', order.trackingCode) : ''}
          ${order.handedOverAt && !order.deliveredAt ? detail('Cliente levou em', formatDateTime(order.handedOverAt)) : ''}
          ${order.deliveredAt ? detail('Finalizado em', formatDateTime(order.deliveredAt)) : ''}
        </dl>
        ${address ? `<div class="alert">${icon('pin')}<div>${esc(address)}</div></div>` : ''}
        ${order.notes ? `<div class="alert">${icon('info')}<div style="white-space:pre-wrap">${esc(order.notes)}</div></div>` : ''}
      </div>

      <p class="xs dim">
        ${order.createdByEmail ? `Lançado por ${esc(order.createdByEmail.split('@')[0])} · ` : ''}
        última alteração ${esc(formatDateTime(order.updatedAt))}
      </p>`;

    // O bloco de pagamentos vive dentro do HTML acabado de escrever.
    const alvo = host.querySelector('[data-payments]');
    if (alvo) alvo.innerHTML = paymentsHTML(order, t.total);

    // No celular o andamento é uma linha que rola de lado: centra a etapa atual.
    const steps = host.querySelector('.steps');
    const cur = steps?.querySelector('.step.current');
    if (cur && steps.scrollWidth > steps.clientWidth) {
      const a = cur.getBoundingClientRect();
      const b = steps.getBoundingClientRect();
      steps.scrollLeft += a.left - b.left - (b.width - a.width) / 2;
    }
  }

  /*
   * Aqui cada alteração vai direto para o banco: o uso real é "o cliente
   * mandou o PIX agora", e ninguém quer ter de lembrar de salvar depois.
   */
  wirePayments(
    host,
    () => {
      const atual = Store.byId(orderId) || order;
      return {
        payments: atual.payments,
        saldo: computeTotals(atual).balance,
        metodoPadrao: atual.paymentMethod,
      };
    },
    async (lista) => {
      try {
        // A diferença entre a lista antiga e a nova vai direto à tabela de pagamentos.
        const atual = Store.byId(orderId)?.payments || [];
        const novos = new Map(lista.map((x) => [x.id, x]));
        for (const old of atual) if (!novos.has(old.id)) await Data.deletePayment(orderId, old.id);
        for (const pg of lista) {
          const old = atual.find((x) => x.id === pg.id);
          // aparelho na troca: pagamento + aparelho no estoque, juntos no banco
          if (!old && pg.trade) { await Data.registerTradeIn(orderId, pg); continue; }
          if (!old || old.amount !== pg.amount || old.date !== pg.date || old.method !== pg.method || old.note !== pg.note) {
            await Data.savePayment(orderId, pg);
          }
        }
        const salvo = Store.byId(orderId);
        const falta = computeTotals(salvo).balance;
        toast(falta > 0 ? `Pagamento lançado · faltam ${money(falta)}` : 'Pedido quitado');
        render();
        onChanged?.();
      } catch (err) {
        toastError('Não foi possível lançar o pagamento', friendlyError(err));
        render();
      }
    },
  );

  /** Fiado: as parcelas com a situação de hoje, receber e cobrar. */
  function planHTML() {
    const plan = Data.orderPlan(order);
    const owes = Data.owes(order);
    if (!plan.length && !owes) return '';
    const real = !!order.plan?.length;
    return `
      <div class="fieldset">
        <div class="fieldset-title row-between">
          <span>${real ? 'Fiado / parcelas' : 'A receber'}</span>
          ${order.status !== 'cancelado' ? `<button type="button" class="btn btn-sm btn-ghost" data-plan-edit>${icon(real ? 'edit' : 'calendar')} ${real ? 'Editar parcelas' : 'Montar parcelas'}</button>` : ''}
        </div>
        <div class="inst-list">
          ${plan.map((p) => `
            <div class="inst-row ${p.status === 'paga' ? 'is-paid' : ''}">
              <div class="grow">
                <div class="strong small">${esc(instName(p, order.plan))}${p.dueDate ? ` <span class="dim" style="font-weight:400">· ${esc(formatDate(p.dueDate))}</span>` : ''}</div>
                <div class="row gap-2 wrap" style="margin-top:4px">
                  <span class="badge no-dot" data-tone="${INST_TONE[p.status]}">${esc(instLabel(p))}</span>
                  ${p.status !== 'paga' && p.paid > 0 ? `<span class="xs dim">pago ${esc(money(p.paid))} de ${esc(money(p.amount))}</span>` : ''}
                  ${p.remindedAt && p.status !== 'paga' ? `<span class="xs dim">${esc(remindedText(p.remindedAt))}</span>` : ''}
                </div>
              </div>
              <span class="inst-amount money-sensitive">${esc(money(p.status === 'paga' ? p.amount : p.open))}</span>
              ${p.status !== 'paga' && order.status !== 'cancelado' ? `
                <div class="inst-actions">
                  ${order.customerPhone ? `<button type="button" class="btn btn-sm" data-remind="${esc(p.id)}">${icon('whatsapp')} Cobrar</button>` : ''}
                  <button type="button" class="btn btn-sm btn-primary" data-receive="${esc(p.id)}">${icon('cash')} Receber</button>
                </div>` : ''}
            </div>`).join('')}
        </div>
      </div>`;
  }

  function detail(label, value, isHTML = false) {
    return `<div class="detail-item"><dt>${esc(label)}</dt><dd>${isHTML ? value : esc(value)}</dd></div>`;
  }

  host.addEventListener('click', async (e) => {
    if (e.target.closest('[data-plan-edit]')) {
      openPlanDialog(orderId, { onSaved: () => { render(); onChanged?.(); } });
      return;
    }
    const rc = e.target.closest('[data-receive]');
    if (rc) {
      const inst = Data.orderPlan(order).find((p) => p.id === rc.dataset.receive);
      if (!inst) return;
      openPaymentDialog({
        saldo: inst.open,
        metodoPadrao: order.paymentMethod,
        onConfirm: async (pg) => {
          try {
            await Data.savePayment(orderId, { ...pg, note: pg.note || instName(inst, order.plan) });
            const after = Data.order(orderId);
            toast(after.balance > 0 ? `Recebido · faltam ${money(after.balance)}` : 'Quitado! Pedido finalizado', after.balance > 0 ? {} : { text: after.status === 'entregue' ? 'O cliente já tinha levado: pedido finalizado.' : '' });
            render();
            onChanged?.();
          } catch (err) { toastError('Não foi possível lançar o pagamento', friendlyError(err)); }
        },
      });
      return;
    }
    const rm = e.target.closest('[data-remind]');
    if (rm) {
      const plan = Data.orderPlan(order);
      const inst = plan.find((p) => p.id === rm.dataset.remind);
      // atrasadas juntas numa mensagem só; senão, só a escolhida
      const late = plan.filter((p) => p.status === 'atrasada');
      remind(order, inst?.status === 'atrasada' && late.length > 1 ? late : [inst].filter(Boolean));
      return;
    }
    const btn = e.target.closest('[data-status]');
    if (!btn) return;
    const next = btn.dataset.status;
    if (next === order.status) return;
    try {
      if (next === 'cancelado') {
        const done = await cancelFlow(order);
        if (!done) return;
      } else if (!(await changeStatus(orderId, next))) {
        return;
      }
      render();
      onChanged?.();
    } catch (err) {
      toastError('Não foi possível mudar o status', friendlyError(err));
    }
  });

  modal.foot.querySelector('[data-edit]').addEventListener('click', () => {
    modal.close();
    openOrderForm({ order: Store.byId(orderId), onSaved: () => onChanged?.() });
  });

  modal.foot.querySelector('[data-print]').addEventListener('click', () => printOrder(Store.byId(orderId)));

  modal.foot.querySelector('[data-delete]').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Excluir pedido?',
      message: `O pedido #${String(order.code).padStart(4, '0')} de ${order.customerName} será apagado definitivamente.`,
      confirmText: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await Store.remove(orderId);
      toast('Pedido excluído');
      modal.close();
      onChanged?.();
    } catch (err) {
      toastError('Não foi possível excluir', friendlyError(err));
    }
  });

  modal.foot.querySelector('[data-wa-summary]').addEventListener('click', () => {
    openWhatsappDialog(fromOrder(Store.byId(orderId), Data.settings()));
  });
  modal.foot.querySelector('[data-pdf]').addEventListener('click', () => {
    openPdfDialog(fromOrder(Store.byId(orderId), Data.settings()));
  });
  // Abrir a ficha já adianta o gerador de PDF (no 4G o toque em "PDF" fica instantâneo).
  preloadPdf();

  // Outro aparelho mexeu no pedido: a ficha acompanha.
  const unsub = Data.subscribe((changed) => { if (changed.has('orders') && host.isConnected) render(); });
  const closeModal = modal.close;
  modal.close = (...a) => { unsub(); closeModal(...a); };

  render();
  return modal;
}

/* ------------------------------------------------------------ impressão */

/** Abre uma janela com o comprovante do pedido, pronto para imprimir/PDF. */
export function printOrder(order) {
  if (!order) return;
  const t = computeTotals(order);
  const win = window.open('', '_blank', 'width=760,height=900');
  if (!win) { toastError('O navegador bloqueou a janela de impressão.'); return; }

  const rows = order.items.map((it) => `
    <tr>
      <td>${esc(it.productName)}<br><small>${esc([it.size, it.variant, it.color, it.condition].filter(Boolean).join(' · '))}</small></td>
      <td style="text-align:center">${esc(it.qty)}</td>
      <td style="text-align:right">${esc(money(it.unitPrice))}</td>
      <td style="text-align:right">${esc(money((it.unitPrice || 0) * (it.qty || 1)))}</td>
    </tr>`).join('');

  win.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
    <title>Pedido ${String(order.code).padStart(4, '0')}</title>
    <style>
      body{font:14px -apple-system,Segoe UI,Roboto,sans-serif;color:#1d1d1f;margin:38px;}
      h1{font-size:21px;margin:0 0 3px}
      .sub{color:#6e6e73;font-size:12px;margin-bottom:22px}
      table{width:100%;border-collapse:collapse;margin:16px 0}
      th,td{padding:8px 6px;border-bottom:1px solid #e5e5ea;text-align:left;vertical-align:top}
      th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#8e8e93}
      small{color:#8e8e93}
      .tot{margin-left:auto;width:270px}
      .tot div{display:flex;justify-content:space-between;padding:4px 0}
      .tot .g{border-top:1px solid #1d1d1f;margin-top:6px;padding-top:8px;font-weight:700;font-size:16px}
      .box{background:#f5f5f7;padding:12px 14px;border-radius:10px;margin-top:18px;font-size:12.5px}
    </style></head><body>
    <h1>Pedido #${String(order.code).padStart(4, '0')}</h1>
    <div class="sub">i7even Store · ${esc(formatDate(order.orderDate))}</div>
    <div class="box">
      <b>${esc(order.customerName)}</b><br>
      ${esc(maskPhone(order.customerPhone) || '')}
      ${order.shipStreet ? `<br>${esc([order.shipStreet, order.shipNumber, order.shipComplement].filter(Boolean).join(', '))}` : ''}
      ${order.shipCity ? `<br>${esc([order.shipDistrict, order.shipCity, order.shipUf].filter(Boolean).join(' · '))} ${esc(order.shipCep || '')}` : ''}
    </div>
    <table><thead><tr><th>Item</th><th style="text-align:center">Qtd</th><th style="text-align:right">Unit.</th><th style="text-align:right">Total</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4"><small>Sem itens</small></td></tr>'}</tbody></table>
    <div class="tot">
      <div><span>Produtos</span><span>${esc(money(t.subtotal))}</span></div>
      ${t.discount ? `<div><span>Desconto</span><span>- ${esc(money(t.discount))}</span></div>` : ''}
      ${t.shipping ? `<div><span>Frete</span><span>${esc(money(t.shipping))}</span></div>` : ''}
      <div class="g"><span>Total</span><span>${esc(money(t.total))}</span></div>
      ${order.paidAmount ? `<div><span>Recebido</span><span>${esc(money(order.paidAmount))}</span></div>` : ''}
      ${t.balance > 0 ? `<div><span>Falta receber</span><span>${esc(money(t.balance))}</span></div>` : ''}
    </div>
    ${order.notes ? `<div class="box">${esc(order.notes)}</div>` : ''}
    </body></html>`);
  win.document.close();
  // Sem <script> embutido: a CSP do site bloquearia. Imprimimos pela janela-mãe.
  win.focus();
  setTimeout(() => win.print(), 350);
}

/* ------------------------------------------------------------- ajudantes */

function needsSerial(it) {
  return !!(it.variantId && Data.product(it.productId)?.tracksSerial && (it.unitIds || []).length < (Number(it.qty) || 1));
}

/** "Garantia até 12/10/2027" quando o pedido já foi finalizado; senão "365 dias de garantia". */
function warrantyText(it, order) {
  if (order?.deliveredAt) {
    const until = new Date(order.deliveredAt);
    until.setDate(until.getDate() + Number(it.warrantyDays));
    return `garantia até ${formatDate(until)}`;
  }
  return `${it.warrantyDays} dias de garantia`;
}

/**
 * Cancelar: se o cliente já pagou algo, pergunta se o dinheiro voltou
 * (estorno por forma, na data de hoje) ou se fica como crédito.
 * @returns {Promise<boolean>} true se cancelou
 */
function cancelFlow(order) {
  return new Promise((resolve) => {
    const paid = (order.payments || []).reduce((a, p) => a + (Number(p.amount) || 0), 0);
    let answered = false;
    const m = openModal({
      title: `Cancelar o pedido #${String(order.code).padStart(4, '0')}?`,
      sheet: true,
      body: `<p class="muted">Os aparelhos e produtos voltam para o estoque.</p>
        ${paid > 0 ? `<div class="alert" data-kind="warn">${icon('cash')}<div>O cliente já pagou <b>${esc(money(paid))}</b>. O dinheiro foi devolvido?</div></div>` : ''}`,
      footer: paid > 0
        ? `<button class="btn btn-ghost" data-close>Voltar</button>
           <button class="btn" data-keep>Não, fica de crédito</button>
           <button class="btn btn-danger" data-refund>Sim, lançar estorno</button>`
        : '<button class="btn btn-ghost" data-close>Voltar</button><button class="btn btn-danger" data-keep>Cancelar pedido</button>',
      onClose: () => { if (!answered) resolve(false); },
    });
    const go = async (refund, btn) => {
      try {
        await withLoading(btn, () => Data.cancelOrder(order.id, { refund }));
        answered = true;
        m.close();
        toast(refund ? 'Pedido cancelado e estorno lançado' : 'Pedido cancelado');
        resolve(true);
      } catch (err) {
        toastError('Não foi possível cancelar', friendlyError(err));
      }
    };
    m.foot.querySelector('[data-keep]').addEventListener('click', (e) => go(false, e.currentTarget));
    m.foot.querySelector('[data-refund]')?.addEventListener('click', (e) => go(true, e.currentTarget));
  });
}
