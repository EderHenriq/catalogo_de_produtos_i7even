/** Painel inicial: o resumo que responde "como está a loja hoje?". */

import * as Store from '../core/store.js';
import * as Data from '../core/data.js';
import { STATUSES, STATUS_MAP } from '../core/constants.js';
import { APP } from '../config.js';
import { lineChart, legendHTML, chartTableHTML, rankBarsHTML } from './charts.js';
import { openOrderDetail } from './order-detail.js';
import { openOrderForm } from './order-form.js';
import { emptyState } from './kit.js';
import { icon } from './icons.js';
import { catalogUrl, catalogShareText, setPref } from './common.js';
import {
  esc, money, moneyCompact, relativeDate, daysSince, startOfMonth, addDays, startOfDay, toDate,
} from '../core/utils.js';

const TREND_RANGES = {
  '30d': { label: '30 dias', days: 30, bucket: 'day' },
  '6m': { label: '6 meses', months: 6, bucket: 'month' },
  '12m': { label: '12 meses', months: 12, bucket: 'month' },
};
let trendRange = '30d';
let showTable = false;

/* ------------------------------------------------------------ cálculos */

function monthWindow(offset = 0) {
  const start = startOfMonth(new Date());
  start.setMonth(start.getMonth() + offset);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  return [start, end];
}

function orderDay(order) {
  return toDate(order.orderDate || order.createdAt);
}

function inRange(order, from, to) {
  const d = orderDay(order);
  return d >= from && d < to;
}

function valid(list) {
  return list.filter((o) => o.status !== 'cancelado' && o.status !== 'orcamento');
}

function summarize(list) {
  const ok = valid(list);
  const revenue = ok.reduce((a, o) => a + o.total, 0);
  const profit = ok.reduce((a, o) => a + o.profit, 0);
  return { count: ok.length, revenue, profit, ticket: ok.length ? revenue / ok.length : 0 };
}

/** Série temporal de faturamento e lucro, numa passada só pelos pedidos. */
function buildTrend(orders) {
  const cfg = TREND_RANGES[trendRange];
  const labels = [];
  const n = cfg.bucket === 'day' ? cfg.days : cfg.months;
  const revenue = new Array(n).fill(0);
  const profit = new Array(n).fill(0);
  let bucketOf;

  if (cfg.bucket === 'day') {
    const first = startOfDay(addDays(new Date(), -(n - 1)));
    for (let i = 0; i < n; i++) {
      labels.push(addDays(first, i).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }));
    }
    bucketOf = (d) => Math.round((startOfDay(d) - first) / 86400000);
  } else {
    const [first] = monthWindow(-(n - 1));
    for (let i = 0; i < n; i++) {
      const m = new Date(first.getFullYear(), first.getMonth() + i, 1);
      labels.push(m.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''));
    }
    bucketOf = (d) => (d.getFullYear() - first.getFullYear()) * 12 + d.getMonth() - first.getMonth();
  }

  for (const o of valid(orders)) {
    const i = bucketOf(orderDay(o));
    if (i < 0 || i >= n) continue;
    revenue[i] += o.total;
    profit[i] += o.profit;
  }

  return {
    labels,
    series: [
      { name: 'Faturamento', values: revenue },
      { name: 'Lucro', values: profit },
    ],
  };
}

/** Top produtos por faturamento, a partir dos itens de todos os pedidos. */
function topProducts(orders, limit = 6) {
  const map = new Map();
  for (const o of valid(orders)) {
    for (const it of o.items) {
      const key = it.productName || 'Item';
      const entry = map.get(key) || { label: key, value: 0, qty: 0 };
      entry.value += (Number(it.unitPrice) || 0) * (Number(it.qty) || 1);
      entry.qty += Number(it.qty) || 1;
      map.set(key, entry);
    }
  }
  return [...map.values()]
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
    .map((r) => ({ ...r, sub: `${r.qty} ${r.qty === 1 ? 'unidade' : 'unidades'}` }));
}

function byChannel(orders, limit = 6) {
  const map = new Map();
  for (const o of valid(orders)) {
    const key = o.channel || 'Não informado';
    const entry = map.get(key) || { label: key, value: 0, qty: 0 };
    entry.value += o.total;
    entry.qty += 1;
    map.set(key, entry);
  }
  return [...map.values()]
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
    .map((r) => ({ ...r, sub: `${r.qty} ${r.qty === 1 ? 'pedido' : 'pedidos'}` }));
}

/* -------------------------------------------------------------- render */

export function mount(host, ctx) {
  host.innerHTML = '<div class="view" data-root></div>';
  const root = host.querySelector('[data-root]');
  let chart = null;

  function render() {
    const orders = Store.all();

    if (!orders.length) {
      root.innerHTML = quickHTML() + emptyState({
        emoji: '👋',
        title: 'Tudo pronto para começar',
        text: 'Cadastre seu primeiro pedido - os números e gráficos aparecem automaticamente.',
        action: `<button class="btn btn-primary btn-lg" data-new>${icon('plus')} Criar primeiro pedido</button>`,
      });
      return;
    }

    const [mStart, mEnd] = monthWindow(0);
    const [pStart, pEnd] = monthWindow(-1);
    const thisMonth = summarize(orders.filter((o) => inRange(o, mStart, mEnd)));
    const lastMonth = summarize(orders.filter((o) => inRange(o, pStart, pEnd)));

    const open = orders.filter((o) => STATUS_MAP[o.status]?.open);
    const receivable = open.reduce((a, o) => a + Math.max(o.total - o.paidAmount, 0), 0);
    const attention = open
      .filter((o) => o.priority || daysSince(o.updatedAt) >= APP.staleDays)
      .sort((a, b) => Number(b.priority) - Number(a.priority) || new Date(a.updatedAt) - new Date(b.updatedAt))
      .slice(0, 6);

    const trend = buildTrend(orders);
    const perStatus = {};
    for (const o of orders) perStatus[o.status] = (perStatus[o.status] || 0) + 1;
    const funnelMax = Math.max(1, ...Object.values(perStatus));

    root.innerHTML = `
      ${quickHTML()}
      <div class="grid grid-kpi">
        ${kpi('Faturamento do mês', money(thisMonth.revenue), 'wallet',
              delta(thisMonth.revenue, lastMonth.revenue, 'vs. mês passado'), true)}
        ${kpi('Lucro do mês', money(thisMonth.profit), 'trend',
              delta(thisMonth.profit, lastMonth.profit, 'vs. mês passado'), true)}
        ${kpi('Pedidos em aberto', String(open.length), 'orders',
              `${esc(thisMonth.count)} ${thisMonth.count === 1 ? 'venda' : 'vendas'} no mês`)}
        ${kpi('A receber', money(receivable), 'card',
              `Ticket médio ${esc(moneyCompact(thisMonth.ticket))}`, true)}
      </div>

      <div class="grid grid-dash">
        <div class="card">
          <div class="card-head">
            <h3>Faturamento e lucro</h3>
            <div class="segmented" role="group" aria-label="Período do gráfico">
              ${Object.entries(TREND_RANGES).map(([k, v]) => `
                <button type="button" data-range="${k}" aria-pressed="${trendRange === k}">${esc(v.label)}</button>`).join('')}
            </div>
          </div>
          <div class="card-body">
            <div class="legend" style="margin-bottom:14px">${legendHTML(trend.series)}</div>
            <div data-chart></div>
            <button class="chart-table-toggle" data-toggle-table style="margin-top:10px">
              ${showTable ? 'Ocultar tabela' : 'Ver dados em tabela'}
            </button>
            ${showTable ? `<div style="overflow-x:auto;margin-top:10px">${chartTableHTML(trend.labels, trend.series)}</div>` : ''}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>Situação dos pedidos</h3></div>
          <div class="card-body">
            <div class="funnel">
              ${STATUSES.map((s) => {
                const n = perStatus[s.key] || 0;
                return `
                  <button class="funnel-row" data-goto-status="${esc(s.key)}">
                    <span class="funnel-label small muted truncate">${esc(s.label)}</span>
                    <span class="funnel-bar">
                      <span class="funnel-fill" style="width:${((n / funnelMax) * 100).toFixed(1)}%;
                            background:var(--tone-${s.tone}-dot)"></span>
                    </span>
                    <span class="funnel-count">${n}</span>
                  </button>`;
              }).join('')}
            </div>
          </div>
        </div>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <div class="card-head"><h3>Produtos que mais saem</h3><span class="xs dim">por faturamento</span></div>
          <div class="card-body">${rankBarsHTML(topProducts(orders), { color: 'var(--viz-1)' })}</div>
        </div>
        <div class="card">
          <div class="card-head"><h3>De onde vêm os pedidos</h3></div>
          <div class="card-body">${rankBarsHTML(byChannel(orders), { color: 'var(--viz-2)' })}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>Precisam de atenção</h3>
          <span class="xs dim">catálogo, encomendas, estoque e pedidos parados</span>
        </div>
        <div class="card-body">
          ${alertsHTML()}
          ${attention.length
            ? `<div class="order-cards">${attention.map(attentionRow).join('')}</div>`
            : (alertsHTML() ? '' : '<p class="small dim">Nada parado. Tudo em dia. 🎉</p>')}
        </div>
      </div>`;

    const chartHost = root.querySelector('[data-chart]');
    if (chartHost) {
      chart?.destroy();
      chart = lineChart(chartHost, {
        labels: trend.labels,
        series: trend.series,
        ariaLabel: 'Faturamento e lucro ao longo do tempo',
      });
    }
  }

  /** Atalhos do dia a dia: o que mais se faz, a um toque. */
  function quickHTML() {
    return `
      <nav class="quick-actions" aria-label="Atalhos">
        <button type="button" class="qa is-primary" data-new>${icon('plus')}<span>Novo pedido</span></button>
        <button type="button" class="qa" data-qa-stock>${icon('layers')}<span>Adicionar ao estoque</span></button>
        <a class="qa" href="https://wa.me/?text=${encodeURIComponent(catalogShareText(catalogUrl()))}" target="_blank" rel="noopener">${icon('whatsapp')}<span>Mandar catálogo</span></a>
        <button type="button" class="qa" data-go="vitrine">${icon('image')}<span>Vitrine</span></button>
      </nav>`;
  }

  /** Avisos que viram um toque: cada um leva para a tela que resolve. */
  function alertsHTML() {
    const reqs = Data.catalogRequests().filter((r) => r.status === 'novo').length;
    const noImei = Data.orders().filter((o) => STATUS_MAP[o.status]?.open && o.items.some((it) =>
      it.variantId && Data.product(it.productId)?.tracksSerial && (it.unitIds || []).length < it.qty)).length;
    const low = Data.lowStock().length;
    const noPrice = Data.variants().filter((v) => v.active && v.stock > 0 && !(v.price > 0)).length;
    // à mostra no catálogo (pronta entrega ou encomenda) e sem nenhuma foto
    const sells = (v) => v.active && v.showInCatalog && ((v.stock > 0 && v.price > 0) || (v.onOrder && v.orderPrice > 0));
    const noPhoto = Data.settings().catalogEnabled ? Data.products().filter((p) => p.active && p.showInCatalog
      && !p.imageUrl && !Object.keys(p.colorPhotos || {}).length && Data.variantsOf(p.id).some(sells)).length : 0;
    const due = Data.receivablesSummary();
    const rows = [
      due.late.n && { go: 'receber', icon: 'alert', tone: 'red', text: `${due.late.n} ${due.late.n === 1 ? 'parcela atrasada' : 'parcelas atrasadas'} · ${money(due.late.sum)} para cobrar` },
      due.today.n && { go: 'receber', icon: 'calendar', tone: 'amber', text: `${due.today.n} ${due.today.n === 1 ? 'parcela vence' : 'parcelas vencem'} hoje · ${money(due.today.sum)}` },
      reqs && { go: 'catalogo', icon: 'store', tone: 'accent', text: `${reqs} ${reqs === 1 ? 'pedido novo' : 'pedidos novos'} pelo catálogo` },
      noImei && { go: 'pedidos', icon: 'device', tone: 'amber', text: `${noImei} ${noImei === 1 ? 'pedido' : 'pedidos'} com aparelho sem IMEI escolhido (encomenda)` },
      low && { go: 'produtos', icon: 'alert', tone: 'amber', text: `${low} ${low === 1 ? 'variação' : 'variações'} com estoque no mínimo` },
      noPrice && { go: 'estoque', icon: 'tag', tone: 'amber', text: `${noPrice} ${noPrice === 1 ? 'item em estoque' : 'itens em estoque'} sem preço de venda` },
      noPhoto && { go: 'vitrine', filter: 'semfoto', icon: 'camera', tone: 'amber', text: `${noPhoto} ${noPhoto === 1 ? 'produto aparece' : 'produtos aparecem'} no catálogo sem foto` },
    ].filter(Boolean);
    if (!rows.length) return '';
    return `<div class="alert-list">${rows.map((r) => `
      <button type="button" class="banner-btn tone-${r.tone}" data-go="${r.go}" ${r.filter ? `data-vfilter="${r.filter}"` : ''}>${icon(r.icon)}<span class="grow">${esc(r.text)}</span>${icon('chevronRight')}</button>`).join('')}</div>`;
  }

  function attentionRow(o) {
    const st = STATUS_MAP[o.status];
    return `
      <div class="order-card ${o.priority ? 'is-priority' : ''}" data-id="${esc(o.id)}">
        <div class="row-between">
          <div class="grow truncate">
            <div class="cell-primary truncate">${esc(o.customerName)}</div>
            <div class="cell-sub">#${String(o.code).padStart(4, '0')} · parado desde ${esc(relativeDate(o.updatedAt))}</div>
          </div>
          <span class="badge" data-tone="${esc(st?.tone || 'gray')}">${esc(st?.short || o.status)}</span>
        </div>
      </div>`;
  }

  function kpi(label, value, iconName, foot, sensitive = false) {
    return `
      <div class="kpi">
        <div class="kpi-label">${icon(iconName)}${esc(label)}</div>
        <div class="kpi-value ${sensitive ? 'money-sensitive' : ''}">${esc(value)}</div>
        <div class="kpi-foot">${foot}</div>
      </div>`;
  }

  function delta(current, previous, suffix) {
    if (!previous) return `<span class="dim">${esc(suffix)}</span>`;
    const pct = ((current - previous) / Math.abs(previous)) * 100;
    const up = pct >= 0;
    return `<span class="delta ${up ? 'up' : 'down'}">${icon(up ? 'arrowUp' : 'arrowDown')}
      ${esc(Math.abs(pct).toFixed(0))}%</span><span class="dim">${esc(suffix)}</span>`;
  }

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-new]')) { openOrderForm({ onSaved: render }); return; }
    const go = e.target.closest('[data-go]');
    if (go) { if (go.dataset.vfilter) setPref('vitrine.filter', go.dataset.vfilter); ctx.go?.(go.dataset.go); return; }
    if (e.target.closest('[data-qa-stock]')) { import('./quick-product.js').then((m) => m.openQuickProduct({ mode: 'pronta', onDone: render })); return; }

    const range = e.target.closest('[data-range]');
    if (range) { trendRange = range.dataset.range; render(); return; }

    if (e.target.closest('[data-toggle-table]')) { showTable = !showTable; render(); return; }

    const goto = e.target.closest('[data-goto-status]');
    if (goto) { ctx.goToOrders?.({ status: goto.dataset.gotoStatus }); return; }

    const card = e.target.closest('[data-id]');
    if (card) openOrderDetail(card.dataset.id, { onChanged: render });
  });

  const unsubscribe = Store.subscribe(() => render());
  render();

  return {
    refresh: render,
    destroy() { unsubscribe(); chart?.destroy(); },
  };
}
