/** Ficha completa do pedido, com troca de status em um toque. */

import * as Store from '../core/store.js';
import { STATUSES, STATUS_MAP, PAYMENT_STATUSES } from '../core/constants.js';
import { openModal, toast, toastError, confirmDialog } from './kit.js';
import { openOrderForm, computeTotals } from './order-form.js';
import { paymentsHTML, wirePayments } from './payments.js';
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
    body: '<div data-detail></div>',
    footer: `
      <button class="btn btn-ghost" data-delete>${icon('trash')} Excluir</button>
      <span class="grow"></span>
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
                  ${it.serial ? `<span class="tag">${icon('tag')} ${esc(it.serial)}</span>` : ''}
                  ${it.warrantyDays ? `<span class="tag">${esc(it.warrantyDays)} dias de garantia</span>` : ''}
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

      <div class="fieldset">
        <div class="fieldset-title">Dados</div>
        <dl class="detail-grid">
          ${detail('Cliente', order.customerName)}
          ${detail('WhatsApp', order.customerPhone
            ? (wa ? `<a href="${esc(wa)}" target="_blank" rel="noopener noreferrer">${esc(maskPhone(order.customerPhone))}</a>`
                  : esc(maskPhone(order.customerPhone)))
            : '-', true)}
          ${detail('E-mail', order.customerEmail || '-')}
          ${detail('Documento', order.customerDoc || '-')}
          ${detail('Data do pedido', formatDate(order.orderDate))}
          ${detail('Previsão', order.dueDate ? formatDate(order.dueDate) : '-')}
          ${detail('Pagamento', `${order.paymentMethod || '-'}${order.installments > 1 ? ` · ${order.installments}×` : ''}`)}
          ${detail('Envio', order.shippingMethod || '-')}
          ${detail('Rastreio', order.trackingCode || '-')}
          ${detail('Finalizado em', order.deliveredAt ? formatDateTime(order.deliveredAt) : '-')}
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
        await Store.patch(orderId, { payments: lista });
        const salvo = Store.byId(orderId);
        const falta = computeTotals(salvo).balance;
        toast(falta > 0 ? `Pagamento lançado · faltam ${money(falta)}` : 'Pedido quitado');
        render();
        onChanged?.();
      } catch (err) {
        toastError('Não foi possível lançar o pagamento', err.message);
      }
    },
  );

  function detail(label, value, isHTML = false) {
    return `<div class="detail-item"><dt>${esc(label)}</dt><dd>${isHTML ? value : esc(value)}</dd></div>`;
  }

  host.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-status]');
    if (!btn) return;
    const next = btn.dataset.status;
    if (next === order.status) return;
    try {
      await Store.setStatus(orderId, next);
      toast(`Status: ${STATUS_MAP[next]?.label || next}`);
      render();
      onChanged?.();
    } catch (err) {
      toastError('Não foi possível mudar o status', err.message);
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
      toastError('Não foi possível excluir', err.message);
    }
  });

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
