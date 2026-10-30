/**
 * Clientes: cadastro próprio (desde a v2), criado sozinho a cada pedido -
 * ninguém precisa cadastrar antes de vender. A ficha mostra o histórico, o
 * que comprou (com IMEI, para garantia e troca), quanto deve e atalhos de
 * WhatsApp (chamar, mandar o catálogo).
 */

import * as Data from '../core/data.js';
import { instLabel, instName, INST_TONE } from './plan-editor.js';
import { remind } from './reminders.js';
import { STATUS_MAP, UFS } from '../core/constants.js';
import { friendlyError } from '../core/errors.js';
import { emptyState, openMenu, openModal, toast, toastError, withLoading } from './kit.js';
import { openOrderForm } from './order-form.js';
import { openOrderDetail } from './order-detail.js';
import { icon } from './icons.js';
import { matches, moneyHTML, code, catalogUrl, pref, setPref } from './common.js';
import {
  esc, money, maskPhone, maskCEP, whatsappLink, relativeDate, formatDate, initials, toCSV, downloadFile,
  todayISO, isMobile, onLayoutChange,
} from '../core/utils.js';

const FILTERS = [
  { key: 'todos', label: 'Todos' },
  { key: 'devendo', label: 'Devendo' },
  { key: 'recorrentes', label: '2+ pedidos' },
  { key: 'aniversario', label: 'Aniversário no mês' },
];

export function mount(host, ctx) {
  let term = '';
  let filter = pref('customers.filter', 'todos');
  host.innerHTML = '<div class="view" data-root></div>';
  const root = host.querySelector('[data-root]');

  function list() {
    const month = todayISO().slice(5, 7);
    return Data.customerStats().filter((c) => {
      if (!c.active) return false;
      if (filter === 'devendo' && !(c.owed > 0)) return false;
      if (filter === 'recorrentes' && c.orders < 2) return false;
      if (filter === 'aniversario' && String(c.birthday || '').slice(5, 7) !== month) return false;
      return matches(term, c.name, c.phone, c.city, c.instagram, c.email);
    });
  }

  function render() {
    const all = Data.customerStats();
    const items = list();
    const owed = items.reduce((a, c) => a + c.owed, 0);
    root.innerHTML = `
      <div class="section-head">
        <div>
          <h2>Clientes</h2>
          <p class="small dim">${items.length} ${items.length === 1 ? 'cliente' : 'clientes'} ·
            ${moneyHTML(items.reduce((a, c) => a + c.spent, 0))} em compras${owed > 0 ? ` · ${moneyHTML(owed, 'tone-amber')} a receber` : ''}</p>
        </div>
        <button class="btn btn-primary" data-new-customer>${icon('plus')} Cliente</button>
      </div>
      <div class="chips filter-chips">
        ${FILTERS.map((f) => `<button type="button" class="chip sm" data-filter="${f.key}" aria-pressed="${f.key === filter}">${esc(f.label)}</button>`).join('')}
      </div>
      ${!all.length ? emptyState({ emoji: '🧑‍🤝‍🧑', title: 'Nenhum cliente ainda', text: 'Os clientes entram aqui sozinhos conforme você cadastra pedidos.' })
        : !items.length ? emptyState({ emoji: '🔍', title: 'Ninguém com esse filtro' })
        : isMobile() ? cardsHTML(items) : tableHTML(items)}`;
  }

  function tableHTML(items) {
    return `
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Cliente</th><th>Contato</th><th>Cidade</th><th class="right">Pedidos</th>
            <th class="right">Total gasto</th><th class="right">A receber</th><th>Último</th><th class="col-actions"></th></tr></thead>
          <tbody>
            ${items.map((c) => `
              <tr data-open="${esc(c.id)}">
                <td><div class="row gap-2"><span class="avatar">${esc(initials(c.name))}</span>
                  <span class="cell-primary truncate" style="max-width:200px">${esc(c.name)}</span></div></td>
                <td class="small">${c.phone ? esc(maskPhone(c.phone)) : '<span class="dim">-</span>'}</td>
                <td class="small muted">${esc([c.city, c.uf].filter(Boolean).join(' - ') || '-')}</td>
                <td class="right mono">${c.orders}</td>
                <td class="right strong">${moneyHTML(c.spent)}</td>
                <td class="right">${c.owed > 0 ? moneyHTML(c.owed, 'tone-amber') : '<span class="dim">-</span>'}</td>
                <td class="small muted nowrap">${esc(c.lastAt ? relativeDate(c.lastAt) : '-')}</td>
                <td class="col-actions"><button class="icon-btn sm" data-menu="${esc(c.id)}" aria-label="Ações">${icon('more')}</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function cardsHTML(items) {
    return `<div class="order-cards">${items.map((c) => `
      <div class="order-card" data-open="${esc(c.id)}">
        <div class="row gap-3">
          <span class="avatar">${esc(initials(c.name))}</span>
          <div class="grow truncate">
            <div class="cell-primary truncate">${esc(c.name)}</div>
            <div class="cell-sub">${esc(c.phone ? maskPhone(c.phone) : '-')}${c.lastAt ? ` · ${esc(relativeDate(c.lastAt))}` : ''}</div>
          </div>
          <div class="right">
            <div class="strong">${moneyHTML(c.spent)}</div>
            <div class="cell-sub">${c.owed > 0 ? `<span class="tone-amber">deve ${esc(money(c.owed))}</span>` : `${c.orders} ${c.orders === 1 ? 'pedido' : 'pedidos'}`}</div>
          </div>
        </div>
      </div>`).join('')}</div>`;
  }

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-new-customer]')) { openCustomerForm({}); return; }
    const f = e.target.closest('[data-filter]');
    if (f) { filter = f.dataset.filter; setPref('customers.filter', filter); render(); return; }
    const m = e.target.closest('[data-menu]');
    if (m) { e.stopPropagation(); customerMenu(m, Data.customer(m.dataset.menu), ctx); return; }
    const row = e.target.closest('[data-open]');
    if (row) openCustomerSheet(row.dataset.open, ctx);
  });

  const unsub = Data.subscribe((c) => { if (c.has('customers') || c.has('orders')) render(); });
  const offLayout = onLayoutChange(render);
  render();
  return {
    onSearch(v) { term = v; render(); },
    refresh: render,
    destroy() { unsub(); offLayout(); },
  };
}

function customerMenu(anchor, c, ctx) {
  if (!c) return;
  const wa = whatsappLink(c.phone, `Olá, ${c.name.split(' ')[0]}! `);
  openMenu(anchor, [
    { label: 'Abrir ficha', icon: 'users', onSelect: () => openCustomerSheet(c.id, ctx) },
    { label: 'Novo pedido para este cliente', icon: 'plus', onSelect: () => newForCustomer(c) },
    ...(wa ? [
      { label: 'Chamar no WhatsApp', icon: 'whatsapp', onSelect: () => window.open(wa, '_blank', 'noopener') },
      { label: 'Mandar o catálogo', icon: 'store', onSelect: () => sendCatalog(c) },
    ] : []),
    { label: 'Editar cadastro', icon: 'edit', onSelect: () => openCustomerForm(c) },
  ]);
}

function sendCatalog(c) {
  const s = Data.settings();
  const link = whatsappLink(c.phone, `Olá, ${c.name.split(' ')[0]}! Aqui está o catálogo da ${s.storeName}, com os aparelhos e preços atualizados:\n${catalogUrl()}`);
  if (link) window.open(link, '_blank', 'noopener');
}

export function newForCustomer(c) {
  if (!c) return;
  openOrderForm({
    prefill: {
      customerId: c.id, customerName: c.name, customerPhone: c.phone, customerEmail: c.email, customerDoc: c.doc,
      shipCep: c.cep, shipStreet: c.street, shipNumber: c.number, shipComplement: c.complement,
      shipDistrict: c.district, shipCity: c.city, shipUf: c.uf,
    },
  });
}

/* ---------------------------------------------------------------- ficha -- */

export async function openCustomerSheet(id, ctx) {
  const c0 = Data.customer(id);
  if (!c0) return;
  // A ficha mostra a história inteira: busca os pedidos mais antigos que a janela.
  Data.ensureAllOrders().catch(() => {});
  const modal = openModal({ title: c0.name, subtitle: 'Cliente', size: 'lg', body: '<div class="col gap-5" data-cs></div>',
    footer: `<button class="icon-btn" data-cmore aria-label="Mais">${icon('more')}</button><span class="grow"></span>
      <button class="btn" data-cedit>${icon('edit')}<span>Editar</span></button>
      <button class="btn btn-primary" data-cnew>${icon('plus')}<span>Novo pedido</span></button>` });
  const box = modal.body.querySelector('[data-cs]');

  function render() {
    const c = Data.customer(id);
    if (!c) { modal.close(); return; }
    const stats = Data.customerStats().find((x) => x.id === id) || { orders: 0, spent: 0, owed: 0 };
    const orders = Data.ordersOfCustomer(c).sort((a, b) => (b.code || 0) - (a.code || 0));
    const devices = orders.filter((o) => o.status !== 'cancelado').flatMap((o) => o.items.filter((it) => it.serial).map((it) => ({ o, it })));
    const address = [[c.street, c.number].filter(Boolean).join(', '), c.complement, c.district, [c.city, c.uf].filter(Boolean).join(' - '), c.cep].filter(Boolean).join(' · ');
    const wa = whatsappLink(c.phone, `Olá ${c.name.split(' ')[0]}! `);
    box.innerHTML = `
      <div class="hero-numbers wide">
        <div><span class="xs dim">Pedidos</span><span class="strong num">${stats.orders}</span></div>
        <div><span class="xs dim">Total comprado</span><span class="strong">${moneyHTML(stats.spent)}</span></div>
        <div><span class="xs dim">A receber</span><span class="strong">${stats.owed > 0 ? moneyHTML(stats.owed, 'tone-amber') : '-'}</span></div>
      </div>
      <dl class="detail-grid">
        ${c.phone ? `<div class="detail-item"><dt>WhatsApp</dt><dd>${wa
          ? `<a href="${esc(wa)}" target="_blank" rel="noopener noreferrer">${esc(maskPhone(c.phone))}</a>` : esc(maskPhone(c.phone))}</dd></div>` : ''}
        ${c.instagram ? `<div class="detail-item"><dt>Instagram</dt><dd>${esc(c.instagram)}</dd></div>` : ''}
        ${c.email ? `<div class="detail-item"><dt>E-mail</dt><dd class="truncate">${esc(c.email)}</dd></div>` : ''}
        ${c.doc ? `<div class="detail-item"><dt>CPF / documento</dt><dd>${esc(c.doc)}</dd></div>` : ''}
        ${c.birthday ? `<div class="detail-item"><dt>Aniversário</dt><dd>${esc(formatDate(c.birthday))}</dd></div>` : ''}
        <div class="detail-item"><dt>Cliente desde</dt><dd>${esc(formatDate(c.createdAt))}</dd></div>
      </dl>
      ${address ? `<div class="alert">${icon('pin')}<div>${esc(address)}</div></div>` : ''}
      ${c.notes ? `<div class="alert">${icon('info')}<div style="white-space:pre-wrap">${esc(c.notes)}</div></div>` : ''}
      ${debtHTML(c)}
      ${devices.length ? `
        <div class="fieldset"><div class="fieldset-title">Aparelhos comprados (${devices.length})</div>
          <div class="variant-list">${devices.map(({ o, it }) => `
            <button type="button" class="variant-row" data-order="${esc(o.id)}">
              <span class="v-main"><span class="v-title">${esc([it.productName, it.variant, it.color].filter(Boolean).join(' · '))}</span>
                <span class="v-sub mono">${esc(it.serial)}</span></span>
              <span class="v-side"><span class="xs dim">${esc(formatDate(o.orderDate))}</span><span class="xs">${esc(code(o.code))}</span></span>
            </button>`).join('')}</div></div>` : ''}
      <div class="fieldset"><div class="fieldset-title">Pedidos (${orders.length})</div>
        ${orders.length ? `<div class="variant-list">${orders.map((o) => `
          <button type="button" class="variant-row" data-order="${esc(o.id)}">
            <span class="v-main"><span class="v-title">${esc(code(o.code))} · ${esc(formatDate(o.orderDate))}</span>
              <span class="v-sub">${esc(o.items.map((it) => it.productName).join(', ') || 'sem itens')}</span></span>
            <span class="v-side"><span class="strong">${moneyHTML(o.total)}</span>
              <span class="badge" data-tone="${esc(STATUS_MAP[o.status]?.tone || 'gray')}">${esc(STATUS_MAP[o.status]?.short || o.status)}</span></span>
          </button>`).join('')}</div>` : '<p class="small dim">Nenhum pedido.</p>'}</div>`;
  }

  /** Fiado: o que este cliente ainda deve, parcela por parcela, com "Cobrar". */
  function debtHTML(c) {
    const items = Data.receivables().filter((x) => x.order.customerId === c.id);
    if (!items.length) return '';
    const late = items.filter((x) => x.status === 'atrasada');
    return `
      <div class="fieldset"><div class="fieldset-title row-between"><span>Deve (${items.length} ${items.length === 1 ? 'parcela' : 'parcelas'})</span>
        ${c.phone && late.length ? `<button type="button" class="btn btn-sm" data-cremind>${icon('whatsapp')} Cobrar atrasadas</button>` : ''}</div>
        <div class="inst-list">${items.map((x) => `
          <button type="button" class="inst-row link-like" data-order="${esc(x.order.id)}" style="text-align:left;width:100%">
            <span class="grow"><span class="strong small">${esc(code(x.order.code))} · ${esc(instName(x.inst, x.order.plan))}</span>
              <span class="row gap-2" style="margin-top:4px"><span class="badge no-dot" data-tone="${INST_TONE[x.status]}">${esc(instLabel(x.inst))}</span></span></span>
            <span class="inst-amount money-sensitive">${esc(money(x.open))}</span>
          </button>`).join('')}</div></div>`;
  }

  modal.panel.addEventListener('click', (e) => {
    const c = Data.customer(id);
    if (e.target.closest('[data-cremind]')) {
      // uma mensagem por pedido (cada um tem o seu produto e as suas parcelas)
      const late = Data.receivables().filter((x) => x.order.customerId === c.id && x.status === 'atrasada');
      const byOrder = new Map();
      for (const x of late) { if (!byOrder.has(x.order.id)) byOrder.set(x.order.id, []); byOrder.get(x.order.id).push(x.inst); }
      const [first] = byOrder.entries();
      if (first) remind(Data.order(first[0]), first[1]);
      return;
    }
    const ord = e.target.closest('[data-order]');
    if (ord) { openOrderDetail(ord.dataset.order); return; }
    if (e.target.closest('[data-cedit]')) { openCustomerForm(c); return; }
    if (e.target.closest('[data-cnew]')) { modal.close(); newForCustomer(c); return; }
    const more = e.target.closest('[data-cmore]');
    if (more) customerMenu(more, c, ctx);
  });

  const unsub = Data.subscribe((ch) => { if (ch.has('customers') || ch.has('orders')) render(); });
  const close = modal.close;
  modal.close = (...a) => { unsub(); close(...a); };
  render();
}

/* ------------------------------------------------------------- cadastro -- */

export function openCustomerForm(c = {}) {
  const editing = !!c.id;
  const f = (name, label, value, attrs = '', span = 'span-6') => `
    <div class="field ${span}"><label class="label" for="cf-${name}">${label}</label>
      <input class="input" id="cf-${name}" name="${name}" value="${esc(value || '')}" ${attrs}></div>`;
  const modal = openModal({
    title: editing ? 'Editar cliente' : 'Novo cliente',
    size: 'lg',
    body: `
      <div class="form-grid">
        ${f('name', 'Nome *', c.name, 'maxlength="120" data-autofocus', 'span-12')}
        ${f('phone', 'WhatsApp', maskPhone(c.phone || ''), 'inputmode="tel" maxlength="16"', 'span-6 span-half-mobile')}
        ${f('instagram', 'Instagram', c.instagram, 'maxlength="60" placeholder="@"', 'span-6 span-half-mobile')}
        ${f('email', 'E-mail', c.email, 'type="email" maxlength="160"')}
        ${f('doc', 'CPF / documento', c.doc, 'maxlength="30"', 'span-3 span-half-mobile')}
        <div class="field span-3 span-half-mobile"><label class="label" for="cf-birthday">Aniversário</label>
          <input class="input" id="cf-birthday" name="birthday" type="date" value="${esc(c.birthday || '')}"></div>
        ${f('cep', 'CEP', maskCEP(c.cep || ''), 'inputmode="numeric" maxlength="9"', 'span-3 span-half-mobile')}
        ${f('street', 'Rua', c.street, 'maxlength="160"', 'span-6')}
        ${f('number', 'Número', c.number, 'maxlength="20"', 'span-3 span-half-mobile')}
        ${f('complement', 'Complemento', c.complement, 'maxlength="80"', 'span-4')}
        ${f('district', 'Bairro', c.district, 'maxlength="80"', 'span-4 span-half-mobile')}
        ${f('city', 'Cidade', c.city, 'maxlength="80"', 'span-2 span-half-mobile')}
        <div class="field span-2 span-half-mobile"><label class="label" for="cf-uf">UF</label>
          <select class="select" id="cf-uf" name="uf"><option value="">-</option>${UFS.map((u) => `<option ${u === c.uf ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
        <div class="field span-12"><label class="label" for="cf-notes">Observações</label>
          <textarea class="textarea" id="cf-notes" name="notes" maxlength="1000" rows="3">${esc(c.notes || '')}</textarea></div>
        ${editing ? `<div class="field span-12"><label class="check"><input type="checkbox" name="active" ${c.active !== false ? 'checked' : ''}>
          <span class="box"></span><span>Cliente ativo (desmarcado: some da lista)</span></label></div>` : ''}
      </div>
      <div class="alert hide" data-erro data-kind="warn">${icon('alert')}<div data-erro-txt></div></div>`,
    footer: `<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Salvar</button>`,
  });
  const $ = (n) => modal.body.querySelector(`[name="${n}"]`);
  modal.body.addEventListener('input', (e) => {
    if (e.target.name === 'phone') e.target.value = maskPhone(e.target.value);
    if (e.target.name === 'cep') e.target.value = maskCEP(e.target.value);
  });
  modal.foot.querySelector('[data-ok]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const row = { id: c.id || null };
    for (const k of ['name', 'phone', 'instagram', 'email', 'doc', 'birthday', 'cep', 'street', 'number', 'complement', 'district', 'city', 'uf', 'notes']) row[k] = $(k).value;
    if ($('active')) row.active = $('active').checked;
    if (!row.name.trim()) { $('name').focus(); return; }
    if (!row.birthday) row.birthday = null;
    await withLoading(btn, async () => {
      try {
        await Data.saveCustomer(row);
        modal.close();
        toast(editing ? 'Cliente atualizado' : 'Cliente cadastrado');
      } catch (err) {
        modal.body.querySelector('[data-erro-txt]').textContent = friendlyError(err);
        modal.body.querySelector('[data-erro]').classList.remove('hide');
      }
    });
  });
}

/* ---------------------------------------------------------- exportação */
/* Chamada pela tela de Ajustes - é lá que ficam todas as exportações. */

export function exportCustomers() {
  const rows = Data.customerStats().map((c) => ({
    Cliente: c.name, Telefone: c.phone, Instagram: c.instagram, Email: c.email, Documento: c.doc,
    Cidade: c.city, UF: c.uf, Aniversario: c.birthday ? formatDate(c.birthday) : '',
    Pedidos: c.orders, TotalGasto: c.spent.toFixed(2).replace('.', ','), AReceber: c.owed.toFixed(2).replace('.', ','),
  }));
  if (!rows.length) { toast('Nada para exportar.', { kind: 'warn' }); return; }
  downloadFile(`clientes-i7even-${todayISO()}.csv`, toCSV(rows), 'text/csv;charset=utf-8');
  toast(`${rows.length} clientes exportados`);
}
