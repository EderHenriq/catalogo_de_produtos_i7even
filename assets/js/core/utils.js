/** Utilitários gerais: formatação, datas, template seguro contra XSS. */

/* ------------------------------------------------------------------ Moeda */

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const BRL_COMPACT = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1,
});

export function money(value) {
  return BRL.format(Number(value) || 0);
}

export function moneyCompact(value) {
  const n = Number(value) || 0;
  return Math.abs(n) >= 10000 ? BRL_COMPACT.format(n) : BRL.format(n);
}

/** Converte "1.234,56", "1234.56" ou "R$ 1.234,56" em number. */
export function parseMoney(input) {
  if (typeof input === 'number') return input;
  if (!input) return 0;
  let s = String(input).replace(/[^\d,.-]/g, '');
  // Se tem vírgula, ela é o separador decimal (padrão pt-BR).
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/* ------------------------------------------------------------------ Datas */

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function formatDate(value, opts = {}) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', ...opts });
}

export function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

/** "hoje", "ontem", "há 3 dias", "12/03/2025". */
export function relativeDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const days = Math.floor((startOfDay(new Date()) - startOfDay(d)) / 86400000);
  if (days === 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days > 1 && days < 7) return `há ${days} dias`;
  return formatDate(d);
}

export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function startOfMonth(d = new Date()) {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Nº de dias corridos desde a data (usado para destacar pedidos parados). */
export function daysSince(value) {
  if (!value) return 0;
  return Math.floor((startOfDay(new Date()) - startOfDay(new Date(value))) / 86400000);
}

/* -------------------------------------------------------- Template seguro */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapa texto para interpolação em HTML. Use SEMPRE em dado vindo do usuário. */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

const RAW = Symbol('raw');

/** Marca um fragmento como já sanitizado (HTML gerado por nós, não pelo usuário). */
export function raw(str) {
  return { [RAW]: true, value: String(str) };
}

/**
 * Template tag que escapa toda interpolação automaticamente.
 *   html`<p>${nomeDoCliente}</p>`   →  seguro
 *   html`<ul>${raw(itens)}</ul>`    →  insere HTML confiável
 * Arrays são concatenados (cada elemento passa pela mesma regra).
 */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    out += renderValue(values[i]) + strings[i + 1];
  }
  return out;
}

function renderValue(v) {
  if (v === null || v === undefined || v === false) return '';
  if (Array.isArray(v)) return v.map(renderValue).join('');
  if (typeof v === 'object' && v[RAW]) return v.value;
  return esc(v);
}

/* ------------------------------------------------------------------ Texto */

export function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function titleCase(str = '') {
  return String(str).toLowerCase().replace(/(^|\s|')\p{L}/gu, (m) => m.toUpperCase());
}

/** Máscara de telefone brasileiro conforme digita. */
export function maskPhone(value = '') {
  const d = String(value).replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function maskCEP(value = '') {
  const d = String(value).replace(/\D/g, '').slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

export function onlyDigits(value = '') {
  return String(value).replace(/\D/g, '');
}

/** Link do WhatsApp a partir de um telefone brasileiro. */
export function whatsappLink(phone, message = '') {
  const d = onlyDigits(phone);
  if (d.length < 10) return null;
  const full = d.startsWith('55') ? d : `55${d}`;
  const q = message ? `?text=${encodeURIComponent(message)}` : '';
  return `https://wa.me/${full}${q}`;
}

/* ------------------------------------------------------------------ Misc */

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function debounce(fn, wait = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export function sum(list, pick = (x) => x) {
  return list.reduce((acc, item) => acc + (Number(pick(item)) || 0), 0);
}

export function groupBy(list, pick) {
  const map = new Map();
  for (const item of list) {
    const key = pick(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

export function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

/* -------------------------------------------------------------------- CSV */

export function toCSV(rows, headers) {
  const cols = headers || Object.keys(rows[0] ?? {});
  const escape = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(';')];
  for (const row of rows) lines.push(cols.map((c) => escape(row[c])).join(';'));
  // BOM para o Excel brasileiro abrir com acentuação correta.
  return '﻿' + lines.join('\r\n');
}

export function downloadFile(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
