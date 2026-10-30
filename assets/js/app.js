/**
 * Ponto de entrada: configuração → login → "sem acesso" → "banco antigo" →
 * aplicativo. Cada tela recebe um container NOVO a cada navegação: os
 * ouvintes ficam nele e somem junto - nada vaza de uma tela para outra.
 */

import { getConfig, APP } from './config.js';
import { getSession, onAuthChange, signOut, updatePassword } from './core/supabase.js';
import * as Data from './core/data.js';
import { STATUS_MAP } from './core/constants.js';
import { friendlyError, isMissingSchema } from './core/errors.js';
import { initTelemetry, setSender, capture } from './core/telemetry.js';

import { initTheme, toggleTheme, isDark, isPrivacy, togglePrivacy } from './ui/theme.js';
import { renderSetup, renderLogin, renderBoot } from './ui/gate.js';
import { icon } from './ui/icons.js';
import { toast, toastError, closeMenu, openModal, withLoading } from './ui/kit.js';
import { initInputs } from './ui/inputs.js';
import { openOrderForm } from './ui/order-form.js';
import { esc, debounce, installThumbFallback } from './core/utils.js';

import * as Dashboard from './ui/dashboard.js';
import * as Orders from './ui/orders.js';
import * as Products from './ui/products.js';
import * as Stock from './ui/stock.js';
import * as Purchases from './ui/purchases.js';
import * as Customers from './ui/customers.js';
import * as Categories from './ui/categories.js';
import * as CatalogAdmin from './ui/catalog-admin.js';
import * as Vitrine from './ui/vitrine.js';
import * as Reports from './ui/reports.js';
import * as Settings from './ui/settings.js';
import * as Receivables from './ui/receivables.js';
import * as Notify from './core/notify.js';

const ROOT = document.getElementById('app');

/*
 * Menu: Loja (o dia a dia) · Estoque · Gestão, com Ajustes por último.
 * `tab: true` = aparece na barra de baixo do celular (Painel, Pedidos,
 * Estoque, Catálogo + "Mais"); o resto fica no "Mais".
 */
const ROUTES = [
  { id: 'dashboard',  label: 'Painel',     icon: 'dashboard', module: Dashboard,    group: 'Loja',    tab: true },
  { id: 'pedidos',    label: 'Pedidos',    icon: 'orders',    module: Orders,       group: 'Loja',    tab: true, search: true },
  { id: 'receber',    label: 'A receber',  icon: 'wallet',    module: Receivables,  group: 'Loja' },
  { id: 'clientes',   label: 'Clientes',   icon: 'users',     module: Customers,    group: 'Loja',    search: true },
  { id: 'estoque',    label: 'Estoque',    icon: 'layers',    module: Stock,        group: 'Estoque', tab: true, search: true },
  { id: 'produtos',   label: 'Produtos',   icon: 'box',       module: Products,     group: 'Estoque', search: true },
  { id: 'entradas',   label: 'Entradas',   icon: 'truck',     module: Purchases,    group: 'Estoque' },
  { id: 'catalogo',   label: 'Catálogo',   icon: 'store',     module: CatalogAdmin, group: 'Gestão',  tab: true },
  { id: 'vitrine',    label: 'Vitrine',    icon: 'image',     module: Vitrine,      group: 'Gestão',  search: true },
  { id: 'categorias', label: 'Categorias', icon: 'grid',      module: Categories,   group: 'Gestão' },
  { id: 'relatorios', label: 'Relatórios', icon: 'chart',     module: Reports,      group: 'Gestão' },
  { id: 'ajustes',    label: 'Ajustes',    icon: 'settings',  module: Settings,     group: '' },
];

let current = null;        // view montada no momento
let currentId = null;
let globalsWired = false;  // ouvintes de documento/janela já registrados?
let pendingSearch = null;  // busca a aplicar assim que a próxima tela montar
let authWired = false;      // ouvinte de login/logout já ligado?

/* ==================================================================== */
/*  Inicialização                                                        */
/* ==================================================================== */

initTheme();
initInputs();
initTelemetry();
installThumbFallback();
boot();

async function boot() {
  renderBoot(ROOT, 'Iniciando…');

  if (!getConfig()) {
    renderSetup(ROOT, { onDone: boot });
    return;
  }
  wireAuth();

  let session;
  try {
    session = await getSession();
  } catch (err) {
    console.error(err);
    renderSetup(ROOT, { onDone: boot });
    toastError('Não consegui falar com o Supabase', 'Confira a URL e a chave do projeto.');
    return;
  }

  if (!session) {
    renderLogin(ROOT, { onDone: boot });
    return;
  }

  renderBoot(ROOT, 'Conferindo o acesso…');
  let who;
  try {
    who = await Data.whoami();
  } catch (err) {
    console.error(err);
    if (isMissingSchema(err)) renderSchemaHelp({ version: 1 });
    else renderBootError(err);
    return;
  }
  if (!who.member) {
    renderNoAccess(session.user?.email);
    return;
  }
  if ((Number(who.schema_version) || 0) < APP.schemaVersion) {
    renderSchemaHelp({ version: Number(who.schema_version) || 1 });
    return;
  }

  setSender((rows) => Data.sendErrors(rows));

  renderBoot(ROOT, 'Carregando a loja…');
  try {
    await Data.loadAll({ userEmail: session.user?.email || '', memberName: who.name || '' });
  } catch (err) {
    console.error(err);
    if (isMissingSchema(err)) renderSchemaHelp({ version: 1 });
    else renderBootError(err);
    return;
  }

  renderApp();
  startIdleWatch();
  startAutoSync();
  Notify.start();
  setTimeout(dailyDueToast, 1500);
}

/* Avisos de autenticação: sair em outro aparelho, link de "esqueci a senha". */
function wireAuth() {
  if (authWired) return;
  authWired = true;
  onAuthChange((event) => {
    if (event === 'SIGNED_OUT') {
      Data.reset();
      renderLogin(ROOT, { onDone: boot });
    }
    if (event === 'PASSWORD_RECOVERY') openNewPassword();
  });
}
/** Voltou pelo link do e-mail "esqueci minha senha": pede a senha nova. */
function openNewPassword() {
  const m = openModal({
    title: 'Defina sua nova senha',
    subtitle: 'Você entrou pelo link do e-mail',
    body: `
      <div class="form-grid">
        <div class="field span-12"><label class="label" for="np-a">Nova senha</label>
          <input class="input" id="np-a" type="password" autocomplete="new-password" minlength="8" data-autofocus></div>
        <div class="field span-12"><label class="label" for="np-b">Repita a senha</label>
          <input class="input" id="np-b" type="password" autocomplete="new-password" minlength="8"></div>
      </div>
      <div class="alert hide" data-erro data-kind="warn">${icon('alert')}<div data-erro-txt></div></div>`,
    footer: '<button class="btn btn-primary" data-ok>Salvar senha</button>',
  });
  const btn = m.foot.querySelector('[data-ok]');
  btn.addEventListener('click', async () => {
    const a = m.panel.querySelector('#np-a').value;
    const b = m.panel.querySelector('#np-b').value;
    const erro = (t) => { m.panel.querySelector('[data-erro-txt]').textContent = t; m.panel.querySelector('[data-erro]').classList.remove('hide'); };
    if (a.length < 8) { erro('Use pelo menos 8 caracteres.'); return; }
    if (a !== b) { erro('As duas senhas estão diferentes.'); return; }
    await withLoading(btn, async () => {
      try {
        await updatePassword(a);
        m.close();
        toast('Senha atualizada');
        history.replaceState(null, '', location.pathname + location.hash);
      } catch (err) {
        erro(err.message);
      }
    });
  });
}

function gateCard(title, sub, inner) {
  ROOT.innerHTML = `
    <div class="gate"><div class="gate-card wide">
      <div class="gate-brand">
        <div class="brand-mark" role="img" aria-label="i7even Store"></div>
        <div><h1>${esc(title)}</h1><p>${esc(sub)}</p></div>
      </div>
      ${inner}
      <div class="gate-foot"><button class="btn btn-ghost btn-sm" data-logout>Sair da conta</button></div>
    </div></div>`;
  ROOT.querySelector('[data-retry]')?.addEventListener('click', () => location.reload());
  ROOT.querySelector('[data-logout]')?.addEventListener('click', async () => {
    await signOut().catch(() => {});
    location.reload();
  });
}

function renderSchemaHelp({ version }) {
  gateCard('Falta atualizar o banco', `O app está na versão ${APP.version}`, `
    <div class="alert" data-kind="warn">${icon('alert')}
      <div>O banco está na versão <b>${esc(version)}</b> e este app precisa da <b>${esc(APP.schemaVersion)}</b>.
      Nada foi perdido - é só rodar o arquivo de atualização.</div></div>
    <ol class="col gap-3 small muted" style="margin:18px 0;padding-left:18px;list-style:decimal">
      <li>Antes, por segurança: no app antigo, <b>Ajustes → Baixar backup</b> (se ainda tiver acesso).</li>
      <li>Abra o painel do Supabase → <b>SQL Editor</b> → <b>New query</b>.</li>
      <li>Cole o arquivo <code>supabase/schema.sql</code> inteiro e clique em <b>Run</b>.</li>
      <li>Na primeira vez, rode também o <code>supabase/seed_catalogo.sql</code> (categorias e modelos).</li>
    </ol>
    <button class="btn btn-primary btn-block" data-retry>Já rodei, tentar de novo</button>`);
}

function renderNoAccess(email) {
  gateCard('Sem acesso à loja', email || '', `
    <div class="alert" data-kind="warn">${icon('lock')}
      <div>Este login existe, mas não está autorizado no sistema da i7even. Peça para quem administra
      incluir o e-mail em <code>store_members</code> (passo a passo no README).</div></div>
    <button class="btn btn-block" data-retry style="margin-top:16px">Tentar de novo</button>`);
}

function renderBootError(err) {
  gateCard('Não consegui abrir a loja', 'Pode ser a internet ou o Supabase pausado', `
    <div class="alert" data-kind="warn">${icon('alert')}<div>${esc(friendlyError(err))}</div></div>
    <p class="small muted" style="margin:14px 0">Se o Supabase ficou sem uso por dias, o projeto grátis pausa:
      abra o painel do Supabase e clique em <b>Restore project</b>.</p>
    <button class="btn btn-primary btn-block" data-retry>Tentar de novo</button>`);
}

/* ==================================================================== */
/*  Estrutura do aplicativo                                              */
/* ==================================================================== */

function navHTML() {
  let html = '';
  let lastGroup = null;
  for (const r of ROUTES) {
    if (r.group !== lastGroup) {
      if (r.group) html += `<div class="nav-group">${esc(r.group)}</div>`;
      else html += '<div class="nav-sep"></div>';
      lastGroup = r.group;
    }
    html += `
      <button class="nav-item" data-route="${r.id}">
        ${icon(r.icon)}<span>${esc(r.label)}</span>
        ${r.id === 'pedidos' ? '<span class="count" data-open-count hidden>0</span>' : ''}
        ${r.id === 'receber' ? '<span class="count warn" data-due-count hidden>0</span>' : ''}
        ${r.id === 'produtos' ? '<span class="count warn" data-low-count hidden>0</span>' : ''}
        ${r.id === 'catalogo' ? '<span class="count accent" data-req-count hidden>0</span>' : ''}
      </button>`;
  }
  return html;
}

function renderApp() {
  // Moldura nova (login de novo, sessão retomada): a tela da sessão anterior
  // é desmontada e a rota volta do zero - senão route() achava que "já está
  // no Estoque" e deixava a área do meio vazia (a tela preta depois do login).
  try { current?.destroy?.(); } catch (err) { capture(err, { where: 'destroy' }); }
  current = null;
  currentId = null;
  ROOT.innerHTML = `
    <div class="app" data-drawer="closed">
      <aside class="sidebar" aria-label="Menu principal">
        <div class="brand">
          <div class="brand-mark" role="img" aria-label="${esc(APP.name)}"></div>
          <span class="brand-wordmark" role="img" aria-label="${esc(APP.name)}"></span>
        </div>

        <button class="btn btn-primary btn-block" data-new style="margin-bottom:12px">
          ${icon('plus')} Novo pedido
        </button>

        <nav class="nav" data-nav>${navHTML()}</nav>

        <div class="sidebar-foot">
          <button class="user-chip" data-theme-toggle>
            <span class="avatar" data-theme-icon></span>
            <span class="grow small">Tema ${isDark() ? 'escuro' : 'claro'}</span>
          </button>
          <button class="user-chip" data-privacy-toggle>
            <span class="avatar" data-privacy-icon></span>
            <span class="grow small">${isPrivacy() ? 'Valores ocultos' : 'Valores visíveis'}</span>
          </button>
        </div>
      </aside>

      <div class="main">
        <header class="topbar">
          <button class="icon-btn only-mobile" data-drawer-toggle aria-label="Abrir menu">${icon('menu')}</button>
          <h1 class="page-title" data-title>Painel</h1>
          <span class="grow"></span>
          <div class="search" data-search-wrap>
            ${icon('search')}
            <input class="input" type="search" placeholder="Buscar…" data-search aria-label="Buscar"
                   autocomplete="off" enterkeyhint="search">
            <kbd>/</kbd>
          </div>
          <button class="icon-btn" data-refresh aria-label="Atualizar" title="Atualizar">${icon('refresh')}</button>
          <button class="icon-btn hide-mobile" data-privacy-toggle aria-label="Modo privacidade"
                  data-privacy-icon></button>
          <button class="icon-btn hide-mobile" data-theme-toggle aria-label="Trocar tema" data-theme-icon></button>
        </header>

        <main class="content" data-view></main>
      </div>

      <nav class="tabbar" data-tabbar aria-label="Navegação">
        ${ROUTES.filter((r) => r.tab).map((r) => `
          <button data-route="${r.id}">${icon(r.icon)}<span>${esc(r.label)}</span></button>`).join('')}
        <button data-drawer-toggle aria-label="Mais opções">${icon('menu')}<span>Mais</span></button>
      </nav>

      <button class="fab" data-new aria-label="Novo pedido" title="Novo pedido">${icon('plus')}</button>
    </div>`;

  wireShell();
  route(location.hash.slice(2) || 'dashboard');
}

const SEARCH_HINT = {
  pedidos: 'Buscar pedido, cliente, IMEI…',
  clientes: 'Buscar cliente ou telefone…',
  produtos: 'Buscar modelo, IMEI, código…',
  estoque: 'Buscar modelo, cor, IMEI…',
  vitrine: 'Buscar modelo ou cor…',
};

function newOrder() {
  openOrderForm({ onSaved: () => { updateCounts(); current?.refresh?.(); } });
}

function wireShell() {
  const app = ROOT.querySelector('.app');
  const $search = ROOT.querySelector('[data-search]');

  ROOT.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-route]');
    if (nav) { location.hash = `#/${nav.dataset.route}`; closeDrawer(); return; }

    if (e.target.closest('[data-new]')) { newOrder(); return; }
    // Trocar tema não redesenha o app: as cores vêm de variáveis CSS.
    if (e.target.closest('[data-theme-toggle]')) {
      toggleTheme();
      syncToggleIcons();
      ROOT.querySelectorAll('[data-theme-toggle] .grow').forEach((el) => {
        el.textContent = `Tema ${isDark() ? 'escuro' : 'claro'}`;
      });
      return;
    }
    if (e.target.closest('[data-privacy-toggle]')) {
      const on = togglePrivacy();
      syncToggleIcons();
      ROOT.querySelectorAll('[data-privacy-toggle] .grow').forEach((el) => {
        el.textContent = on ? 'Valores ocultos' : 'Valores visíveis';
      });
      return;
    }
    if (e.target.closest('[data-drawer-toggle]')) {
      app.dataset.drawer = app.dataset.drawer === 'open' ? 'closed' : 'open';
      if (app.dataset.drawer === 'open') addScrim();
      else closeDrawer();
      return;
    }
    if (e.target.closest('[data-refresh]')) refresh();
  });

  $search.addEventListener('input', debounce((e) => {
    current?.onSearch?.(e.target.value);
  }, 180));

  // Ouvintes globais só uma vez: renderApp() pode rodar de novo depois de um
  // logout, e registrá-los outra vez faria o atalho disparar em duplicidade.
  if (!globalsWired) {
    globalsWired = true;

    window.addEventListener('hashchange', () => route(location.hash.slice(2) || 'dashboard'));

    document.addEventListener('keydown', (e) => {
      const input = ROOT.querySelector('[data-search]');
      if (e.target.matches('input, textarea, select')) {
        if (e.key === 'Escape') e.target.blur();
        return;
      }
      if (document.querySelector('dialog.modal[open]')) return;
      if (e.key === '/') { e.preventDefault(); input?.focus(); }
      if (e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        newOrder();
      }
    });

    Data.subscribe(() => updateCounts());
    Data.onNewCatalogRequest((req) => {
      toast(`Pedido pelo catálogo: ${req.customerName}`, { kind: 'info', text: `C${req.number} · toque em Catálogo para ver`, duration: 8000 });
      try { navigator.vibrate?.(120); } catch { /* sem vibração */ }
    });
  }

  syncToggleIcons();
  updateCounts();
}

function syncToggleIcons() {
  ROOT.querySelectorAll('[data-theme-icon]').forEach((el) => {
    el.innerHTML = icon(isDark() ? 'moon' : 'sun');
  });
  ROOT.querySelectorAll('[data-privacy-icon]').forEach((el) => {
    el.innerHTML = icon(isPrivacy() ? 'eyeOff' : 'eye');
  });
}

function setCount(sel, n) {
  ROOT.querySelectorAll(sel).forEach((el) => {
    el.textContent = String(n);
    el.hidden = n === 0;
  });
}

function updateCounts() {
  setCount('[data-open-count]', Data.orders().filter((o) => STATUS_MAP[o.status]?.open).length);
  setCount('[data-low-count]', Data.lowStock().length);
  setCount('[data-req-count]', Data.catalogRequests().filter((r) => r.status === 'novo').length);
  const due = Data.receivablesSummary();
  setCount('[data-due-count]', due.late.n + due.today.n);
}

/* Uma vez por dia, ao abrir: o que vence hoje e o que está atrasado (e o aviso do aparelho, se ligado). */
function dailyDueToast() {
  const msg = Notify.dailyMessage();
  if (!msg) return;
  const key = 'i7even.dueToast';
  try { if (localStorage.getItem(key) === new Date().toDateString()) return; localStorage.setItem(key, new Date().toDateString()); } catch { /* */ }
  toast('Cobranças de hoje', { kind: 'info', text: msg.body.replace('Toque para ver', 'Veja em A receber'), duration: 8000 });
}

function addScrim() {
  const app = ROOT.querySelector('.app');
  if (app.querySelector('.scrim')) return;
  const scrim = document.createElement('div');
  scrim.className = 'scrim only-mobile';
  scrim.addEventListener('click', closeDrawer);
  app.appendChild(scrim);
}

function closeDrawer() {
  const app = ROOT.querySelector('.app');
  if (!app) return;
  app.dataset.drawer = 'closed';
  app.querySelector('.scrim')?.remove();
}

/* ------------------------------------------------------------ roteador */

function route(id, params = {}) {
  const [baseId] = String(id).split('?');
  const found = ROUTES.find((r) => r.id === baseId) || ROUTES[0];
  if (currentId === found.id && !Object.keys(params).length) return;

  closeMenu();
  try { current?.destroy?.(); } catch (err) { capture(err, { where: 'destroy' }); }

  // Container novo a cada tela: ouvintes da tela anterior somem com o antigo.
  const oldHost = ROOT.querySelector('[data-view]');
  const viewHost = oldHost.cloneNode(false);
  oldHost.replaceWith(viewHost);

  const $search = ROOT.querySelector('[data-search]');
  const $title = ROOT.querySelector('[data-title]');

  currentId = found.id;
  $title.textContent = found.label;
  ROOT.querySelector('[data-search-wrap]').classList.toggle('hide', !found.search);
  $search.placeholder = SEARCH_HINT[found.id] || 'Buscar…';
  if (!found.search) $search.value = '';

  ROOT.querySelectorAll('[data-route]').forEach((btn) => {
    if (btn.dataset.route === found.id) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });

  try {
    current = found.module.mount(viewHost, {
      /**
       * Leva para a lista de pedidos já filtrada. A busca fica guardada em
       * `pendingSearch` porque a troca de hash remonta a tela.
       */
      goToOrders(opts = {}) {
        if (opts.search) pendingSearch = opts.search;
        if (opts.status) Orders.setStatusFilter(opts.status);
        if (currentId === 'pedidos') { applyPendingSearch(); current?.refresh?.(); }
        else location.hash = '#/pedidos';
      },
      go(routeId, search) {
        if (search) pendingSearch = search;
        location.hash = `#/${routeId}`;
      },
      clearSearch() {
        pendingSearch = null;
        const input = ROOT.querySelector('[data-search]');
        if (input) input.value = '';
      },
      newOrder,
    }) || {};
  } catch (err) {
    console.error(err);
    capture(err, { where: `mount:${found.id}` });
    viewHost.innerHTML = `<div class="alert" data-kind="warn">${icon('alert')}<div>Esta tela falhou ao abrir: ${esc(err.message)}</div></div>`;
    current = {};
  }

  if (pendingSearch !== null && found.search) applyPendingSearch();
  else if (found.search && $search.value) current.onSearch?.($search.value);

  markDupTitle(viewHost, found.label);

  window.scrollTo({ top: 0, behavior: 'instant' });
}

/*
 * No celular o título já está na barra de cima: o mesmo título repetido no
 * topo da tela some (fica a contagem e os botões). Vale também para a tela
 * que monta depois de carregar (Ajustes) ou que se redesenha inteira.
 */
let titleObserver = null;
function markDupTitle(host, label) {
  titleObserver?.disconnect();
  const mark = () => {
    const h2 = host.querySelector('.section-head h2');
    if (h2 && !h2.classList.contains('is-dup-title') && h2.textContent.trim() === label) h2.classList.add('is-dup-title');
  };
  mark();
  titleObserver = new MutationObserver(mark);
  titleObserver.observe(host, { childList: true, subtree: true });
}

function applyPendingSearch() {
  if (pendingSearch === null) return;
  const input = ROOT.querySelector('[data-search]');
  if (input) input.value = pendingSearch;
  current?.onSearch?.(pendingSearch);
  pendingSearch = null;
}

async function refresh() {
  const btns = ROOT.querySelectorAll('[data-refresh]');
  btns.forEach((b) => { b.disabled = true; b.classList.add('is-spinning'); });
  try {
    await Data.reload();
    current?.refresh?.();
    toast('Tudo atualizado', { duration: 1600 });
  } catch (err) {
    toastError('Não consegui atualizar', friendlyError(err));
  } finally {
    btns.forEach((b) => { b.disabled = false; b.classList.remove('is-spinning'); });
  }
}

/* --------------------------------------------- sincronização automática */
/*
 * O realtime já empurra as mudanças do outro aparelho, mas no celular o
 * navegador derruba a conexão quando a tela bloqueia ou o app vai para o
 * fundo. Ao voltar (ou recuperar a internet), se o canal caiu, busca tudo.
 */

let autoSyncStarted = false;

function startAutoSync() {
  if (autoSyncStarted) return;
  autoSyncStarted = true;
  const sync = () => { if (!document.hidden) Data.refreshIfStale(); };
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('focus', sync);
  window.addEventListener('online', sync);
  window.addEventListener('pageshow', (e) => { if (e.persisted) sync(); });
  setInterval(() => { if (!document.hidden) Data.refreshIfStale(Data.isRealtimeUp() ? 300000 : 30000); }, 30000);
}

/* ------------------------------------------- desconexão por inatividade */

let idleWired = false;
function startIdleWatch() {
  if (!APP.idleLogoutMinutes || idleWired) return;
  idleWired = true;   // um vigia só, por mais que se entre e saia sem recarregar
  const limit = APP.idleLogoutMinutes * 60 * 1000;
  let timer;

  const reset = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      await signOut().catch(() => {});
      Data.reset();
      renderLogin(ROOT, { onDone: boot });
      toast('Sessão encerrada por inatividade', { kind: 'info', duration: 6000 });
    }, limit);
  };

  ['pointerdown', 'keydown', 'visibilitychange'].forEach((evt) => {
    document.addEventListener(evt, reset, { passive: true });
  });
  reset();
}
