/**
 * Cadastro rápido: do zero ao catálogo numa tela só, pensando no dia a dia.
 *
 *   categoria → modelo (escolhe um do cadastro ou digita um novo) → pronta
 *   entrega ou encomenda → condição → capacidades e cores (toques) → preço
 *   por capacidade → quantidade → foto (opcional) → "Publicar".
 *
 * IMEI, bateria, custo e o resto ficam para depois (são opcionais). Por
 * baixo é a mesma gravação da lista do WhatsApp (import_order_list): cria as
 * variações que faltam, põe o estoque (aparelho sem IMEI) ou a oferta de
 * encomenda, e deixa o modelo à mostra no catálogo na hora.
 */

import * as Data from '../core/data.js';
import { CONDITIONS } from '../core/constants.js';
import { friendlyError } from '../core/errors.js';
import { esc, money, parseMoney, moneyInputValue } from '../core/utils.js';
import { openModal, toast, toastError, withLoading, confirmDialog } from './kit.js';
import { icon } from './icons.js';
import { pref, setPref, mountPhotoField } from './common.js';

const MONEY_ATTRS = 'inputmode="numeric" autocomplete="off" placeholder="0,00"';
const norm = (s) => String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

export function openQuickProduct({ productId = null, categoryId = null, onDone } = {}) {
  const p0 = productId ? Data.product(productId) : null;
  const cats = Data.categories().filter((c) => c.active);
  const s = {
    categoryId: p0?.categoryId || categoryId || pref('quick.cat', cats.find((c) => c.slug === 'iphone')?.id || cats[0]?.id || null),
    name: p0?.name || '',
    photo: null,
    mode: pref('quick.mode', 'pronta'),
    lead: pref('olist.lead', '7 a 15 dias'),
    condition: pref('quick.cond', 'Lacrado'),
    sizes: new Set(),       // versão / caixa (PS5 com leitor ou digital, Watch 42mm...)
    storages: new Set(),
    colors: new Set(),
    extraStorages: [],
    extraColors: [],
    prices: {},          // "versão|capacidade" → preço
    qty: 1,
  };
  const current = () => Data.products().find((p) => p.active !== false && norm(p.name) === norm(s.name)
    && (!s.categoryId || p.categoryId === s.categoryId || !p.categoryId)) || null;

  const modal = openModal({
    title: p0 ? `Vender ${p0.name}` : 'Cadastro rápido',
    subtitle: 'Publica direto no catálogo - IMEI, bateria e custo são opcionais',
    size: 'lg',
    body: '<div data-q></div>',
    footer: `<button class="btn btn-ghost" data-full>${icon('edit')}<span>Cadastro completo</span></button><span class="grow"></span>
      <button class="btn btn-primary" data-ok>${icon('store')} Publicar no catálogo</button>`,
    beforeClose: async () => {
      if (!s.name && !s.storages.size && !s.colors.size) return true;
      return confirmDialog({ title: 'Descartar?', message: 'Nada foi publicado ainda.', confirmText: 'Descartar', cancelText: 'Continuar', danger: true });
    },
  });
  const $q = modal.body.querySelector('[data-q]');
  let photo = null;

  function render() {
    const p = current();
    const cat = Data.category(s.categoryId);
    const models = Data.products().filter((x) => x.active !== false && (!s.categoryId || x.categoryId === s.categoryId))
      .sort((a, b) => (b.year || 0) - (a.year || 0) || a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
    const storages = [...new Set([...(p?.storages || []), ...s.extraStorages])];
    const colors = [...new Set([...(p?.colors || []), ...s.extraColors])].filter((c) => !/^outra cor$/i.test(c));
    const enc = s.mode === 'encomenda';
    const sizes = p?.sizes || [];
    const combos = priceKeys();
    $q.innerHTML = `
      ${p0 ? '' : `
        <div class="field"><span class="label">Categoria</span>
          <div class="chips">${cats.map((c) => `<button type="button" class="chip sm" data-cat="${esc(c.id)}" aria-pressed="${c.id === s.categoryId}">${esc(c.emoji || '')} ${esc(c.name)}</button>`).join('')}</div></div>
        <div class="field"><label class="label" for="qp-name">Modelo</label>
          <input class="input" id="qp-name" list="qp-models" maxlength="120" value="${esc(s.name)}" placeholder="ex.: iPhone 16 Pro Max" autocomplete="off" data-autofocus>
          <datalist id="qp-models">${models.map((m) => `<option value="${esc(m.name)}">`).join('')}</datalist>
          <div class="hint">${s.name ? (p ? `${icon('checkCircle')} Modelo do cadastro: as opções já aparecem abaixo.` : `${icon('plus')} Modelo novo: será criado com o que você marcar.`) : 'Escolha da lista ou digite um modelo novo.'}</div></div>`}

      <div class="qp-modes" role="radiogroup">
        <button type="button" class="qp-mode" role="radio" data-mode="pronta" aria-checked="${!enc}">${icon('checkCircle')}<span><b>Pronta entrega</b><small>Tenho na loja</small></span></button>
        <button type="button" class="qp-mode" role="radio" data-mode="encomenda" aria-checked="${enc}">${icon('truck')}<span><b>Sob encomenda</b><small>Chega no prazo</small></span></button>
      </div>

      <div class="field"><span class="label">Condição</span>
        <div class="chips">${CONDITIONS.map((c) => `<button type="button" class="chip sm" data-cond="${esc(c)}" aria-pressed="${c === s.condition}">${esc(c)}</button>`).join('')}</div></div>

      ${sizes.length ? `
        <div class="field"><span class="label">${esc(cat?.sizeLabel && cat.sizeLabel !== 'Tamanho' ? cat.sizeLabel : 'Versão')} <span class="dim">(toque para marcar)</span></span>
          <div class="chips">${sizes.map((x) => `<button type="button" class="chip sm" data-sz="${esc(x)}" aria-pressed="${s.sizes.has(x)}">${esc(x)}</button>`).join('')}</div></div>` : ''}

      <div class="field"><span class="label">${esc(cat?.variantLabel || 'Capacidade')} <span class="dim">(toque para marcar)</span></span>
        <div class="chips">
          ${storages.map((x) => `<button type="button" class="chip sm" data-st="${esc(x)}" aria-pressed="${s.storages.has(x)}">${esc(x)}</button>`).join('')}
          <input class="input chip-input" data-new="st" maxlength="40" placeholder="+ outra" aria-label="Outra capacidade" enterkeyhint="done">
        </div></div>

      <div class="field"><span class="label">${esc(cat?.colorLabel || 'Cores')} <span class="dim">(marque as que tem)</span></span>
        <div class="chips">
          ${colors.map((x) => `<button type="button" class="chip sm" data-co="${esc(x)}" aria-pressed="${s.colors.has(x)}">${esc(x)}</button>`).join('')}
          <input class="input chip-input" data-new="co" maxlength="40" placeholder="+ outra cor" aria-label="Outra cor" enterkeyhint="done">
        </div></div>

      <div class="qp-prices">
        ${combos.map((k) => `
          <div class="field"><label class="label">Preço${k.replace('|', ' ').trim() ? ` · ${esc(k.split('|').filter(Boolean).join(' · '))}` : ''}${enc ? ' (encomenda)' : ''}</label>
            <div class="money-input"><input class="input" data-price="${esc(k)}" ${MONEY_ATTRS} value="${esc(moneyInputValue(s.prices[k] || 0))}"></div></div>`).join('')}
        ${enc
          ? `<div class="field"><label class="label" for="qp-lead">Prazo</label><input class="input" id="qp-lead" maxlength="40" value="${esc(s.lead)}"></div>`
          : `<div class="field"><label class="label" for="qp-qty">Quantidade de cada cor</label>
              <input class="input" id="qp-qty" type="number" inputmode="numeric" min="1" max="99" value="${esc(s.qty)}"></div>`}
      </div>

      <div class="field"><span class="label">Foto do modelo <span class="dim">(opcional - fundo branco fica melhor)</span></span><div data-photo></div></div>
      <p class="xs dim" data-summary>${summary()}</p>`;
    photo?.dispose?.();
    photo = mountPhotoField($q.querySelector('[data-photo]'), { value: s.photo ?? p?.imageUrl ?? '', onChange: (u) => { s.photo = u; } });
  }

  /** Um preço por versão × capacidade marcadas ("" quando o modelo não tem a opção). */
  function priceKeys() {
    const sz = s.sizes.size ? [...s.sizes] : [''];
    const st = s.storages.size ? [...s.storages] : [''];
    return sz.flatMap((a) => st.map((b) => `${a}|${b}`));
  }

  function summary() {
    const n = Math.max(s.sizes.size, 1) * Math.max(s.storages.size, 1) * Math.max(s.colors.size, 1);
    if (!s.colors.size && !s.storages.size) return 'Marque pelo menos uma capacidade ou cor.';
    return `${n} ${n === 1 ? 'versão' : 'versões'} no catálogo${s.mode === 'pronta' ? ` · ${n * s.qty} un. no estoque` : ''}.`;
  }

  /** "+ outra": digitou e deu Enter (ou saiu do campo) → vira uma opção marcada. */
  function addNew(el) {
    const v = el.value.trim();
    if (!v) return;
    if (el.dataset.new === 'st') { if (!s.extraStorages.includes(v)) s.extraStorages.push(v); s.storages.add(v); }
    else { if (!s.extraColors.includes(v)) s.extraColors.push(v); s.colors.add(v); }
    render();
  }
  modal.body.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-new]')) { e.preventDefault(); e.stopPropagation(); addNew(e.target); }
  }, true);
  modal.body.addEventListener('change', (e) => {
    if (e.target.matches('[data-new]')) addNew(e.target);
    if (e.target.id === 'qp-name') { s.name = e.target.value; render(); }
  });

  modal.body.addEventListener('click', (e) => {
    const t = e.target;
    const c = t.closest('[data-cat]');
    if (c) { s.categoryId = c.dataset.cat; render(); return; }
    const m = t.closest('[data-mode]');
    if (m) { s.mode = m.dataset.mode; render(); return; }
    const cd = t.closest('[data-cond]');
    if (cd) { s.condition = cd.dataset.cond; modal.body.querySelectorAll('[data-cond]').forEach((b) => b.setAttribute('aria-pressed', String(b === cd))); return; }
    const sz = t.closest('[data-sz]');
    if (sz) { const v = sz.dataset.sz; if (s.sizes.has(v)) s.sizes.delete(v); else s.sizes.add(v); render(); return; }
    const st = t.closest('[data-st]');
    if (st) { const v = st.dataset.st; if (s.storages.has(v)) s.storages.delete(v); else s.storages.add(v); render(); return; }
    const co = t.closest('[data-co]');
    if (co) {
      const v = co.dataset.co;
      if (s.colors.has(v)) s.colors.delete(v); else s.colors.add(v);
      co.setAttribute('aria-pressed', String(s.colors.has(v)));
      modal.body.querySelector('[data-summary]').textContent = summary();
      return;
    }
  });
  modal.body.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'qp-name') { s.name = t.value; return; }
    if (t.matches('[data-price]')) s.prices[t.dataset.price] = parseMoney(t.value);
    if (t.id === 'qp-qty') { s.qty = Math.min(Math.max(Math.trunc(Number(t.value)) || 1, 1), 99); modal.body.querySelector('[data-summary]').textContent = summary(); }
    if (t.id === 'qp-lead') s.lead = t.value;
  });

  modal.foot.querySelector('[data-full]').addEventListener('click', async () => {
    modal.close();
    const { openProductForm } = await import('./products.js');
    const p = current();
    openProductForm(p || { categoryId: s.categoryId, name: s.name });
  });

  modal.foot.querySelector('[data-ok]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const name = String(s.name || '').trim();
    if (!name) { toast('Escolha ou digite o modelo', { kind: 'warn' }); modal.body.querySelector('#qp-name')?.focus(); return; }
    if (!s.storages.size && !s.colors.size) { toast('Marque a capacidade e/ou as cores', { kind: 'warn' }); return; }
    const sts = s.storages.size ? [...s.storages] : [''];
    const pSizes = current()?.sizes || [];
    if (pSizes.length > 1 && !s.sizes.size) { toast('Marque a versão', { kind: 'warn' }); return; }
    const keys = priceKeys();
    const missing = keys.filter((k) => !(s.prices[k] > 0));
    if (missing.length) { toast(`Informe o preço${missing[0].replace('|', '') ? ` de ${missing[0].split('|').filter(Boolean).join(' · ')}` : ''}`, { kind: 'warn' }); return; }
    if (photo?.busy) return;
    await withLoading(btn, async () => {
      try {
        let p = current();
        const cat = Data.category(s.categoryId);
        const mergedSt = [...new Set([...(p?.storages || []), ...sts.filter(Boolean)])];
        const mergedCo = [...new Set([...(p?.colors || []), ...s.colors])];
        const needSave = !p || mergedSt.length !== (p.storages || []).length || mergedCo.length !== (p.colors || []).length
          || (s.photo && s.photo !== p.imageUrl);
        if (needSave) {
          p = await Data.saveProduct({
            ...(p || { name, categoryId: s.categoryId, tracksSerial: !!cat?.tracksSerial, brand: /iphone|ipad|mac|watch|airpods/i.test(name) ? 'Apple' : '', year: new Date().getFullYear() }),
            storages: mergedSt, colors: mergedCo, showInCatalog: true, active: true,
            imageUrl: s.photo || p?.imageUrl || '',
          });
        }
        const items = [];
        for (const k of keys) {
          const [size, st] = k.split('|');
          for (const co of (s.colors.size ? [...s.colors] : [''])) {
            items.push({ productId: p.id, storage: st, color: co, size, condition: s.condition, cost: 0, price: s.prices[k], qty: s.mode === 'pronta' ? s.qty : null });
          }
        }
        const res = await Data.importOrderList({ mode: s.mode, lead: s.lead, items });
        for (const k of [['quick.cat', s.categoryId], ['quick.mode', s.mode], ['quick.cond', s.condition]]) setPref(k[0], k[1]);
        photo?.dispose?.();
        modal.close();
        toast(`${p.name} no catálogo`, { text: `${items.length} ${items.length === 1 ? 'versão' : 'versões'}${res.units ? ` · ${res.units} un. no estoque` : ''} · a partir de ${money(Math.min(...keys.map((k) => s.prices[k])))}` });
        if (!Data.settings().catalogEnabled) {
          const open = await confirmDialog({ title: 'O catálogo está fechado', message: 'O produto foi publicado, mas o catálogo está fechado para os clientes. Abrir agora?', confirmText: 'Abrir catálogo' });
          if (open) await Data.saveSettings({ catalogEnabled: true }).catch((err) => toastError('Não foi possível abrir', friendlyError(err)));
        }
        onDone?.(p);
      } catch (err) {
        toastError('Não foi possível publicar', friendlyError(err));
      }
    });
  });

  render();
  return modal;
}
