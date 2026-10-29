// Ambiente dos testes de navegador: o app no Chrome (emulando iPhone ou
// computador) falando com o supabase/schema.sql DE VERDADE, num PGlite aqui
// no Node. Nada vai para o Supabase real.
//
//   - assets/js/core/supabase.js é trocado por tests/e2e/mock-supabase.js,
//     que traduz as chamadas do app em SQL (window.__sql → PGlite, papel
//     "authenticated" de um membro da loja);
//   - o catálogo público (fetch para /rest/v1/rpc/...) roda como "anon";
//   - fotos enviadas ficam na memória e são servidas na URL do Storage.
//
// Precisa do Chrome instalado (CHROME_PATH para outro caminho) e do app
// servido em http://localhost:8765 (python -m http.server 8765 na raiz).

import { chromium, devices } from 'playwright-core';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const BASE = process.env.APP_URL || 'http://localhost:8765/';
export const SHOTS = fileURLToPath(new URL('../out/shots/', import.meta.url));
fs.mkdirSync(SHOTS, { recursive: true });
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

export async function createDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text unique);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
    create publication supabase_realtime;
  `);
  const eder = (await db.query(`insert into auth.users (email) values ('eder.pontes2014@gmail.com') returning id`)).rows[0].id;
  await db.query(`insert into auth.users (email) values ('juluccas1609@gmail.com')`);
  const strip = (s) => s.replace(/create extension if not exists pgcrypto;/, '');
  await db.exec(strip(fs.readFileSync(ROOT + 'supabase/schema.sql', 'utf8')));
  await db.exec(fs.readFileSync(ROOT + 'supabase/seed_catalogo.sql', 'utf8'));
  // Loja com WhatsApp, Pix e catálogo aberto (o roteiro testa também fechado).
  await db.exec(`update public.store_settings set phone = '44999990000', instagram = '@i7evenstore', pix_key = 'pix@i7even.com',
    address = 'Maringá - PR', footer_text = 'Obrigado pela preferência!' where id = 1`);

  // Uma fila: cada chamada troca de papel antes de rodar (PGlite tem uma conexão só).
  let chain = Promise.resolve();
  const exec = (role, uid, sql, params) => {
    const job = chain.then(async () => {
      await db.exec('reset role');
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
      await db.exec(`set role ${role}`);
      try {
        const r = await db.query(sql, params);
        return { rows: r.rows };
      } catch (e) {
        return { error: { message: e.message, code: e.code, details: e.detail || null } };
      } finally {
        await db.exec('reset role');
      }
    });
    chain = job.catch(() => {});
    return job;
  };
  return { db, eder, exec };
}

/**
 * Abre o navegador já ligado ao banco.
 * @param {{device?: string, page?: string}} opts
 */
export async function open(env, { device = 'iPhone 13', path = '' } = {}) {
  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ ...(device === 'Desktop' ? { viewport: { width: 1366, height: 860 } } : devices[device]) });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  page.on('dialog', (d) => d.dismiss().catch(() => {}));

  const uploads = env.uploads || (env.uploads = new Map());
  await page.exposeFunction('__sql', (sql, params) => env.exec('authenticated', env.eder, sql, params));
  await page.exposeFunction('__upload', (p, type, b64) => { uploads.set(p, { type, body: Buffer.from(b64, 'base64') }); return true; });
  await page.exposeFunction('__removeUploads', (paths) => { paths.forEach((p) => uploads.delete(p)); return true; });

  const mock = fs.readFileSync(new URL('./mock-supabase.js', import.meta.url), 'utf8');
  await page.route('**/assets/js/core/supabase.js', (r) => r.fulfill({ contentType: 'text/javascript', body: mock }));
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', (r) => r.abort());
  await page.route('https://wa.me/**', (r) => r.fulfill({ contentType: 'text/html', body: '<p>whatsapp</p>' }));
  await page.route('https://teste.supabase.co/storage/v1/object/public/produtos/**', (r) => {
    const p = decodeURIComponent(new URL(r.request().url()).pathname.split('/produtos/')[1]);
    const f = uploads.get(p);
    return f ? r.fulfill({ contentType: f.type, body: f.body }) : r.fulfill({ status: 404, body: '' });
  });
  // Catálogo público: as duas funções, como visitante anônimo.
  await page.route('https://*.supabase.co/rest/v1/rpc/**', async (r) => {
    const fn = new URL(r.request().url()).pathname.split('/rpc/')[1];
    const body = JSON.parse(r.request().postData() || '{}');
    const names = Object.keys(body);
    const sql = `select to_jsonb(public.${fn}(${names.map((k, i) => `${k} => $${i + 1}`).join(', ')})) as v`;
    const res = await env.exec('anon', null, fn === 'log_client_error' ? sql.replace('to_jsonb(', '(').replace(') as v', ')::text as v') : sql,
      names.map((k) => JSON.stringify(body[k])));
    if (res.error) return r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify(res.error) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(res.rows[0]?.v ?? null) });
  });

  await page.goto(BASE + path);
  return { browser, page, errors };
}

/** PNG de teste gerado no navegador (foto "do produto"). */
export async function makePng(page, { w = 900, h = 1300, color = '#2b5c9e', label = 'iPhone' } = {}) {
  const b64 = await page.evaluate(({ w, h, color, label }) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#eeeeee'; g.fillRect(0, 0, w, h);
    g.fillStyle = color;
    g.beginPath(); g.roundRect(w * 0.2, h * 0.08, w * 0.6, h * 0.84, 60); g.fill();
    g.fillStyle = '#fff'; g.font = `bold ${Math.round(w / 9)}px sans-serif`; g.textAlign = 'center'; g.fillText(label, w / 2, h / 2);
    return c.toDataURL('image/png').split(',')[1];
  }, { w, h, color, label });
  return { name: `${label}.png`, mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
}

/** Auditoria rápida da tela: rolagem lateral, campos < 16 px e alvos de toque < 40 px (celular). */
export async function audit(page, label, { mobile = true } = {}) {
  return page.evaluate(({ label, mobile }) => {
    const issues = [];
    const vw = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > vw + 1) issues.push(`${label}: rolagem lateral (${document.documentElement.scrollWidth} > ${vw})`);
    for (const d of document.querySelectorAll('dialog[open]')) if (d.scrollWidth > d.clientWidth + 1 && getComputedStyle(d).overflowX !== 'hidden') issues.push(`${label}: modal com rolagem lateral`);
    if (mobile) {
      const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
      for (const el of document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]):not([hidden]), select, textarea')) {
        if (visible(el) && parseFloat(getComputedStyle(el).fontSize) < 16) issues.push(`${label}: campo com fonte ${getComputedStyle(el).fontSize} (${el.id || el.name || el.className})`);
      }
      const top = document.querySelector('dialog[open]:last-of-type') || document;
      for (const el of top.querySelectorAll('button, a.btn, .chip, label.btn')) {
        if (!visible(el) || el.closest('.cat-dots-nav, .photo-dots, .gallery-tools, .cat-order, [data-dot]')) continue;
        const r = el.getBoundingClientRect();
        if (r.height < 36 || r.width < 36) issues.push(`${label}: toque pequeno ${Math.round(r.width)}×${Math.round(r.height)} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}"`);
      }
    }
    return [...new Set(issues)].slice(0, 12);
  }, { label, mobile });
}
