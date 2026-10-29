/**
 * Avisos de vencimento NESTE aparelho (fiado / parcelas).
 *
 * Sem servidor de push: o aviso sai quando o sistema abre (e a cada hora,
 * enquanto aberto) - uma vez por dia, com o que vence hoje e o que está
 * atrasado. Tocar no aviso abre "A receber".
 *   - computador / Android: Notification do navegador;
 *   - iPhone: só com o sistema na Tela de Início (Safari → Compartilhar →
 *     "Adicionar à Tela de Início") - exigência da Apple, iOS 16.4+.
 * O sw.js (raiz) só existe para mostrar o aviso e abrir a tela ao tocar:
 * não guarda nada em cache.
 */

import * as Data from './data.js';
import { money, todayISO } from './utils.js';

const PREF = 'i7even.pref.notify.on';
const LAST = 'i7even.notify.last';

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* modo privado */ } };

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

/** iPhone no Safari (fora da Tela de Início): a Apple não deixa avisar. */
export const needsInstall = () => isIOS() && !standalone();

/** 'on' | 'off' | 'denied' | 'unsupported' */
export function status() {
  if (needsInstall()) return 'off';
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.permission === 'granted' && read(PREF) === '1' ? 'on' : 'off';
}

let swReg = null;
async function registration() {
  if (swReg || !('serviceWorker' in navigator)) return swReg;
  try { swReg = await navigator.serviceWorker.register('sw.js', { scope: './' }); } catch { swReg = null; }
  return swReg;
}

/** Pede a permissão (precisa vir de um toque). */
export async function enable() {
  if (!('Notification' in window)) return 'unsupported';
  const p = await Notification.requestPermission();
  if (p !== 'granted') return p === 'denied' ? 'denied' : 'off';
  write(PREF, '1');
  await registration();
  return 'on';
}

export function disable() { write(PREF, '0'); }

/** Texto do aviso do dia (ou null se não há nada a cobrar). */
export function dailyMessage(sum = Data.receivablesSummary()) {
  const parts = [];
  if (sum.today.n) parts.push(`${sum.today.n} ${sum.today.n === 1 ? 'parcela vence' : 'parcelas vencem'} hoje (${money(sum.today.sum)})`);
  if (sum.late.n) parts.push(`${sum.late.n} ${sum.late.n === 1 ? 'atrasada' : 'atrasadas'} (${money(sum.late.sum)})`);
  if (!parts.length) return null;
  return { title: 'i7even · cobranças de hoje', body: `${parts.join(' · ')}. Toque para ver e cobrar no WhatsApp.` };
}

/**
 * Mostra o aviso do dia, uma vez por dia (force: mostra de novo).
 * @returns {Promise<boolean>} se mostrou.
 */
export async function check({ force = false } = {}) {
  if (status() !== 'on') return false;
  const today = todayISO();
  if (!force && read(LAST) === today) return false;
  const msg = dailyMessage();
  if (!msg) return false;
  write(LAST, today);
  const opts = { body: msg.body, tag: 'i7even-cobrancas', icon: 'assets/brand/i7even-avatar-i7.svg', data: { url: './#/receber' } };
  try {
    const reg = await registration();
    if (reg?.showNotification) { await reg.showNotification(msg.title, opts); return true; }
    const n = new Notification(msg.title, opts);
    n.onclick = () => { window.focus(); location.hash = '#/receber'; n.close(); };
    return true;
  } catch {
    return false;
  }
}

let timer = null;
/** Confere agora, ao voltar para o app e a cada hora. */
export function start() {
  if (timer) return;
  const run = () => { if (!document.hidden) check().catch(() => {}); };
  setTimeout(run, 4000);
  document.addEventListener('visibilitychange', run);
  timer = setInterval(run, 3600000);
}
