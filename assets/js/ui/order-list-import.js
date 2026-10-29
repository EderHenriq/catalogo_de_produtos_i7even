/**
 * "Colar lista do fornecedor": a mensagem do WhatsApp vira o catálogo de
 * encomenda em dois passos.
 *
 *   1. COLAR - a mensagem, o fornecedor, o prazo, a condição padrão e o que
 *      os valores da lista são (custo do fornecedor → soma a margem, ou já o
 *      preço de venda). Moeda em US$ é reconhecida sozinha (pede o câmbio).
 *   2. CONFERIR - uma linha por oferta: modelo, capacidade, cor, condição,
 *      custo e o VALOR DE VENDA (editável). Linha com dúvida (sem cor ou
 *      capacidade) fica marcada e não sobe até ser corrigida. Linhas que a
 *      leitura não entendeu aparecem listadas.
 *
 * Publicar grava tudo numa transação (import_order_list). A leitura do texto
 * é do core/order-list.js, coberta por testes com mensagens reais.
 */

import * as Data from '../core/data.js';
import { CONDITIONS } from '../core/constants.js';
import { parseOrderList, salePrice, listCost } from '../core/order-list.js';
import { friendlyError } from '../core/errors.js';
import { esc, money, parseMoney, moneyInputValue } from '../core/utils.js';
import { openModal, confirmDialog, toast, toastError, withLoading } from './kit.js';
import { icon } from './icons.js';
import { pref, setPref, productThumb } from './common.js';

const MONEY_ATTRS = 'inputmode="numeric" autocomplete="off" placeholder="0,00"';
const ALL_COLORS = '*';   // todas as cores do modelo (uma oferta por cor)

const EXAMPLE = `📱 IPHONE 15 PRO MAX
256GB azul - R$ 6.200
512 natural 6.900

iPhone 16 128 preto/branco 4.990
16 pro 256 deserto 7.300
*SEMINOVOS*
14 pro 128 roxo 3.900`;

export function openOrderListImport({ onDone } = {}) {
  const opts = {
    supplier: pref('olist.supplier', ''),
    lead: pref('olist.lead', '7 a 15 dias'),
    condition: pref('olist.condition', 'Lacrado'),
    priceMode: pref('olist.priceMode', 'custo'),          // custo | venda
    markupMode: pref('olist.markupMode', 'pct'),          // pct | add
    markup: pref('olist.markup', Data.settings().defaultMarkupPct || 10),
    round: pref('olist.round', '10'),
    rate: pref('olist.rate', 5.5),
    replace: pref('olist.replace', false),
  };
  let text = '';
  let rows = [];        // ofertas lidas (com o que a pessoa ajustou)
  let unknown = [];
  let step = 1;

  const products = () => Data.products().filter((p) => p.active).map((p) => ({ ...p, categoryName: Data.category(p.categoryId)?.name || '' }));
  const suppliers = [...new Set([...Data.suppliers().map((s) => s.name), ...Data.variants().map((v) => v.orderSupplier).filter(Boolean)])];

  const modal = openModal({
    title: 'Colar lista do fornecedor',
    subtitle: 'A mensagem do WhatsApp vira o catálogo de encomenda',
    size: 'xl',
    body: '<div data-step></div>',
    footer: '<div class="row gap-2 grow" data-foot-left></div><div class="row gap-2" data-foot-right></div>',
    beforeClose: async () => {
      if (step === 1 && !text.trim()) return true;
      return confirmDialog({ title: 'Descartar a lista?', message: 'Nada foi publicado ainda.', confirmText: 'Descartar', cancelText: 'Continuar', danger: true });
    },
  });
  modal.panel.classList.add('olist-modal');
  const $step = modal.body.querySelector('[data-step]');
  const $left = modal.foot.querySelector('[data-foot-left]');
  const $right = modal.foot.querySelector('[data-foot-right]');

  /* ------------------------------------------------------------ passo 1 -- */

  function renderPaste() {
    step = 1;
    $step.innerHTML = `
      <div class="form-grid">
        <div class="field span-12">
          <label class="label" for="ol-text">Mensagem do fornecedor</label>
          <textarea class="textarea mono-soft" id="ol-text" rows="11" placeholder="${esc(EXAMPLE)}" data-autofocus>${esc(text)}</textarea>
          <div class="hint">Cole a mensagem inteira, do jeito que veio. Saudação, frete e telefone são ignorados.</div>
        </div>
        <div class="field span-6"><label class="label" for="ol-sup">Fornecedor</label>
          <input class="input" id="ol-sup" maxlength="120" list="ol-sups" value="${esc(opts.supplier)}" placeholder="ex.: Fornecedor SP">
          <datalist id="ol-sups">${suppliers.map((s) => `<option value="${esc(s)}">`).join('')}</datalist></div>
        <div class="field span-6"><label class="label" for="ol-lead">Prazo de entrega para o cliente</label>
          <input class="input" id="ol-lead" maxlength="40" value="${esc(opts.lead)}" placeholder="ex.: 7 a 15 dias"></div>
        <div class="field span-12"><span class="label">Condição quando a lista não diz</span>
          <div class="chips">${CONDITIONS.map((c) => `<button type="button" class="chip sm" data-cond="${esc(c)}" aria-pressed="${c === opts.condition}">${esc(c)}</button>`).join('')}</div></div>
        <div class="field span-12"><span class="label">Os valores da lista são</span>
          <div class="segmented" role="group">
            <button type="button" data-pm="custo" aria-pressed="${opts.priceMode === 'custo'}">Custo do fornecedor</button>
            <button type="button" data-pm="venda" aria-pressed="${opts.priceMode === 'venda'}">Já o meu preço de venda</button>
          </div></div>
        <div class="span-12" data-markup-box>${markupHTML()}</div>
      </div>`;
    $left.innerHTML = '';
    $right.innerHTML = `<button class="btn btn-ghost" data-close>Cancelar</button>
      <button class="btn btn-primary" data-read>${icon('search')} Ler lista</button>`;
    $right.querySelector('[data-close]').addEventListener('click', () => modal.requestClose());
  }

  function markupHTML() {
    if (opts.priceMode !== 'custo') return '<p class="small dim">O valor de cada linha vira o preço de venda (dá para ajustar na conferência).</p>';
    return `
      <div class="form-grid">
        <div class="field span-4 span-half-mobile"><span class="label">Margem</span>
          <div class="row gap-2">
            <div class="segmented" role="group">
              <button type="button" data-mm="pct" aria-pressed="${opts.markupMode === 'pct'}">%</button>
              <button type="button" data-mm="add" aria-pressed="${opts.markupMode === 'add'}">R$</button>
            </div>
            <input class="input" id="ol-markup" type="text" inputmode="decimal" value="${esc(String(opts.markup).replace('.', ','))}" style="max-width:110px">
          </div></div>
        <div class="field span-4 span-half-mobile"><label class="label" for="ol-round">Arredondar</label>
          <select class="select" id="ol-round">
            ${[['none', 'Não arredondar'], ['10', 'Para cima, de 10 em 10'], ['50', 'Para cima, de 50 em 50'], ['90', 'Terminar em 90']].map(([k, l]) => `<option value="${k}" ${opts.round === k ? 'selected' : ''}>${l}</option>`).join('')}
          </select></div>
        <div class="field span-4"><label class="label" for="ol-rate">Câmbio (se a lista vier em US$)</label>
          <input class="input" id="ol-rate" type="text" inputmode="decimal" value="${esc(String(opts.rate).replace('.', ','))}"></div>
      </div>`;
  }

  function readOptions() {
    const v = (id) => modal.body.querySelector(id)?.value;
    if (step === 1) {
      text = v('#ol-text') || '';
      opts.supplier = (v('#ol-sup') || '').trim();
      opts.lead = (v('#ol-lead') || '').trim();
    }
    const dec = (x, fb) => { const n = Number(String(x ?? '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : fb; };
    if (modal.body.querySelector('#ol-markup')) opts.markup = Math.max(dec(v('#ol-markup'), opts.markup), 0);
    if (modal.body.querySelector('#ol-round')) opts.round = v('#ol-round');
    if (modal.body.querySelector('#ol-rate')) opts.rate = Math.max(dec(String(v('#ol-rate')).replace('.', ','), opts.rate), 0);
  }

  function priceOpts(currency) {
    return { currency, rate: opts.rate, mode: opts.priceMode === 'venda' ? 'venda' : opts.markupMode, value: opts.markup, round: opts.priceMode === 'venda' ? 'none' : opts.round };
  }

  function doRead() {
    readOptions();
    if (!text.trim()) { toast('Cole a mensagem do fornecedor', { kind: 'warn' }); modal.body.querySelector('#ol-text')?.focus(); return; }
    const res = parseOrderList(text, { products: products(), defaultCondition: opts.condition });
    // A mesma oferta repetida na lista: vale a última linha.
    const map = new Map();
    for (const r of res.rows) map.set([r.product.id, r.storage, r.color, r.size, r.condition].join('|').toLowerCase(), r);
    rows = [...map.values()].map((r) => {
      // Lista sem cor = o fornecedor tem nas cores do modelo: vira "todas as
      // cores" (uma oferta por cor) e o cliente escolhe a cor no catálogo.
      if (r.issues.includes('cor') && r.product.colors?.length) return { ...r, color: ALL_COLORS, issues: r.issues.filter((x) => x !== 'cor') };
      return r;
    }).map((r, i) => ({
      ...r, key: `r${i}`, include: !r.issues.length, manual: false,
      cost: listCost(r.price, priceOpts(r.currency)),
      sale: salePrice(r.price, priceOpts(r.currency)),
    }));
    unknown = res.unknown;
    for (const k of Object.keys(opts)) setPref(`olist.${k}`, opts[k]);
    renderReview();
  }

  /* ------------------------------------------------------------ passo 2 -- */

  function existing(r) {
    if (r.color === ALL_COLORS) return null;
    return Data.findVariant(r.product.id, { storage: r.storage, color: r.color, size: r.size, condition: r.condition });
  }

  function renderReview() {
    step = 2;
    const usd = rows.some((r) => r.currency === 'USD');
    const fresh = rows.filter((r) => r.color !== ALL_COLORS && !existing(r)).length;
    const doubt = rows.filter((r) => r.issues.length).length;
    $step.innerHTML = `
      <div class="olist-summary">
        <span class="badge no-dot" data-tone="blue">${rows.length} ${rows.length === 1 ? 'oferta' : 'ofertas'}</span>
        ${fresh ? `<span class="badge no-dot" data-tone="indigo">${fresh} ${fresh === 1 ? 'variação nova' : 'variações novas'}</span>` : ''}
        ${doubt ? `<span class="badge no-dot" data-tone="amber">${doubt} para conferir</span>` : ''}
        ${unknown.length ? `<span class="badge no-dot" data-tone="gray">${unknown.length} ${unknown.length === 1 ? 'linha não entendida' : 'linhas não entendidas'}</span>` : ''}
        ${usd ? `<span class="badge no-dot" data-tone="green">US$ × ${esc(String(opts.rate).replace('.', ','))}</span>` : ''}
      </div>
      ${opts.priceMode === 'custo' ? `
        <details class="olist-bulk">
          <summary class="small"><span class="grow">Margem ${opts.markupMode === 'pct' ? `${esc(String(opts.markup).replace('.', ','))}%` : esc(money(opts.markup))}${opts.round !== 'none' ? ` · ${opts.round === '90' ? 'termina em 90' : `de ${opts.round} em ${opts.round}`}` : ''}</span><span class="link-btn">alterar</span></summary>
          ${markupHTML()}<button type="button" class="btn btn-sm" data-reprice>${icon('refresh')} Recalcular preços de venda</button>
        </details>` : ''}
      ${rows.length ? `
        <div class="olist-rows">
          ${rows.map(rowHTML).join('')}
        </div>` : '<p class="small dim">Nenhuma oferta reconhecida. Confira se a mensagem tem modelo e valor em cada linha.</p>'}
      ${unknown.length ? `
        <details class="olist-unknown" ${rows.length ? '' : 'open'}><summary class="small">${unknown.length} ${unknown.length === 1 ? 'linha não entendida' : 'linhas não entendidas'} (não sobem)</summary>
          <ul>${unknown.map((u) => `<li><span class="mono xs">${esc(u.line)}</span> <span class="xs dim">- ${esc(u.reason)}</span></li>`).join('')}</ul>
        </details>` : ''}`;
    renderReviewFoot();
  }

  function rowHTML(r) {
    const p = r.product;
    const cat = Data.category(p.categoryId);
    const ex = existing(r);
    const storages = [...new Set([...(p.storages || []), r.storage].filter(Boolean))];
    const colors = [...new Set([...(p.colors || []), r.color].filter((c) => c && c !== ALL_COLORS))];
    const missingS = p.storages?.length > 1 && !r.storage;
    const missingC = p.colors?.length > 0 && !r.color;
    return `
      <div class="olist-row${r.include ? '' : ' is-off'}${missingS || missingC ? ' has-issue' : ''}" data-row="${r.key}">
        <label class="olist-check"><input type="checkbox" data-include ${r.include ? 'checked' : ''} aria-label="Publicar esta linha"></label>
        ${productThumb(p, 'sm')}
        <div class="olist-main">
          <div class="strong small">${esc(p.name)} ${r.color === ALL_COLORS ? `<span class="tag tone-indigo">${p.colors.length} cores · cliente escolhe</span>` : ex ? '' : '<span class="tag tone-amber">nova variação</span>'}</div>
          <div class="olist-selects">
            ${storages.length ? `<select class="select sm${missingS ? ' is-missing' : ''}" data-f="storage" aria-label="${esc(cat?.variantLabel || 'Capacidade')}">
              <option value="">${esc(cat?.variantLabel || 'Capacidade')}?</option>${storages.map((s) => `<option ${s === r.storage ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>` : ''}
            ${colors.length ? `<select class="select sm${missingC ? ' is-missing' : ''}" data-f="color" aria-label="Cor">
              <option value="">Cor?</option>${p.colors?.length > 1 ? `<option value="${ALL_COLORS}" ${r.color === ALL_COLORS ? 'selected' : ''}>Todas as cores (${p.colors.length})</option>` : ''}${colors.map((c) => `<option ${c === r.color ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>` : ''}
            <select class="select sm" data-f="condition" aria-label="Condição">${[...new Set([...CONDITIONS, r.condition])].map((c) => `<option ${c === r.condition ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
          </div>
          <div class="xs dim olist-line" title="${esc(r.line)}">“${esc(r.line)}”</div>
        </div>
        <div class="olist-prices">
          <span class="xs dim">${opts.priceMode === 'custo' ? `custo ${r.currency === 'USD' ? `US$ ${esc(String(r.price).replace('.', ','))} = ` : ''}${esc(money(r.cost))}` : `lista ${esc(money(r.price))}`}</span>
          <div class="money-input"><input class="input" data-sale ${MONEY_ATTRS} value="${esc(moneyInputValue(r.sale))}" aria-label="Valor de venda"></div>
          ${ex?.onOrder ? `<span class="xs dim">antes ${esc(money(ex.orderPrice))}</span>` : ''}
        </div>
      </div>`;
  }

  function renderReviewFoot() {
    const n = rows.filter((r) => r.include).length;
    $left.innerHTML = `
      <button class="btn btn-ghost" data-back>${icon('chevronLeft')} Voltar</button>
      <label class="check xs olist-replace"><input type="checkbox" data-replace ${opts.replace ? 'checked' : ''}><span class="box"></span>
        <span>Substituir a lista anterior${opts.supplier ? ` de ${esc(opts.supplier)}` : ''} <span class="dim block">o que não veio agora sai da encomenda</span></span></label>`;
    $right.innerHTML = `<button class="btn btn-primary" data-publish ${n ? '' : 'disabled'}>${icon('store')} Publicar ${n} no catálogo</button>`;
  }

  function rowOf(el) { return rows.find((r) => r.key === el.closest('[data-row]')?.dataset.row); }

  function refreshRow(r) {
    const el = $step.querySelector(`[data-row="${r.key}"]`);
    const p = r.product;
    r.issues = [];
    if (p.storages?.length > 1 && !r.storage) r.issues.push('capacidade');
    if (p.colors?.length > 0 && !r.color) r.issues.push('cor');
    el.outerHTML = rowHTML(r);
    renderReviewFoot();
  }

  /* -------------------------------------------------------------- ações -- */

  modal.panel.addEventListener('click', async (e) => {
    const t = e.target;
    const c = t.closest('[data-cond]');
    if (c) { opts.condition = c.dataset.cond; modal.body.querySelectorAll('[data-cond]').forEach((b) => b.setAttribute('aria-pressed', String(b === c))); return; }
    const pm = t.closest('[data-pm]');
    if (pm) {
      readOptions();
      opts.priceMode = pm.dataset.pm;
      modal.body.querySelectorAll('[data-pm]').forEach((b) => b.setAttribute('aria-pressed', String(b === pm)));
      modal.body.querySelector('[data-markup-box]').innerHTML = markupHTML();
      return;
    }
    const mm = t.closest('[data-mm]');
    if (mm) { opts.markupMode = mm.dataset.mm; mm.parentElement.querySelectorAll('[data-mm]').forEach((b) => b.setAttribute('aria-pressed', String(b === mm))); return; }
    if (t.closest('[data-read]')) { doRead(); return; }
    if (t.closest('[data-back]')) { renderPaste(); return; }
    if (t.closest('[data-reprice]')) {
      readOptions();
      for (const k of ['markup', 'markupMode', 'round', 'rate']) setPref(`olist.${k}`, opts[k]);
      // As linhas que a pessoa digitou à mão ficam como estão.
      rows.forEach((r) => { r.cost = listCost(r.price, priceOpts(r.currency)); if (!r.manual) r.sale = salePrice(r.price, priceOpts(r.currency)); });
      renderReview();
      toast('Preços recalculados', { duration: 1500 });
      return;
    }
    const pub = t.closest('[data-publish]');
    if (pub) await publish(pub);
  });

  modal.panel.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-replace]')) { opts.replace = t.checked; setPref('olist.replace', opts.replace); return; }
    const r = rowOf(t);
    if (!r) return;
    if (t.matches('[data-include]')) {
      if (t.checked && r.issues.length) { t.checked = false; toast(`Escolha ${r.issues.join(' e ')} antes`, { kind: 'warn' }); return; }
      r.include = t.checked;
      t.closest('[data-row]').classList.toggle('is-off', !r.include);
      renderReviewFoot();
      return;
    }
    if (t.matches('[data-f]')) {
      r[t.dataset.f] = t.value;
      const hadIssues = r.issues.length;
      refreshRow(r);
      if (hadIssues && !r.issues.length) { r.include = true; refreshRow(r); }
    }
  });

  modal.panel.addEventListener('input', (e) => {
    const r = rowOf(e.target);
    if (r && e.target.matches('[data-sale]')) { r.sale = parseMoney(e.target.value); r.manual = true; }
  });

  /**
   * Todas as cores vira uma oferta por cor do modelo. Linha com cor
   * específica vence a de todas as cores na mesma versão (vem depois).
   */
  function expand(list) {
    const out = new Map();
    const put = (r, color) => out.set([r.product.id, r.storage, color, r.size, r.condition].join('|').toLowerCase(),
      { productId: r.product.id, storage: r.storage, color, size: r.size, condition: r.condition, cost: r.cost, price: r.sale });
    for (const r of list.filter((x) => x.color === ALL_COLORS)) for (const c of r.product.colors || []) put(r, c);
    for (const r of list.filter((x) => x.color !== ALL_COLORS)) put(r, r.color);
    return [...out.values()];
  }

  async function publish(btn) {
    const list = rows.filter((r) => r.include);
    const bad = list.find((r) => !(r.sale > 0));
    if (bad) { toast('Toda linha publicada precisa de valor de venda', { kind: 'warn', text: bad.line }); return; }
    const below = list.filter((r) => r.cost > 0 && r.sale < r.cost);
    if (below.length) {
      const go = await confirmDialog({ title: 'Preço abaixo do custo', message: `${below.length} ${below.length === 1 ? 'linha está' : 'linhas estão'} com valor de venda menor que o custo. Publicar assim mesmo?`, confirmText: 'Publicar assim' });
      if (!go) return;
    }
    if (opts.replace) {
      const current = Data.orderOffers().filter((v) => (v.orderSupplier || '') === (opts.supplier || '')).length;
      if (current) {
        const go = await confirmDialog({ title: 'Substituir a lista anterior?', message: `As ofertas de encomenda${opts.supplier ? ` de ${opts.supplier}` : ''} que não estão nesta lista saem do catálogo.`, confirmText: 'Substituir' });
        if (!go) return;
      }
    }
    await withLoading(btn, async () => {
      try {
        const res = await Data.importOrderList({
          supplier: opts.supplier, lead: opts.lead, replace: opts.replace,
          items: expand(list),
        });
        text = '';
        modal.close();
        toast('Lista publicada no catálogo', { text: `${res.created} novas · ${res.updated} atualizadas${res.removed ? ` · ${res.removed} saíram` : ''}` });
        onDone?.(res);
      } catch (err) {
        toastError('Não foi possível publicar', friendlyError(err));
      }
    });
  }

  modal.panel.addEventListener('keydown', (e) => {
    // Enter na textarea é quebra de linha, nunca "confirmar".
    if (e.key === 'Enter' && e.target.matches('textarea')) e.stopPropagation();
  }, true);

  renderPaste();
  return modal;
}
