/** Peças de interação reaproveitadas: toasts, modais, confirmação, menus. */

import { icon } from './icons.js';
import { esc } from '../core/utils.js';

/* ------------------------------------------------------------ toasts -- */

let toastHost = null;

function ensureToastHost() {
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.className = 'toasts';
    toastHost.setAttribute('role', 'status');
    toastHost.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastHost);
  }
  return toastHost;
}

const TOAST_ICONS = { success: 'checkCircle', error: 'xCircle', info: 'info', warn: 'alert' };

export function toast(title, { text = '', kind = 'success', duration = 3600 } = {}) {
  const host = ensureToastHost();
  const el = document.createElement('div');
  el.className = 'toast';
  el.dataset.kind = kind;
  el.innerHTML = `
    ${icon(TOAST_ICONS[kind] || 'info')}
    <div class="grow">
      <div class="toast-title">${esc(title)}</div>
      ${text ? `<div class="toast-text">${esc(text)}</div>` : ''}
    </div>`;
  host.appendChild(el);

  const remove = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 180);
  };
  const timer = setTimeout(remove, duration);
  el.addEventListener('click', () => { clearTimeout(timer); remove(); });
  return remove;
}

export const toastError = (title, text) => toast(title, { text, kind: 'error', duration: 6000 });
export const toastInfo = (title, text) => toast(title, { text, kind: 'info' });

/* ------------------------------------------------------------- modal -- */

/**
 * @param {{title: string, subtitle?: string, body: string, footer?: string,
 *          size?: 'sm'|'lg'|'xl', onMount?: (panel: HTMLElement, api: object) => void,
 *          onClose?: () => void}} spec
 */
export function openModal(spec) {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal';
  const sizeClass = spec.size && spec.size !== 'sm' ? ` ${spec.size}` : '';

  dlg.innerHTML = `
    <div class="modal-inner">
      <div class="modal-panel${sizeClass}" role="document">
        <header class="modal-head">
          <div class="grow">
            <h2>${esc(spec.title)}</h2>
            ${spec.subtitle ? `<div class="sub">${esc(spec.subtitle)}</div>` : ''}
          </div>
          <button class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button>
        </header>
        <div class="modal-body">${spec.body}</div>
        ${spec.footer ? `<footer class="modal-foot">${spec.footer}</footer>` : ''}
      </div>
    </div>`;

  document.body.appendChild(dlg);
  document.body.style.overflow = 'hidden';

  const api = {
    el: dlg,
    panel: dlg.querySelector('.modal-panel'),
    body: dlg.querySelector('.modal-body'),
    foot: dlg.querySelector('.modal-foot'),
    close(result) {
      if (!dlg.isConnected) return;
      dlg.close();
      dlg.remove();
      document.body.style.overflow = '';
      spec.onClose?.(result);
    },
  };

  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => api.close()));

  // Clique fora do painel fecha (mas não durante uma seleção de texto arrastada).
  dlg.addEventListener('mousedown', (e) => {
    if (e.target === dlg || e.target.classList.contains('modal-inner')) api.close();
  });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); api.close(); });

  dlg.showModal();
  spec.onMount?.(api.panel, api);

  // Foco no primeiro campo útil.
  requestAnimationFrame(() => {
    const first = api.panel.querySelector('[data-autofocus], input:not([type=hidden]), textarea, select');
    if (first) first.focus();
  });

  return api;
}

/** Confirmação com Promise. Resolve true/false. */
export function confirmDialog({
  title,
  message = '',
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const modal = openModal({
      title,
      body: message ? `<p class="muted" style="font-size:var(--fs-md);line-height:1.6">${esc(message)}</p>` : '',
      footer: `
        <button class="btn" data-cancel>${esc(cancelText)}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm data-autofocus>${esc(confirmText)}</button>`,
      onClose: () => { if (!answered) resolve(false); },
    });
    modal.foot.querySelector('[data-cancel]').addEventListener('click', () => {
      answered = true; modal.close(); resolve(false);
    });
    modal.foot.querySelector('[data-confirm]').addEventListener('click', () => {
      answered = true; modal.close(); resolve(true);
    });
  });
}

/* -------------------------------------------------------- menu popup -- */

/**
 * Menu flutuante ancorado num botão.
 * @param {HTMLElement} anchor
 * @param {{label: string, icon?: string, danger?: boolean, separatorBefore?: boolean,
 *          onSelect: () => void}[]} items
 */
export function openMenu(anchor, items) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = items
    .map((it, i) => `
      ${it.separatorBefore ? '<hr>' : ''}
      <button role="menuitem" data-i="${i}" class="${it.danger ? 'danger' : ''}">
        ${it.icon ? icon(it.icon) : ''}<span>${esc(it.label)}</span>
      </button>`)
    .join('');

  document.body.appendChild(menu);

  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  const left = Math.min(r.right - mw, window.innerWidth - mw - 8);
  const top = r.bottom + mh + 8 > window.innerHeight ? r.top - mh - 6 : r.bottom + 6;
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;

  menu.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-i]');
    if (!btn) return;
    closeMenu();
    items[Number(btn.dataset.i)].onSelect();
  });

  activeMenu = menu;
  setTimeout(() => {
    document.addEventListener('click', onDocClick, { once: true });
    document.addEventListener('keydown', onEsc);
  }, 0);
}

let activeMenu = null;
const onDocClick = () => closeMenu();
const onEsc = (e) => { if (e.key === 'Escape') closeMenu(); };

export function closeMenu() {
  if (!activeMenu) return;
  activeMenu.remove();
  activeMenu = null;
  document.removeEventListener('keydown', onEsc);
}

window.addEventListener('resize', closeMenu);
window.addEventListener('scroll', closeMenu, true);

/* ------------------------------------------------------- estado vazio - */

export function emptyState({ emoji = '📦', title, text = '', action = '' }) {
  return `
    <div class="empty">
      <div class="emoji">${emoji}</div>
      <h3>${esc(title)}</h3>
      ${text ? `<p>${esc(text)}</p>` : ''}
      ${action}
    </div>`;
}

/** Marca um botão como "carregando" enquanto uma promise roda. */
export async function withLoading(button, task) {
  const original = button.innerHTML;
  button.disabled = true;
  button.classList.add('btn-loading');
  button.innerHTML = '';
  try {
    return await task();
  } finally {
    button.disabled = false;
    button.classList.remove('btn-loading');
    button.innerHTML = original;
  }
}
