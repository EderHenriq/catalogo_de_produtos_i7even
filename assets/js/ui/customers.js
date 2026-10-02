/** Clientes - derivados dos pedidos, sem cadastro separado para manter. */

import * as Store from '../core/store.js';
import { emptyState, openMenu, toast } from './kit.js';
import { openOrderForm } from './order-form.js';
import { icon } from './icons.js';
import { normalize } from '../data/catalog.js';
import {
  esc, money, maskPhone, whatsappLink, relativeDate, initials, toCSV, downloadFile,
  todayISO, isMobile, onLayoutChange,
} from '../core/utils.js';

let term = '';

export function mount(host, ctx) {
  host.innerHTML = '<div class="view" data-root></div>';
  const root = host.querySelector('[data-root]');

  function render() {
    const all = Store.customers();
    const q = normalize(term);
    const list = q
      ? all.filter((c) => normalize(`${c.name} ${c.phone} ${c.city}`).includes(q))
      : all;

    if (!all.length) {
      root.innerHTML = emptyState({
        emoji: '🧑‍🤝‍🧑',
        title: 'Nenhum cliente ainda',
        text: 'Os clientes aparecem aqui automaticamente conforme você cadastra pedidos.',
      });
      return;
    }

    const spent = list.reduce((a, c) => a + c.spent, 0);

    root.innerHTML = `
      <div class="section-head">
        <div>
          <h2>Clientes</h2>
          <p class="small dim">${list.length} ${list.length === 1 ? 'cliente' : 'clientes'} ·
            ${esc(money(spent))} em compras</p>
        </div>
      </div>

      ${!list.length ? emptyState({ emoji: '🔍', title: 'Nenhum cliente com esse nome' })
        : isMobile() ? cardsHTML(list) : `
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr><th>Cliente</th><th>Contato</th><th>Cidade</th>
                  <th class="right">Pedidos</th><th class="right">Total gasto</th>
                  <th>Último</th><th class="col-actions"></th></tr>
            </thead>
            <tbody>
              ${list.map((c) => `
                <tr data-name="${esc(c.name)}">
                  <td>
                    <div class="row gap-2">
                      <span class="avatar">${esc(initials(c.name))}</span>
                      <span class="cell-primary truncate" style="max-width:190px">${esc(c.name)}</span>
                    </div>
                  </td>
                  <td class="small">${c.phone ? esc(maskPhone(c.phone)) : '<span class="dim">-</span>'}</td>
                  <td class="small muted">${esc([c.city, c.uf].filter(Boolean).join(' - ') || '-')}</td>
                  <td class="right mono">${esc(c.orders)}</td>
                  <td class="right mono strong money-sensitive">${esc(money(c.spent))}</td>
                  <td class="small muted nowrap">${esc(relativeDate(c.lastAt))}</td>
                  <td class="col-actions">
                    <button class="icon-btn sm" data-menu="${esc(c.name)}" aria-label="Ações">${icon('more')}</button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`}`;
  }

  /** No celular a tabela vira cartões. */
  function cardsHTML(list) {
    return `
        <div class="order-cards">
          ${list.map((c) => `
            <div class="order-card" data-name="${esc(c.name)}">
              <div class="row gap-3">
                <span class="avatar">${esc(initials(c.name))}</span>
                <div class="grow truncate">
                  <div class="cell-primary truncate">${esc(c.name)}</div>
                  <div class="cell-sub">${esc(c.phone ? maskPhone(c.phone) : '-')} · ${esc(relativeDate(c.lastAt))}</div>
                </div>
                <div class="right">
                  <div class="strong mono money-sensitive">${esc(money(c.spent))}</div>
                  <div class="cell-sub">${esc(c.orders)} ${c.orders === 1 ? 'pedido' : 'pedidos'}</div>
                </div>
              </div>
            </div>`).join('')}
        </div>`;
  }

  root.addEventListener('click', (e) => {
    const menuBtn = e.target.closest('[data-menu]');
    if (menuBtn) {
      const name = menuBtn.dataset.menu;
      const c = Store.customers().find((x) => x.name === name);
      const wa = whatsappLink(c?.phone, `Olá ${name.split(' ')[0]}! `);
      openMenu(menuBtn, [
        { label: 'Ver pedidos', icon: 'orders', onSelect: () => ctx.goToOrders?.({ search: name }) },
        { label: 'Novo pedido para este cliente', icon: 'plus', onSelect: () => newForCustomer(c) },
        ...(wa ? [{ label: 'Chamar no WhatsApp', icon: 'whatsapp', onSelect: () => window.open(wa, '_blank', 'noopener') }] : []),
      ]);
      return;
    }

    const row = e.target.closest('[data-name]');
    if (row) ctx.goToOrders?.({ search: row.dataset.name });
  });

  function newForCustomer(c) {
    if (!c) return;
    openOrderForm({
      order: {
        ...Store.newOrderDraft?.() ?? {},
        id: null,
        customerName: c.name,
        customerPhone: c.phone,
        customerEmail: c.email,
        customerDoc: c.doc,
        shipCep: c.cep,
        shipStreet: c.street,
        shipNumber: c.number,
        shipComplement: c.complement,
        shipDistrict: c.district,
        shipCity: c.city,
        shipUf: c.uf,
        status: 'novo',
        items: [],
        discount: 0,
        shippingCost: 0,
        shippingExpense: 0,
        paidAmount: 0,
        installments: 1,
        paymentStatus: 'pendente',
        orderDate: todayISO(),
      },
      onSaved: render,
    });
  }

  const unsubscribe = Store.subscribe(() => render());
  const offLayout = onLayoutChange(() => render());
  render();

  return {
    onSearch(value) { term = value; render(); },
    refresh: render,
    destroy() { unsubscribe(); offLayout(); },
  };
}

/* ---------------------------------------------------------- exportação */
/* Chamada só pela tela de Ajustes - é lá que ficam todas as exportações. */

export function exportCustomers() {
  const rows = Store.customers().map((c) => ({
    Cliente: c.name,
    Telefone: c.phone,
    Email: c.email,
    Documento: c.doc,
    Cidade: c.city,
    UF: c.uf,
    Pedidos: c.orders,
    TotalGasto: c.spent.toFixed(2).replace('.', ','),
    UltimoPedido: relativeDate(c.lastAt),
  }));
  if (!rows.length) { toast('Nada para exportar.', { kind: 'warn' }); return; }
  downloadFile(
    `clientes-i7even-${todayISO()}.csv`,
    toCSV(rows),
    'text/csv;charset=utf-8',
  );
  toast(`${rows.length} clientes exportados`);
}
