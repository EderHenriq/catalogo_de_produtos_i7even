/** Ponto de entrada: decide entre configuração, login e o aplicativo. */

import { getConfig, APP } from './config.js';
import { getSession, onAuthChange, signOut } from './core/supabase.js';
import * as Store from './core/store.js';
import { STATUS_MAP } from './core/constants.js';

import { initTheme, toggleTheme, isDark, isPrivacy, togglePrivacy } from './ui/theme.js';
import { renderSetup, renderLogin, renderBoot } from './ui/gate.js';
import { icon } from './ui/icons.js';
import { toast, toastError, closeMenu } from './ui/kit.js';
import { initInputs } from './ui/inputs.js';
import { openOrderForm } from './ui/order-form.js';
import { esc, debounce } from './core/utils.js';

import * as Dashboard from './ui/dashboard.js';
import * as Orders from './ui/orders.js';
import * as Customers from './ui/customers.js';
import * as Reports from './ui/reports.js';
import * as Settings from './ui/settings.js';

const ROOT = document.getElementById('app');

const ROUTES = [
  { id: 'dashboard', label: 'Painel',      icon: 'dashboard', module: Dashboard, search: false },
  { id: 'pedidos',   label: 'Pedidos',     icon: 'orders',    module: Orders,    search: true },
  { id: 'clientes',  label: 'Clientes',    icon: 'users',     module: Customers, search: true },
  { id: 'relatorios', label: 'Relatórios', icon: 'chart',     module: Reports,   search: false },
  { id: 'ajustes',   label: 'Ajustes',     icon: 'settings',  module: Settings,  search: false },
];

let current = null;        // view montada no momento
let currentId = null;
let globalsWired = false;  // ouvintes de documento/janela já registrados?
let pendingSearch = null;  // busca a aplicar assim que a próxima tela montar

/* ==================================================================== */
/*  Inicialização                                                        */
/* ==================================================================== */

initTheme();
initInputs();
boot();

async function boot() {
  renderBoot(ROOT, 'Iniciando…');

  if (!getConfig()) {
    renderSetup(ROOT, { onDone: boot });
    return;
  }

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

  renderBoot(ROOT, 'Carregando os pedidos…');
  Store.setCurrentUser(session.user?.email);
  try {
    await Store.load({ force: true });
  } catch (err) {
    console.error(err);
    // Erro típico: a tabela ainda não foi criada no banco.
    renderSchemaHelp(err);
    return;
  }

  Store.startRealtime();
  renderApp();
  startIdleWatch();
  startAutoSync();

  onAuthChange((event) => {
    if (event === 'SIGNED_OUT') {
      Store.reset();
      renderLogin(ROOT, { onDone: boot });
    }
  });
}

function renderSchemaHelp(err) {
  ROOT.innerHTML = `
    <div class="gate"><div class="gate-card wide">
      <div class="gate-brand">
        <div class="brand-mark" role="img" aria-label="i7even Store"></div>
        <div><h1>Falta criar a tabela</h1><p>Um passo e está pronto</p></div>
      </div>
      <div class="alert" data-kind="warn">${icon('alert')}
        <div>O Supabase respondeu: <code>${esc(err.message || 'erro desconhecido')}</code></div></div>
      <ol class="col gap-3 small muted" style="margin:18px 0;padding-left:18px;list-style:decimal">
        <li>Abra o painel do Supabase → <b>SQL Editor</b>.</li>
        <li>Cole o conteúdo do arquivo <code>supabase/schema.sql</code> deste projeto.</li>
        <li>Clique em <b>Run</b> e volte aqui.</li>
      </ol>
      <button class="btn btn-primary btn-block" data-retry>Já rodei, tentar de novo</button>
      <div class="gate-foot"><button class="btn btn-ghost btn-sm" data-logout>Sair da conta</button></div>
    </div></div>`;
  ROOT.querySelector('[data-retry]')?.addEventListener('click', () => location.reload());
  ROOT.querySelector('[data-logout]')?.addEventListener('click', async () => {
    await signOut();
    location.reload();
  });
}

/* ==================================================================== */
/*  Estrutura do aplicativo                                              */
/* ==================================================================== */

function renderApp() {
  ROOT.innerHTML = `
    <div class="app" data-drawer="closed">
      <aside class="sidebar" aria-label="Menu principal">
        <div class="brand">
          <div class="brand-mark" role="img" aria-label="${esc(APP.name)}"></div>
          <div>
            <span class="brand-wordmark" role="img" aria-label="${esc(APP.name)}"></span>
            <div class="brand-sub">${esc(APP.subtitle)}</div>
          </div>
        </div>

        <button class="btn btn-primary btn-block" data-new style="margin-bottom:12px">
          ${icon('plus')} Novo pedido
        </button>

        <nav class="nav" data-nav>
          ${ROUTES.map((r) => `
            <button class="nav-item" data-route="${r.id}">
              ${icon(r.icon)}<span>${esc(r.label)}</span>
              ${r.id === 'pedidos' ? '<span class="count" data-open-count>0</span>' : ''}
            </button>`).join('')}
        </nav>

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
            <input class="input" type="search" placeholder="Buscar pedido, cliente, IMEI…"
                   data-search aria-label="Buscar" autocomplete="off">
            <kbd>/</kbd>
          </div>
          <button class="icon-btn" data-refresh aria-label="Atualizar pedidos" title="Atualizar pedidos">${icon('refresh')}</button>
          <button class="icon-btn hide-mobile" data-privacy-toggle aria-label="Modo privacidade"
                  data-privacy-icon></button>
          <button class="icon-btn hide-mobile" data-theme-toggle aria-label="Trocar tema" data-theme-icon></button>
        </header>

        <main class="content" data-view></main>
      </div>

      <nav class="tabbar" data-tabbar aria-label="Navegação">
        ${ROUTES.filter((r) => r.id !== 'ajustes').map((r) => `
          <button data-route="${r.id}">${icon(r.icon)}<span>${esc(r.label)}</span></button>`).join('')}
        <button data-route="ajustes">${icon('settings')}<span>Ajustes</span></button>
      </nav>

      <button class="fab" data-new aria-label="Novo pedido" title="Novo pedido">${icon('plus')}</button>
    </div>`;

  wireShell();
  route(location.hash.slice(2) || 'dashboard');
}

function wireShell() {
  const app = ROOT.querySelector('.app');
  const $search = ROOT.querySelector('[data-search]');

  // Navegação
  ROOT.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-route]');
    if (nav) { location.hash = `#/${nav.dataset.route}`; closeDrawer(); return; }

    if (e.target.closest('[data-new]')) {
      openOrderForm({ onSaved: () => { updateCounts(); current?.refresh?.(); } });
      return;
    }
    // Trocar tema não redesenha o app: as cores vêm de variáveis CSS e os
    // gráficos as leem direto, então basta acertar ícones e rótulos.
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
      if (e.key === '/') { e.preventDefault(); input?.focus(); }
      if (e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        openOrderForm({ onSaved: () => { updateCounts(); current?.refresh?.(); } });
      }
    });

    Store.subscribe(() => updateCounts());
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

function updateCounts() {
  const open = Store.all().filter((o) => STATUS_MAP[o.status]?.open).length;
  ROOT.querySelectorAll('[data-open-count]').forEach((el) => {
    el.textContent = String(open);
    el.hidden = open === 0;
  });
}

function addScrim() {
  const app = ROOT.querySelector('.app');
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
  const found = ROUTES.find((r) => r.id === id) || ROUTES[0];
  if (currentId === found.id && !Object.keys(params).length) return;

  closeMenu();
  current?.destroy?.();

  const viewHost = ROOT.querySelector('[data-view]');
  const $search = ROOT.querySelector('[data-search]');
  const $title = ROOT.querySelector('[data-title]');

  currentId = found.id;
  $title.textContent = found.label;
  ROOT.querySelector('[data-search-wrap]').classList.toggle('hide', !found.search);
  if (!found.search) $search.value = '';

  ROOT.querySelectorAll('[data-route]').forEach((btn) => {
    if (btn.dataset.route === found.id) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });

  current = found.module.mount(viewHost, {
    /**
     * Leva para a lista de pedidos já filtrada. A busca fica guardada em
     * `pendingSearch` porque a troca de hash remonta a tela - aplicá-la aqui
     * atingiria a tela antiga.
     */
    goToOrders(opts = {}) {
      if (opts.search) pendingSearch = opts.search;
      if (opts.status) Orders.setStatusFilter(opts.status);
      if (currentId === 'pedidos') { applyPendingSearch(); current?.refresh?.(); }
      else location.hash = '#/pedidos';
    },
    clearSearch() {
      pendingSearch = null;
      const input = ROOT.querySelector('[data-search]');
      if (input) input.value = '';
    },
  });

  if (pendingSearch !== null && found.search) applyPendingSearch();
  else if (found.search && $search.value) current.onSearch?.($search.value);

  // scrollIntoView deixava a página aberta já rolada uns 60px no celular.
  window.scrollTo({ top: 0, behavior: 'instant' });
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
    await Store.load({ force: true });
    current?.refresh?.();
    toast('Pedidos atualizados', { duration: 1600 });
  } catch (err) {
    toastError('Não consegui atualizar', err.message);
  } finally {
    btns.forEach((b) => { b.disabled = false; b.classList.remove('is-spinning'); });
  }
}

/* --------------------------------------------- sincronização automática */
/*
 * O realtime já empurra as mudanças do outro aparelho, mas no celular o
 * navegador derruba a conexão quando a tela bloqueia ou o app vai para o
 * fundo. Por isso a lista também é buscada de novo:
 *  - ao voltar para a aba/app, ao recuperar a internet;
 *  - a cada 20 s enquanto o realtime estiver fora do ar (com ele no ar, a
 *    cada 2 min só como garantia).
 * Se nada mudou, a tela não é redesenhada, e a consulta é a "leve" (só
 * id + data de alteração), que gasta quase nada de dados móveis.
 */

let autoSyncStarted = false;

function startAutoSync() {
  if (autoSyncStarted) return;
  autoSyncStarted = true;

  const sync = (minGapMs) => {
    if (document.hidden || !Store.isLoaded()) return;
    if (Store.msSinceLoad() < minGapMs) return;
    Store.load({ force: true, light: true }).catch((err) => console.warn('sincronização falhou', err));
  };

  document.addEventListener('visibilitychange', () => sync(3000));
  window.addEventListener('focus', () => sync(3000));
  window.addEventListener('online', () => sync(0));
  window.addEventListener('pageshow', (e) => { if (e.persisted) sync(0); });

  setInterval(() => sync(Store.isRealtimeUp() ? 120000 : 20000), 10000);
}

/* ------------------------------------------- desconexão por inatividade */

function startIdleWatch() {
  if (!APP.idleLogoutMinutes) return;
  const limit = APP.idleLogoutMinutes * 60 * 1000;
  let timer;

  const reset = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      await signOut();
      Store.reset();
      renderLogin(ROOT, { onDone: boot });
      toast('Sessão encerrada por inatividade', { kind: 'info', duration: 6000 });
    }, limit);
  };

  ['pointerdown', 'keydown', 'visibilitychange'].forEach((evt) => {
    document.addEventListener(evt, reset, { passive: true });
  });
  reset();
}

/* --------------------------------------------------------- diagnóstico */

window.addEventListener('unhandledrejection', (e) => {
  console.error('Promise rejeitada:', e.reason);
});
