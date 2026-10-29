/**
 * A receber: o fiado da loja num lugar só.
 *
 *   - quanto os clientes devem, quanto está atrasado, o que vence hoje e na
 *     semana;
 *   - parcela por parcela (ou agrupado por cliente), com "Cobrar" (mensagem
 *     pronta no WhatsApp, com Pix) e "Receber" (lança o pagamento - quitou,
 *     o pedido finaliza sozinho);
 *   - avisos neste aparelho no dia do vencimento (core/notify.js).
 */

import * as Data from '../core/data.js';
import { friendlyError } from '../core/errors.js';
import { esc, money, formatDate } from '../core/utils.js';
import { toast, toastError, emptyState } from './kit.js';
import { icon } from './icons.js';
import { norm, pref, setPref } from './common.js';
import { openPaymentDialog } from './payments.js';
import { openOrderDetail } from './order-detail.js';
import { instLabel, instName, INST_TONE } from './plan-editor.js';
import { remind, remindedText } from './reminders.js';
import * as Notify from '../core/notify.js';

const TABS = [
  { key: 'atrasadas', label: 'Atrasadas', test: (x) => x.status === 'atrasada' },
  { key: 'hoje', label: 'Hoje', test: (x) => x.status === 'hoje' },
  { key: 'semana', label: 'Próximos 7 dias', test: (x) => x.status === 'aberta' && x.inDays <= 7 },
  { key: 'tudo', label: 'Tudo', test: () => true },
];

export function mount(host) {
  let q = '';
  let group = pref('recv.group', false);
  let tab = null;
  let tabPicked = false;   // até a pessoa escolher, abre na aba mais urgente
  host.innerHTML = '<div class="view" data-root></div>';
  const root = host.querySelector('[data-root]');

  function render() {
    const sum = Data.receivablesSummary();
    const counts = Object.fromEntries(TABS.map((t) => [t.key, sum.list.filter(t.test).length]));
    if (!tabPicked) tab = counts.atrasadas ? 'atrasadas' : counts.hoje ? 'hoje' : counts.semana ? 'semana' : 'tudo';
    const T = TABS.find((t) => t.key === tab);
    const qn = norm(q);
    const list = sum.list.filter(T.test).filter((x) => !qn || norm(`${x.order.customerName} ${x.order.customerPhone} ${x.order.code}`).includes(qn));
    const legacy = Data.orders().filter((o) => Data.owes(o) && o.status === 'entregue').length;

    root.innerHTML = `
      <div class="section-head">
        <div><h2>A receber</h2><p class="small dim">Fiado e parcelas: quem deve, quanto e quando.</p></div>
      </div>

      <div class="grid grid-kpi recv-kpis">
        <div class="kpi"><div class="kpi-label">${icon('wallet')} Total a receber</div>
          <div class="kpi-value num money-sensitive">${esc(money(sum.total))}</div>
          <div class="kpi-foot">${sum.customers} ${sum.customers === 1 ? 'cliente' : 'clientes'}</div></div>
        <div class="kpi"><div class="kpi-label">${icon('alert')} Atrasado</div>
          <div class="kpi-value num money-sensitive ${sum.late.n ? 'tone-red' : ''}">${esc(money(sum.late.sum))}</div>
          <div class="kpi-foot">${sum.late.n} ${sum.late.n === 1 ? 'parcela' : 'parcelas'}</div></div>
        <div class="kpi"><div class="kpi-label">${icon('calendar')} Vence hoje</div>
          <div class="kpi-value num money-sensitive ${sum.today.n ? 'tone-amber' : ''}">${esc(money(sum.today.sum))}</div>
          <div class="kpi-foot">${sum.today.n} ${sum.today.n === 1 ? 'parcela' : 'parcelas'}</div></div>
        <div class="kpi"><div class="kpi-label">${icon('clock')} Próximos 7 dias</div>
          <div class="kpi-value num money-sensitive">${esc(money(sum.week.sum))}</div>
          <div class="kpi-foot">${sum.week.n} ${sum.week.n === 1 ? 'parcela' : 'parcelas'}</div></div>
      </div>

      ${notifyCardHTML()}
      ${legacy ? `<div class="alert" data-kind="info">${icon('info')}<div>${legacy} ${legacy === 1 ? 'pedido antigo está' : 'pedidos antigos estão'} como <b>Finalizado</b> mas com saldo em aberto.
        Lance o pagamento (ou corrija o valor) para sair daqui.</div></div>` : ''}

      <div class="segmented tabs" role="tablist" style="margin:4px 0 10px">
        ${TABS.map((t) => `<button type="button" data-tab="${t.key}" aria-pressed="${t.key === tab}">${esc(t.label)}${counts[t.key] ? ` <span class="count ${t.key === 'atrasadas' ? 'warn' : ''}">${counts[t.key]}</span>` : ''}</button>`).join('')}
      </div>
      <div class="row gap-3 wrap" style="margin-bottom:10px">
        <label class="search grow">${icon('search')}<input class="input" type="search" data-q value="${esc(q)}" placeholder="Buscar cliente, telefone ou nº do pedido…"></label>
        <label class="check xs"><input type="checkbox" data-group ${group ? 'checked' : ''}><span class="box"></span><span>Agrupar por cliente</span></label>
      </div>

      ${list.length ? (group ? groupedHTML(list) : `<div class="card"><div class="card-body inst-list">${list.map(rowHTML).join('')}</div></div>`)
        : `<div class="card">${emptyState({ emoji: tab === 'atrasadas' ? '🎉' : '🧾',
          title: tab === 'atrasadas' ? 'Nenhuma parcela atrasada' : tab === 'hoje' ? 'Nada vence hoje' : 'Nada por aqui',
          text: sum.list.length ? 'Veja as outras abas.' : 'Quando um pedido ficar com saldo (fiado ou parcelado na loja), ele aparece aqui com os vencimentos.' })}</div>`}`;
  }

  function rowHTML(x, { showCustomer = true } = {}) {
    const o = x.order;
    const what = o.items.length === 1 ? o.items[0].productName : `${o.items.length} itens`;
    return `
      <div class="inst-row" data-key="${esc(o.id)}|${esc(x.inst.id)}">
        <button type="button" class="grow link-like" data-open="${esc(o.id)}" style="text-align:left">
          ${showCustomer ? `<div class="strong">${esc(o.customerName)}</div>` : ''}
          <div class="xs dim">#${String(o.code).padStart(4, '0')} · ${esc(what)} · ${esc(instName(x.inst, o.plan))} · ${esc(formatDate(x.dueDate))}</div>
          <div class="row gap-2 wrap" style="margin-top:4px">
            <span class="badge no-dot" data-tone="${INST_TONE[x.status]}">${esc(instLabel(x.inst))}</span>
            ${x.inst.remindedAt ? `<span class="xs dim">${esc(remindedText(x.inst.remindedAt))}</span>` : ''}
            ${o.handedOverAt ? '<span class="xs dim">fiado</span>' : ''}
          </div>
        </button>
        <span class="inst-amount money-sensitive">${esc(money(x.open))}</span>
        <div class="inst-actions">
          ${o.customerPhone ? `<button type="button" class="btn btn-sm" data-remind>${icon('whatsapp')} Cobrar</button>` : ''}
          <button type="button" class="btn btn-sm btn-primary" data-receive>${icon('cash')} Receber</button>
        </div>
      </div>`;
  }

  function groupedHTML(list) {
    const by = new Map();
    for (const x of list) {
      const k = x.order.customerId || norm(x.order.customerName);
      if (!by.has(k)) by.set(k, { name: x.order.customerName, phone: x.order.customerPhone, items: [] });
      by.get(k).items.push(x);
    }
    return [...by.values()].sort((a, b) => b.items.reduce((s, x) => s + x.open, 0) - a.items.reduce((s, x) => s + x.open, 0)).map((g) => {
      const total = g.items.reduce((s, x) => s + x.open, 0);
      const late = g.items.filter((x) => x.status === 'atrasada').length;
      return `
        <div class="card recv-group">
          <div class="card-head recv-head">
            <div class="grow"><div class="recv-cust">${esc(g.name)}</div>
              <div class="xs dim">${g.items.length} ${g.items.length === 1 ? 'parcela' : 'parcelas'}${late ? ` · <span class="tone-red">${late} atrasada${late > 1 ? 's' : ''}</span>` : ''}</div></div>
            <span class="recv-total money-sensitive">${esc(money(total))}</span>
          </div>
          <div class="card-body inst-list">${g.items.map((x) => rowHTML(x, { showCustomer: false })).join('')}</div>
        </div>`;
    }).join('');
  }

  function notifyCardHTML() {
    const st = Notify.status();
    if (st === 'unsupported' || st === 'on') return '';
    if (st === 'denied') return `<div class="alert" data-kind="warn">${icon('alert')}<div>Os avisos estão bloqueados neste navegador. Libere as notificações do site nas configurações do navegador para receber os vencimentos.</div></div>`;
    return `
      <div class="card notify-card">
        <div class="row-between gap-3 wrap">
          <div class="row gap-3" style="min-width:0"><span class="notify-ic">${icon('clock')}</span>
            <div><div class="strong">Avisar os vencimentos neste aparelho</div>
              <div class="small dim">Todo dia, ao abrir o sistema, uma notificação mostra o que vence hoje e o que está atrasado.${Notify.needsInstall() ? ' No iPhone: compartilhar → "Adicionar à Tela de Início" e abrir pelo ícone.' : ''}</div></div></div>
          ${Notify.needsInstall() ? '' : `<button class="btn btn-primary" data-notify-on>${icon('check')} Ativar avisos</button>`}
        </div>
      </div>`;
  }

  function itemOf(el) {
    const [oid, iid] = String(el.closest('[data-key]')?.dataset.key || '').split('|');
    return Data.receivables().find((x) => x.order.id === oid && x.inst.id === iid) || null;
  }

  root.addEventListener('click', async (e) => {
    const t = e.target;
    const tb = t.closest('[data-tab]');
    if (tb) { tab = tb.dataset.tab; tabPicked = true; render(); return; }
    if (t.closest('[data-notify-on]')) {
      const r = await Notify.enable();
      if (r === 'on') { toast('Avisos ativados', { text: 'Você vai ser avisado dos vencimentos neste aparelho.' }); Notify.check({ force: true }); }
      else if (r === 'denied') toastError('Avisos bloqueados', 'Libere as notificações do site nas configurações do navegador.');
      render();
      return;
    }
    const op = t.closest('[data-open]');
    if (op) { openOrderDetail(op.dataset.open, { onChanged: render }); return; }
    if (t.closest('[data-remind]')) {
      const x = itemOf(t);
      if (!x) return;
      const lateSame = Data.receivables().filter((y) => y.order.id === x.order.id && y.status === 'atrasada');
      remind(x.order, (x.status === 'atrasada' && lateSame.length > 1 ? lateSame : [x]).map((y) => y.inst));
      return;
    }
    if (t.closest('[data-receive]')) {
      const x = itemOf(t);
      if (!x) return;
      openPaymentDialog({
        saldo: x.open,
        metodoPadrao: x.order.paymentMethod,
        onConfirm: async (pg) => {
          try {
            await Data.savePayment(x.order.id, { ...pg, note: pg.note || instName(x.inst, x.order.plan) });
            const after = Data.order(x.order.id);
            toast(after.balance > 0 ? `Recebido de ${x.order.customerName.split(' ')[0]}` : `${x.order.customerName.split(' ')[0]} quitou!`,
              { text: after.balance > 0 ? `Ainda faltam ${money(after.balance)} neste pedido.` : after.status === 'entregue' ? 'Pedido finalizado.' : 'Pedido pago.' });
          } catch (err) { toastError('Não foi possível lançar o pagamento', friendlyError(err)); }
        },
      });
    }
  });

  root.addEventListener('change', (e) => {
    if (e.target.matches('[data-group]')) { group = e.target.checked; setPref('recv.group', group); render(); }
  });
  root.addEventListener('input', (e) => {
    if (!e.target.matches('[data-q]')) return;
    q = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const input = root.querySelector('[data-q]');
    input?.focus();
    try { input?.setSelectionRange(pos, pos); } catch { /* */ }
  });

  const unsub = Data.subscribe((c) => {
    if (!c.has('orders')) return;
    const a = document.activeElement;
    if (a && root.contains(a) && a.matches('input[type="search"]')) return;
    render();
  });
  render();
  return { refresh: render, destroy: unsub };
}

