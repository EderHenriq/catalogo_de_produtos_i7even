/** Lista de pedidos: filtros, seleção múltipla, ações em lote e exportação. */

import * as Store from '../core/store.js';
import * as Data from '../core/data.js';
import { friendlyError } from '../core/errors.js';
import { STATUSES, STATUS_MAP, NEXT_STATUS, CHANNELS } from '../core/constants.js';
import { APP } from '../config.js';
import { openOrderDetail, printOrder } from './order-detail.js';
import { openOrderForm } from './order-form.js';
import { changeStatus, advanceLabel, missing } from './status-flow.js';
import { openPdfDialog, openWhatsappDialog } from './doc-preview.js';
import { fromOrder } from '../docs/order-doc.js';
import { openModal, toast, toastError, confirmDialog, emptyState, openMenu } from './kit.js';
import { icon } from './icons.js';
import {
  esc, money, formatDate, relativeDate, daysSince, toCSV, downloadFile,
  startOfDay, startOfMonth, addDays, toDate, todayISO, isMobile, onLayoutChange,
} from '../core/utils.js';
import { norm as normalize } from './common.js';

/** Quantos pedidos desenhar de cada vez. O resto vem no "Mostrar mais". */
const PAGE = 60;

/** Estado dos filtros - vive fora do render para sobreviver à navegação. */
const filters = {
  statuses: new Set(),     // vazio = todos
  period: 'todos',         // hoje | 7d | 30d | mes | todos
  channel: '',
  onlyOpen: false,
  onlyUnpaid: false,
  sort: { key: 'createdAt', dir: 'desc' },
};

let selection = new Set();
let searchTerm = '';

/** Deixa outra tela (o funil do painel) abrir a lista já filtrada por status. */
export function setStatusFilter(status) {
  filters.statuses = new Set(status ? [status] : []);
  filters.period = 'todos';
  filters.onlyOpen = false;
}

/* -------------------------------------------------------------- filtro */

function periodStart(key) {
  const now = new Date();
  if (key === 'hoje') return startOfDay(now);
  if (key === '7d') return startOfDay(addDays(now, -6));
  if (key === '30d') return startOfDay(addDays(now, -29));
  if (key === 'mes') return startOfMonth(now);
  return null;
}

/**
 * Texto de busca de cada pedido, montado uma vez só. O pedido salvo vira um
 * objeto novo no store, então a entrada antiga some sozinha do WeakMap.
 */
const haystacks = new WeakMap();

function haystackOf(o) {
  let h = haystacks.get(o);
  if (h === undefined) {
    h = normalize([
      o.customerName, o.customerPhone, o.customerEmail, o.trackingCode, o.notes,
      String(o.code).padStart(4, '0'),
      ...o.items.map((it) => [it.productName, it.variant, it.color, it.serial].join(' ')),
    ].join(' '));
    haystacks.set(o, h);
  }
  return h;
}

export function filterOrders(list, { term = searchTerm } = {}) {
  const from = periodStart(filters.period);
  const q = normalize(term);

  return list.filter((o) => {
    if (filters.statuses.size && !filters.statuses.has(o.status)) return false;
    if (filters.onlyOpen && !STATUS_MAP[o.status]?.open) return false;
    // "Só a receber": quem deve de verdade (orçamento e cancelado não entram)
    if (filters.onlyUnpaid && !Data.owes(o)) return false;
    if (filters.channel && o.channel !== filters.channel) return false;
    if (from && toDate(o.orderDate || o.createdAt) < from) return false;
    if (!q) return true;
    return haystackOf(o).includes(q);
  });
}

function sortOrders(list) {
  const { key, dir } = filters.sort;
  const mult = dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    let x = a[key];
    let y = b[key];
    if (key === 'customerName') return mult * String(x).localeCompare(String(y), 'pt-BR');
    if (key === 'createdAt' || key === 'orderDate') { x = toDate(x); y = toDate(y); }
    return mult * ((x > y) - (x < y));
  });
}

/* -------------------------------------------------------------- render */

export function mount(host, ctx) {
  host.innerHTML = `
    <div class="view">
      <div data-requests></div>
      <div class="filters no-print" data-filters></div>
      <div data-list></div>
      <div data-bulk></div>
    </div>`;

  const $filters = host.querySelector('[data-filters]');
  const $list = host.querySelector('[data-list]');
  const $bulk = host.querySelector('[data-bulk]');

  /** Quantos filtros além do status estão ligados (mostrado no botão do celular). */
  function activeExtras() {
    return [
      filters.period !== 'todos',
      !!filters.channel,
      filters.onlyOpen,
      filters.onlyUnpaid,
    ].filter(Boolean).length;
  }

  /**
   * Período, canal e chaves. No desktop ficam na barra; no celular vão para
   * uma folha, porque não cabem em 390px sem virar bagunça.
   */
  function advancedHTML() {
    return `
      <div class="segmented" role="group" aria-label="Período">
        ${[['hoje', 'Hoje'], ['7d', '7 dias'], ['30d', '30 dias'], ['mes', 'Este mês'], ['todos', 'Tudo']]
          .map(([k, label]) => `
            <button type="button" data-period="${k}" aria-pressed="${filters.period === k}">${label}</button>`).join('')}
      </div>
      <select class="select" data-channel aria-label="Canal de venda">
        <option value="">Todos os canais</option>
        ${CHANNELS.map((c) => `<option ${filters.channel === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
      </select>
      <label class="check"><input type="checkbox" data-only-open ${filters.onlyOpen ? 'checked' : ''}>
        <span class="box"></span><span>Só em aberto</span></label>
      <label class="check"><input type="checkbox" data-only-unpaid ${filters.onlyUnpaid ? 'checked' : ''}>
        <span class="box"></span><span>Só a receber</span></label>`;
  }

  function renderFilters() {
    const extras = activeExtras();
    $filters.innerHTML = `
      <div class="filter-chips chips">
        ${STATUSES.map((s) => `
          <button type="button" class="chip sm" data-status="${esc(s.key)}"
                  aria-pressed="${filters.statuses.has(s.key)}">${esc(s.label)}</button>`).join('')}
      </div>

      <div class="filters-mobile">
        <button class="btn btn-sm" data-open-filters>
          ${icon('filter')} Filtros
          ${extras ? `<span class="filter-count">${extras}</span>` : ''}
        </button>
      </div>

      <span class="spacer filters-advanced"></span>
      <div class="filters-advanced row wrap gap-3">
        ${advancedHTML()}
      </div>`;
  }

  /** Folha de filtros do celular - os mesmos controles, com espaço para o dedo. */
  function openFilterSheet() {
    const sheet = openModal({
      title: 'Filtros',
      subtitle: 'Vale junto com os status marcados acima',
      body: `<div class="col gap-5" data-sheet>${advancedHTML()}</div>`,
      footer: `
        <button class="btn btn-ghost" data-clear-all>Limpar</button>
        <button class="btn btn-primary" data-close>Ver resultados</button>`,
    });
    // Mesmos manipuladores da barra: um só lugar decidindo o que cada controle faz.
    sheet.body.addEventListener('click', onFilterClick);
    sheet.body.addEventListener('change', onFilterChange);
    sheet.foot.querySelector('[data-clear-all]').addEventListener('click', () => {
      filters.period = 'todos';
      filters.channel = '';
      filters.onlyOpen = false;
      filters.onlyUnpaid = false;
      sheet.close();
      renderAll();
    });
  }

  function currentList() {
    return sortOrders(filterOrders(Store.all()));
  }

  // Paginação: volta para a primeira página sempre que filtro, busca ou
  // ordenação mudam.
  let shown = PAGE;
  let lastQuery = '';

  function queryKey() {
    return JSON.stringify([[...filters.statuses], filters.period, filters.channel,
      filters.onlyOpen, filters.onlyUnpaid, filters.sort, searchTerm]);
  }

  function renderList() {
    const key = queryKey();
    if (key !== lastQuery) { lastQuery = key; shown = PAGE; }

    const list = currentList();
    const quotesOnly = list.every((o) => o.status === 'orcamento');
    const total = list.reduce((acc, o) => acc + (o.status === 'cancelado' || (o.status === 'orcamento' && !quotesOnly) ? 0 : o.total), 0);

    if (!Store.all().length) {
      $list.innerHTML = emptyState({
        emoji: '🧾',
        title: 'Nenhum pedido ainda',
        text: 'Cadastre o primeiro pedido e ele aparece aqui na hora.',
        action: `<button class="btn btn-primary" data-new>${icon('plus')} Novo pedido</button>`,
      });
      return;
    }

    if (!list.length) {
      $list.innerHTML = emptyState({
        emoji: '🔍',
        title: 'Nada encontrado com esses filtros',
        text: 'Tente limpar a busca ou escolher outro período.',
        action: `<button class="btn" data-clear-filters>Limpar filtros</button>`,
      });
      return;
    }

    // Só o layout da tela atual vai para o DOM: antes a tabela (escondida no
    // celular) e os cartões (escondidos no desktop) eram montados juntos.
    const page = list.slice(0, shown);
    const rest = list.length - page.length;
    const more = rest > 0
      ? `<button class="btn btn-block" data-more style="margin-top:12px">
           Mostrar mais ${Math.min(rest, PAGE)} de ${rest}</button>`
      : '';

    const head = `
      <div class="row-between" style="margin-bottom:12px">
        <span class="small muted">${list.length} ${list.length === 1 ? 'pedido' : 'pedidos'}</span>
        <span class="small muted">Soma: <b class="mono money-sensitive">${esc(money(total))}</b></span>
      </div>`;

    if (isMobile()) {
      $list.innerHTML = `${head}<div class="order-cards">${page.map(cardHTML).join('')}</div>${more}`;
      return;
    }

    $list.innerHTML = `
      ${head}
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th style="width:38px"><label class="check"><input type="checkbox" data-all
                ${selection.size === list.length ? 'checked' : ''}><span class="box"></span></label></th>
              ${th('code', '#')}
              ${th('customerName', 'Cliente')}
              <th>Itens</th>
              <th>Status</th>
              ${th('total', 'Total', 'right')}
              ${th('createdAt', 'Data')}
              <th class="col-actions"></th>
            </tr>
          </thead>
          <tbody>${page.map(rowHTML).join('')}</tbody>
        </table>
      </div>
      ${more}`;
  }

  function th(key, label, align = '') {
    const active = filters.sort.key === key;
    const sortAttr = active ? ` aria-sort="${filters.sort.dir === 'asc' ? 'ascending' : 'descending'}"` : '';
    return `<th class="sortable ${align}" data-sort="${key}"${sortAttr}>${esc(label)}
      <span class="sort-arrow">${active && filters.sort.dir === 'asc' ? '↑' : '↓'}</span></th>`;
  }

  function rowHTML(o) {
    const st = STATUS_MAP[o.status];
    const stale = st?.open && daysSince(o.updatedAt) >= APP.staleDays;
    const summary = itemSummary(o);
    return `
      <tr data-id="${esc(o.id)}"
          class="${selection.has(o.id) ? 'is-selected' : ''} ${o.priority ? 'is-priority' : stale ? 'is-stale' : ''}">
        <td><label class="check"><input type="checkbox" data-select="${esc(o.id)}"
          ${selection.has(o.id) ? 'checked' : ''}><span class="box"></span></label></td>
        <td><span class="order-code">${String(o.code).padStart(4, '0')}</span></td>
        <td>
          <div class="cell-primary truncate" style="max-width:200px">${esc(o.customerName)}</div>
          ${o.channel ? `<div class="cell-sub">${esc(o.channel)}</div>` : ''}
        </td>
        <td><div class="truncate" style="max-width:240px" title="${esc(summary)}">${esc(summary)}</div></td>
        <td><span class="badge" data-tone="${esc(st?.tone || 'gray')}">${esc(st?.short || o.status)}</span></td>
        <td class="right">
          <div class="strong mono money-sensitive">${esc(money(o.total))}</div>
          ${Data.owes(o) ? `<div class="cell-sub tone-amber money-sensitive">falta ${esc(money(o.balance))}</div>` : ''}
        </td>
        <td><span class="small muted nowrap">${esc(relativeDate(o.orderDate || o.createdAt))}</span></td>
        <td class="col-actions">
          <div class="row gap-1">
            ${NEXT_STATUS[o.status]
              ? `<button class="icon-btn sm" data-advance="${esc(o.id)}"
                   title="${esc(advanceLabel(o, NEXT_STATUS[o.status]).text === 'Receber' ? `Receber ${money(missing(o))}` : `Avançar para ${STATUS_MAP[NEXT_STATUS[o.status]].label}`)}">${icon(advanceLabel(o, NEXT_STATUS[o.status]).text === 'Receber' ? 'cash' : 'chevronRight')}</button>`
              : ''}
            <button class="icon-btn sm" data-menu="${esc(o.id)}" aria-label="Mais ações">${icon('more')}</button>
          </div>
        </td>
      </tr>`;
  }

  function cardHTML(o) {
    const st = STATUS_MAP[o.status];
    return `
      <div class="order-card ${o.priority ? 'is-priority' : ''} ${selection.has(o.id) ? 'is-selected' : ''}"
           data-id="${esc(o.id)}">
        <div class="row gap-3">
          <label class="check" aria-label="Selecionar pedido">
            <input type="checkbox" data-select="${esc(o.id)}" ${selection.has(o.id) ? 'checked' : ''}>
            <span class="box"></span>
          </label>
          <div class="grow truncate">
            <div class="cell-primary truncate">${esc(o.customerName)}</div>
            <div class="cell-sub">#${String(o.code).padStart(4, '0')} · ${esc(relativeDate(o.orderDate || o.createdAt))}</div>
          </div>
          <span class="badge" data-tone="${esc(st?.tone || 'gray')}">${esc(st?.short || o.status)}</span>
        </div>
        <div class="small muted clamp-2">${esc(itemSummary(o))}</div>
        <div class="row-between">
          <span class="col">
            <span class="strong mono money-sensitive">${esc(money(o.total))}</span>
            ${Data.owes(o) ? `<span class="xs tone-amber money-sensitive">falta ${esc(money(o.balance))}</span>` : ''}
          </span>
          ${NEXT_STATUS[o.status]
            ? (advanceLabel(o, NEXT_STATUS[o.status]).text === 'Receber'
              ? `<button class="btn btn-sm" data-advance="${esc(o.id)}">${icon('cash')} Receber</button>`
              : `<button class="btn btn-sm" data-advance="${esc(o.id)}">
                 ${esc(STATUS_MAP[NEXT_STATUS[o.status]].short)} ${icon('chevronRight')}</button>`)
            : ''}
        </div>
      </div>`;
  }

  function itemSummary(o) {
    if (!o.items.length) return '- sem itens -';
    const first = o.items[0];
    const label = [first.productName, first.variant, first.color].filter(Boolean).join(' · ');
    return o.items.length > 1 ? `${label} +${o.items.length - 1}` : label;
  }

  function renderBulk() {
    // O botão flutuante de "novo pedido" divide o canto com esta barra.
    document.documentElement.dataset.bulk = selection.size ? 'on' : 'off';
    if (!selection.size) { $bulk.innerHTML = ''; return; }
    $bulk.innerHTML = `
      <div class="bulkbar no-print">
        <span class="strong bulk-label">${selection.size} selecionado${selection.size > 1 ? 's' : ''}</span>
        <span class="grow hide-mobile"></span>
        <button class="btn btn-sm" data-bulk-status>${icon('refresh')} Status</button>
        <button class="btn btn-sm" data-bulk-delete>${icon('trash')} Excluir</button>
        <button class="icon-btn sm" data-bulk-clear aria-label="Limpar seleção">${icon('x')}</button>
      </div>`;
  }

  /** Pedidos novos do catálogo: aviso no topo, com atalho para a tela do Catálogo. */
  function renderRequests() {
    const box = host.querySelector('[data-requests]');
    const n = Data.catalogRequests().filter((r) => r.status === 'novo').length;
    box.innerHTML = n ? `
      <button type="button" class="banner-btn" data-go-requests>
        ${icon('store')}
        <span class="grow"><b>${n} ${n === 1 ? 'pedido chegou' : 'pedidos chegaram'} pelo catálogo</b>
          <span class="xs dim block">Toque para ver e transformar em pedido com um toque</span></span>
        ${icon('chevronRight')}
      </button>` : '';
  }

  function renderAll() {
    renderRequests();
    renderFilters();
    renderList();
    renderBulk();
  }

  /* ------------------------------------------------------------ eventos */

  /**
   * Um único manipulador serve a barra (desktop) e a folha (celular).
   * Quando o clique veio da folha, atualizamos os botões no lugar em vez de
   * redesenhar tudo - senão a folha se apagaria embaixo do dedo.
   */
  function onFilterClick(e) {
    const naFolha = !$filters.contains(e.target);

    const st = e.target.closest('[data-status]');
    if (st) {
      const key = st.dataset.status;
      filters.statuses.has(key) ? filters.statuses.delete(key) : filters.statuses.add(key);
      st.setAttribute('aria-pressed', String(filters.statuses.has(key)));
      renderList();
      atualizarContador();
      return;
    }

    const pe = e.target.closest('[data-period]');
    if (pe) {
      filters.period = pe.dataset.period;
      pe.parentElement.querySelectorAll('[data-period]').forEach((b) => {
        b.setAttribute('aria-pressed', String(b === pe));
      });
      if (!naFolha) syncBarra();
      renderList();
      atualizarContador();
      return;
    }

    if (e.target.closest('[data-open-filters]')) openFilterSheet();
  }

  function onFilterChange(e) {
    if (e.target.matches('[data-channel]')) filters.channel = e.target.value;
    else if (e.target.matches('[data-only-open]')) filters.onlyOpen = e.target.checked;
    else if (e.target.matches('[data-only-unpaid]')) filters.onlyUnpaid = e.target.checked;
    else return;
    if (!$filters.contains(e.target)) syncBarra();
    renderList();
    atualizarContador();
  }

  /** Reflete na barra o que foi mexido na folha (e vice-versa). */
  function syncBarra() {
    const avancado = $filters.querySelector('.filters-advanced');
    if (!avancado) return;
    avancado.querySelectorAll('[data-period]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.period === filters.period));
    });
    const canal = avancado.querySelector('[data-channel]');
    if (canal) canal.value = filters.channel;
    const aberto = avancado.querySelector('[data-only-open]');
    if (aberto) aberto.checked = filters.onlyOpen;
    const receber = avancado.querySelector('[data-only-unpaid]');
    if (receber) receber.checked = filters.onlyUnpaid;
  }

  function atualizarContador() {
    const botao = $filters.querySelector('[data-open-filters]');
    if (!botao) return;
    const n = activeExtras();
    const atual = botao.querySelector('.filter-count');
    if (!n) { atual?.remove(); return; }
    if (atual) atual.textContent = String(n);
    else botao.insertAdjacentHTML('beforeend', `<span class="filter-count">${n}</span>`);
  }

  $filters.addEventListener('click', onFilterClick);
  $filters.addEventListener('change', onFilterChange);

  $list.addEventListener('change', (e) => {
    if (e.target.matches('[data-all]')) {
      const list = currentList();
      selection = e.target.checked ? new Set(list.map((o) => o.id)) : new Set();
      renderList();
      renderBulk();
      return;
    }
    const sel = e.target.closest('[data-select]');
    if (sel) {
      sel.checked ? selection.add(sel.dataset.select) : selection.delete(sel.dataset.select);
      sel.closest('tr, .order-card')?.classList.toggle('is-selected', sel.checked);
      renderBulk();
    }
  });

  host.querySelector('[data-requests]').addEventListener('click', (e) => {
    if (e.target.closest('[data-go-requests]')) ctx.go?.('catalogo');
  });

  $list.addEventListener('click', async (e) => {
    if (e.target.closest('[data-new]')) { openOrderForm({ onSaved: renderAll }); return; }
    if (e.target.closest('[data-more]')) { shown += PAGE; renderList(); return; }
    if (e.target.closest('[data-clear-filters]')) {
      filters.statuses.clear();
      filters.period = 'todos';
      filters.channel = '';
      filters.onlyOpen = false;
      filters.onlyUnpaid = false;
      ctx.clearSearch?.();
      searchTerm = '';
      renderAll();
      return;
    }

    const sortTh = e.target.closest('[data-sort]');
    if (sortTh) {
      const key = sortTh.dataset.sort;
      filters.sort = {
        key,
        dir: filters.sort.key === key && filters.sort.dir === 'desc' ? 'asc' : 'desc',
      };
      renderList();
      return;
    }

    const adv = e.target.closest('[data-advance]');
    if (adv) {
      e.stopPropagation();
      const o = Store.byId(adv.dataset.advance);
      const next = NEXT_STATUS[o?.status];
      if (!next) return;
      if (await changeStatus(o.id, next)) renderAll();
      return;
    }

    const menuBtn = e.target.closest('[data-menu]');
    if (menuBtn) {
      e.stopPropagation();
      const o = Store.byId(menuBtn.dataset.menu);
      openMenu(menuBtn, [
        { label: 'Abrir detalhes', icon: 'receipt', onSelect: () => open(o.id) },
        { label: 'Editar', icon: 'edit', onSelect: () => openOrderForm({ order: o, onSaved: renderAll }) },
        { label: 'PDF do pedido', icon: 'receipt', onSelect: () => openPdfDialog(fromOrder(o, Data.settings())) },
        { label: 'Resumo no WhatsApp', icon: 'whatsapp', onSelect: () => openWhatsappDialog(fromOrder(o, Data.settings())) },
        { label: 'Imprimir', icon: 'print', onSelect: () => printOrder(o) },
        {
          label: o.priority ? 'Tirar urgência' : 'Marcar urgente',
          icon: 'flag',
          onSelect: async () => {
            try {
              await Store.patch(o.id, { priority: !o.priority });
              renderAll();
            } catch (err) { toastError('Não foi possível alterar a urgência', friendlyError(err)); }
          },
        },
        {
          label: 'Excluir', icon: 'trash', danger: true, separatorBefore: true,
          onSelect: async () => {
            const ok = await confirmDialog({
              title: 'Excluir pedido?',
              message: `#${String(o.code).padStart(4, '0')} - ${o.customerName}`,
              confirmText: 'Excluir', danger: true,
            });
            if (!ok) return;
            try {
              await Store.remove(o.id);
              toast('Pedido excluído');
              renderAll();
            } catch (err) { toastError('Não foi possível excluir', friendlyError(err)); }
          },
        },
      ]);
      return;
    }

    const row = e.target.closest('[data-id]');
    if (row && !e.target.closest('label, input, button')) open(row.dataset.id);
  });

  $bulk.addEventListener('click', async (e) => {
    if (e.target.closest('[data-bulk-clear]')) { selection.clear(); renderAll(); return; }
    if (e.target.closest('[data-bulk-delete]')) {
      const ok = await confirmDialog({
        title: `Excluir ${selection.size} pedidos?`,
        message: 'Essa ação não pode ser desfeita.',
        confirmText: 'Excluir tudo', danger: true,
      });
      if (!ok) return;
      try {
        await Store.removeMany([...selection]);
        toast(`${selection.size} pedidos excluídos`);
        selection.clear();
        renderAll();
      } catch (err) { toastError('Falhou ao excluir', friendlyError(err)); }
      return;
    }
    if (e.target.closest('[data-bulk-status]')) bulkStatus();
  });

  function bulkStatus() {
    const m = openModal({
      title: `Mudar status de ${selection.size} pedidos`,
      body: `<div class="chips">${STATUSES.map((s) => `
        <button class="chip" data-to="${esc(s.key)}">${esc(s.label)}</button>`).join('')}</div>`,
    });
    m.body.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-to]');
      if (!btn) return;
      m.close();
      const to = btn.dataset.to;
      // "Pago"/"Finalizado" em lote só para quem quitou; o resto fica como está (avisa).
      const ids = [...selection].filter((id) => !(['pago', 'entregue'].includes(to) && missing(Store.byId(id)) > 0));
      const skipped = selection.size - ids.length;
      try {
        for (const id of ids) await Store.setStatus(id, to);
        toast(`${ids.length} pedidos atualizados`, skipped ? { text: `${skipped} com saldo a receber ficaram de fora - abra cada um para receber ou entregar no fiado.`, duration: 7000 } : {});
        selection.clear();
        renderAll();
      } catch (err) { toastError('Falhou no meio do caminho', friendlyError(err)); renderAll(); }
    });
  }

  function open(id) {
    openOrderDetail(id, { onChanged: renderAll });
  }

  const unsubscribe = Store.subscribe((changed) => {
    if (changed?.has?.('catalogRequests')) renderRequests();
    if (!changed || changed.has('orders')) renderList();
  });
  const offLayout = onLayoutChange(() => renderList());

  renderAll();

  return {
    onSearch(term) { searchTerm = term; renderList(); },
    refresh: renderAll,
    destroy() {
      unsubscribe();
      offLayout();
      selection.clear();
      document.documentElement.dataset.bulk = 'off';
    },
  };
}

/* ---------------------------------------------------------- exportação */

export function exportCSV(list) {
  if (!list.length) { toast('Nenhum pedido para exportar.', { kind: 'warn' }); return; }
  const rows = list.map((o) => ({
    Pedido: String(o.code).padStart(4, '0'),
    Data: formatDate(o.orderDate || o.createdAt),
    Cliente: o.customerName,
    Telefone: o.customerPhone,
    Canal: o.channel,
    Status: STATUS_MAP[o.status]?.label || o.status,
    Itens: o.items.map((it) => [it.productName, it.variant, it.color].filter(Boolean).join(' ')).join(' | '),
    Quantidade: o.items.reduce((a, it) => a + (it.qty || 1), 0),
    Produtos: o.subtotal.toFixed(2).replace('.', ','),
    Desconto: o.discount.toFixed(2).replace('.', ','),
    Frete: o.shippingCost.toFixed(2).replace('.', ','),
    Total: o.total.toFixed(2).replace('.', ','),
    Custo: o.costTotal.toFixed(2).replace('.', ','),
    Lucro: o.profit.toFixed(2).replace('.', ','),
    Pagamento: o.paymentMethod,
    SituacaoPagamento: o.paymentStatus,
    Recebido: o.paidAmount.toFixed(2).replace('.', ','),
    Envio: o.shippingMethod,
    Rastreio: o.trackingCode,
    Cidade: o.shipCity,
    UF: o.shipUf,
    Observacoes: (o.notes || '').replace(/\s+/g, ' '),
  }));
  downloadFile(
    `pedidos-i7even-${todayISO()}.csv`,
    toCSV(rows),
    'text/csv;charset=utf-8',
  );
  toast(`${list.length} pedidos exportados`);
}
