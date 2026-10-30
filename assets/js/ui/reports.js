/** Relatórios: o que vendeu, quanto entrou, quanto sobrou. */

import * as Store from '../core/store.js';
import { STATUS_MAP } from '../core/constants.js';
import { lineChart, legendHTML, rankBarsHTML } from './charts.js';
import * as Data from '../core/data.js';
import { toast, emptyState } from './kit.js';
import { icon } from './icons.js';
import {
  esc, money, startOfMonth, addDays, startOfDay, toCSV, downloadFile, formatDate,
  toDate, todayISO, isMobile, onLayoutChange,
} from '../core/utils.js';

const orderDay = (o) => toDate(o.orderDate || o.createdAt);

const PERIODS = {
  mes: 'Este mês',
  anterior: 'Mês passado',
  '90d': 'Últimos 90 dias',
  ano: 'Este ano',
  tudo: 'Tudo',
};
let period = 'mes';

function rangeFor(key) {
  const now = new Date();
  if (key === 'mes') {
    const from = startOfMonth(now);
    const to = new Date(from); to.setMonth(to.getMonth() + 1);
    return [from, to];
  }
  if (key === 'anterior') {
    const to = startOfMonth(now);
    const from = new Date(to); from.setMonth(from.getMonth() - 1);
    return [from, to];
  }
  if (key === '90d') return [startOfDay(addDays(now, -89)), addDays(startOfDay(now), 1)];
  if (key === 'ano') return [new Date(now.getFullYear(), 0, 1), new Date(now.getFullYear() + 1, 0, 1)];
  return [new Date(2000, 0, 1), addDays(startOfDay(now), 1)];
}

/** Explode os pedidos em linhas de item - a base de todo relatório de produto. */
function itemRows(orders) {
  const rows = [];
  for (const o of orders) {
    for (const it of o.items) {
      const qty = Number(it.qty) || 1;
      const revenue = (Number(it.unitPrice) || 0) * qty;
      const cost = (Number(it.unitCost) || 0) * qty;
      const cat = Data.category(it.categoryId) || Data.category(Data.product(it.productId)?.categoryId) || Data.categoryBySlug(it.categoryId);
      rows.push({
        order: o,
        item: it,
        name: it.productName || 'Item',
        categoryLabel: cat?.name || 'Outros',
        variant: it.variant,
        color: it.color,
        qty,
        revenue,
        cost,
        profit: revenue - cost,
      });
    }
  }
  return rows;
}

function aggregate(rows, keyFn, limit = 8) {
  const map = new Map();
  for (const r of rows) {
    const key = keyFn(r);
    const e = map.get(key) || { label: key, value: 0, qty: 0, profit: 0 };
    e.value += r.revenue;
    e.qty += r.qty;
    e.profit += r.profit;
    map.set(key, e);
  }
  return [...map.values()].sort((a, b) => b.value - a.value).slice(0, limit);
}

/* -------------------------------------------------------------- render */

export function mount(host) {
  host.innerHTML = '<div class="view" data-root></div>';
  const root = host.querySelector('[data-root]');
  let chart = null;

  function render() {
    const [from, to] = rangeFor(period);
    const all = Store.all();
    const inPeriod = all.filter((o) => {
      const d = orderDay(o);
      return d >= from && d < to && o.status !== 'cancelado' && o.status !== 'orcamento';
    });

    const revenue = inPeriod.reduce((a, o) => a + o.total, 0);
    const profit = inPeriod.reduce((a, o) => a + o.profit, 0);
    const cost = inPeriod.reduce((a, o) => a + o.costTotal, 0);
    const received = inPeriod.reduce((a, o) => a + o.paidAmount, 0);
    const pending = inPeriod.reduce((a, o) => a + Math.max(o.total - o.paidAmount, 0), 0);
    const rows = itemRows(inPeriod);
    const units = rows.reduce((a, r) => a + r.qty, 0);
    const margin = revenue ? (profit / revenue) * 100 : 0;

    /*
     * Dinheiro que ENTROU no período, olhando a data de cada pagamento - não a
     * data do pedido. Com parcelamento os dois números se descolam: uma venda
     * de setembro pode pingar no caixa até dezembro. A divisão por forma de
     * pagamento sai daqui também: o que entrou em PIX, cartão, troca...
     */
    const caixa = all.reduce((acc, o) => {
      for (const p of o.payments || []) {
        const d = toDate(p.date);
        if (d >= from && d < to) {
          const v = Number(p.amount) || 0;
          acc.valor += v;
          acc.qtd += 1;
          const m = p.method || 'Não informado';
          const e = acc.porForma.get(m) || { label: m, value: 0, qty: 0 };
          e.value += v;
          e.qty += 1;
          acc.porForma.set(m, e);
        }
      }
      return acc;
    }, { valor: 0, qtd: 0, porForma: new Map() });

    const header = `
      <div class="section-head">
        <div>
          <h2>Relatórios</h2>
          <p class="small dim">${esc(formatDate(from))} até ${esc(formatDate(addDays(to, -1)))}</p>
        </div>
        <div class="row gap-2 wrap">
          <div class="segmented" role="group" aria-label="Período">
            ${Object.entries(PERIODS).map(([k, label]) => `
              <button type="button" data-period="${k}" aria-pressed="${period === k}">${esc(label)}</button>`).join('')}
          </div>
        </div>
      </div>`;

    if (!inPeriod.length) {
      root.innerHTML = header + emptyState({
        emoji: '📊',
        title: 'Nenhum pedido neste período',
        text: 'Escolha outro intervalo ou cadastre pedidos para ver os números.',
      });
      return;
    }

    const daily = buildDaily(inPeriod, from, to);
    const detail = aggregateDetail(rows);

    root.innerHTML = `
      ${header}

      <div class="grid grid-kpi">
        ${kpi('Faturamento', money(revenue), 'wallet', `${inPeriod.length} pedidos`)}
        ${kpi('Entrou no caixa', money(caixa.valor), 'cash',
              `${caixa.qtd} ${caixa.qtd === 1 ? 'recebimento' : 'recebimentos'}`)}
        ${kpi('Lucro', money(profit), 'trend', `margem de ${margin.toFixed(1)}%`)}
        ${kpi('Custo das mercadorias', money(cost), 'box', `${units} ${units === 1 ? 'unidade' : 'unidades'}`)}
        ${kpi('A receber', money(pending), 'card', `${money(received)} já recebido nestes pedidos`)}
      </div>

      <div class="card">
        <div class="card-head"><h3>Evolução no período</h3></div>
        <div class="card-body">
          <div class="legend" style="margin-bottom:14px">${legendHTML(daily.series)}</div>
          <div data-chart></div>
        </div>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <div class="card-head"><h3>Produtos mais vendidos</h3><span class="xs dim">faturamento</span></div>
          <div class="card-body">${rankBarsHTML(
            aggregate(rows, (r) => r.name).map((e) => ({ ...e, sub: `${e.qty} un. · lucro ${money(e.profit)}` })),
            { color: 'var(--viz-1)' },
          )}</div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Por categoria</h3></div>
          <div class="card-body">${rankBarsHTML(
            aggregate(rows, (r) => r.categoryLabel).map((e) => ({ ...e, sub: `${e.qty} un.` })),
            { color: 'var(--viz-3)' },
          )}</div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Formas de pagamento</h3><span class="xs dim">recebido no período</span></div>
          <div class="card-body">${rankBarsHTML(
            [...caixa.porForma.values()]
              .sort((a, b) => b.value - a.value)
              .map((e) => ({ ...e, sub: `${e.qty} ${e.qty === 1 ? 'recebimento' : 'recebimentos'}` })),
            { color: 'var(--viz-2)', emptyText: 'Nenhum pagamento recebido no período.' },
          )}</div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Canais de venda</h3></div>
          <div class="card-body">${rankBarsHTML(
            aggregateOrders(inPeriod, (o) => o.channel || 'Não informado'),
            { color: 'var(--viz-5)' },
          )}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Detalhe por produto</h3></div>

        ${isMobile() ? stackHTML(detail) : `
        <div class="table-wrap" style="border:0;border-radius:0">
          <table class="data">
            <thead>
              <tr><th>Produto</th><th>Categoria</th><th class="right">Qtd.</th>
                  <th class="right">Faturamento</th><th class="right">Custo</th><th class="right">Lucro</th></tr>
            </thead>
            <tbody>
              ${detail.map((r) => `
                <tr>
                  <td class="cell-primary">${esc(r.label)}</td>
                  <td class="small muted">${esc(r.categoryLabel)}</td>
                  <td class="right mono">${esc(r.qty)}</td>
                  <td class="right mono money-sensitive">${esc(money(r.value))}</td>
                  <td class="right mono dim money-sensitive">${esc(money(r.cost))}</td>
                  <td class="right mono ${r.profit >= 0 ? 'pos' : 'neg'} money-sensitive">${esc(money(r.profit))}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`}
      </div>`;

    const chartHost = root.querySelector('[data-chart]');
    chart?.destroy();
    chart = lineChart(chartHost, {
      labels: daily.labels,
      series: daily.series,
      ariaLabel: 'Faturamento e lucro no período selecionado',
    });
  }

  /** No celular a tabela de detalhe vira lista: nada de rolar de lado. */
  function stackHTML(detail) {
    return `
        <div class="stack-list">
          ${detail.map((r) => `
            <div class="stack-row">
              <span class="stack-title">${esc(r.label)}</span>
              <span class="stack-value money-sensitive">${esc(money(r.value))}</span>
              <span class="stack-meta">
                ${esc(r.categoryLabel)} · ${esc(r.qty)} un. ·
                lucro <b class="${r.profit >= 0 ? 'pos' : 'neg'} money-sensitive">${esc(money(r.profit))}</b>
              </span>
            </div>`).join('')}
        </div>`;
  }

  /** Série por dia (ou por mês, em períodos longos), numa passada só. */
  function buildDaily(orders, from, to) {
    const days = Math.min(Math.ceil((to - from) / 86400000), 370);
    const useMonths = days > 62;
    const labels = [];
    let bucketOf;

    if (useMonths) {
      const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
      while (cursor < to) {
        labels.push(cursor.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''));
        cursor.setMonth(cursor.getMonth() + 1);
      }
      bucketOf = (d) => (d.getFullYear() - from.getFullYear()) * 12 + d.getMonth() - from.getMonth();
    } else {
      for (let i = 0; i < days; i++) {
        labels.push(addDays(from, i).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }));
      }
      bucketOf = (d) => Math.floor((startOfDay(d) - from) / 86400000 + 0.5);
    }

    const revenue = new Array(labels.length).fill(0);
    const profit = new Array(labels.length).fill(0);
    for (const o of orders) {
      const i = bucketOf(orderDay(o));
      if (i < 0 || i >= labels.length) continue;
      revenue[i] += o.total;
      profit[i] += o.profit;
    }

    return {
      labels,
      series: [{ name: 'Faturamento', values: revenue }, { name: 'Lucro', values: profit }],
    };
  }

  function aggregateOrders(orders, keyFn, limit = 8) {
    const map = new Map();
    for (const o of orders) {
      const key = keyFn(o);
      const e = map.get(key) || { label: key, value: 0, qty: 0 };
      e.value += o.total;
      e.qty += 1;
      map.set(key, e);
    }
    return [...map.values()]
      .sort((a, b) => b.value - a.value)
      .slice(0, limit)
      .map((e) => ({ ...e, sub: `${e.qty} ${e.qty === 1 ? 'pedido' : 'pedidos'}` }));
  }

  function aggregateDetail(rows) {
    const map = new Map();
    for (const r of rows) {
      const key = [r.name, r.variant, r.color].filter(Boolean).join(' · ');
      const e = map.get(key) || { label: key, categoryLabel: r.categoryLabel, qty: 0, value: 0, cost: 0, profit: 0 };
      e.qty += r.qty;
      e.value += r.revenue;
      e.cost += r.cost;
      e.profit += r.profit;
      map.set(key, e);
    }
    return [...map.values()].sort((a, b) => b.value - a.value);
  }

  function kpi(label, value, iconName, foot) {
    return `
      <div class="kpi">
        <div class="kpi-label">${icon(iconName)}${esc(label)}</div>
        <div class="kpi-value sm money-sensitive">${esc(value)}</div>
        <div class="kpi-foot dim">${esc(foot)}</div>
      </div>`;
  }

  root.addEventListener('click', (e) => {
    const p = e.target.closest('[data-period]');
    if (p) {
      period = p.dataset.period;
      render();
      // "Tudo" passa da janela de 12 meses carregada ao abrir: busca o resto.
      if (period === 'tudo' && !Data.allOrdersLoaded()) Data.ensureAllOrders().then(render).catch(() => {});
    }
  });

  const unsubscribe = Store.subscribe(() => render());
  const offLayout = onLayoutChange(() => render());
  render();

  return { refresh: render, destroy() { unsubscribe(); offLayout(); chart?.destroy(); } };
}

/* ---------------------------------------------------------- exportação */
/* Chamada só pela tela de Ajustes - é lá que ficam todas as exportações. */

/** Uma linha por item vendido, de todos os pedidos. */
export function exportItems(orders = Store.all()) {
  const rows = itemRows(orders).map((r) => ({
    Pedido: String(r.order.code).padStart(4, '0'),
    Data: formatDate(r.order.orderDate || r.order.createdAt),
    Status: STATUS_MAP[r.order.status]?.label || r.order.status,
    Cliente: r.order.customerName,
    Categoria: r.categoryLabel,
    Produto: r.name,
    Variacao: r.variant,
    Cor: r.color,
    Condicao: r.item.condition,
    IMEI: r.item.serial,
    Qtd: r.qty,
    ValorUnitario: (Number(r.item.unitPrice) || 0).toFixed(2).replace('.', ','),
    CustoUnitario: (Number(r.item.unitCost) || 0).toFixed(2).replace('.', ','),
    Faturamento: r.revenue.toFixed(2).replace('.', ','),
    Lucro: r.profit.toFixed(2).replace('.', ','),
  }));
  if (!rows.length) { toast('Nenhum item para exportar.', { kind: 'warn' }); return; }
  downloadFile(
    `itens-i7even-${todayISO()}.csv`,
    toCSV(rows),
    'text/csv;charset=utf-8',
  );
  toast(`${rows.length} linhas exportadas`);
}
