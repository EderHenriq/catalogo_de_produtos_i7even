/**
 * "Colar lista do WhatsApp": a mensagem vira o catálogo em dois passos.
 *
 *   1. COLAR - a mensagem e o que ela é:
 *        PRONTA ENTREGA  a lista da própria loja (o que tem para vender agora):
 *                        publica com o preço e o estoque (aparelho sem IMEI);
 *        SOB ENCOMENDA   a lista do fornecedor: oferta com prazo, preço de
 *                        venda = custo + margem (ou o valor da lista).
 *   2. CONFERIR - uma linha por oferta: modelo, capacidade, cor (cor que o
 *      cadastro não tem entra como "cor nova"), condição, quantidade e o VALOR
 *      DE VENDA (editável). Modelo que o cadastro não tem aparece com o botão
 *      "Criar modelo" - criou, a lista é lida de novo.
 *
 * Publicar grava tudo numa transação (import_order_list) e o modelo fica à
 * mostra no catálogo na hora. A leitura do texto é do core/order-list.js,
 * coberta por testes com mensagens reais (tests/unit/fixtures).
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

const EXAMPLE = `📲 iPhone 15 Pro 256GB
💰 R$ 3.847,00
▫️ Branco
▫️ Preto

iPhone 16 128 preto/azul 3.897
*SEMINOVOS*
14 pro 128 roxo 2.997`;

export function openOrderListImport({ onDone, mode: forcedMode } = {}) {
  const opts = {
    mode: forcedMode || pref('olist.mode', 'pronta'),        // pronta | encomenda
    supplier: pref('olist.supplier', ''),
    lead: pref('olist.lead', '7 a 15 dias'),
    condition: pref('olist.condition', 'Lacrado'),
    priceMode: pref('olist.priceMode2', ''),                  // custo | venda ('' = padrão do modo)
    markupMode: pref('olist.markupMode', 'pct'),
    markup: pref('olist.markup', Data.settings().defaultMarkupPct || 10),
    round: pref('olist.round', '10'),
    rate: pref('olist.rate', 5.5),
    replace: false,
  };
  const priceMode = () => opts.priceMode || (opts.mode === 'pronta' ? 'venda' : 'custo');
  let text = '';
  let rows = [];
  let unknown = [];
  let missing = [];
  let step = 1;

  const products = () => Data.products().filter((p) => p.active).map((p) => ({ ...p, categoryName: Data.category(p.categoryId)?.name || '' }));
  const suppliers = [...new Set([...Data.suppliers().map((s) => s.name), ...Data.variants().map((v) => v.orderSupplier).filter(Boolean)])];

  const modal = openModal({
    title: 'Colar lista do WhatsApp',
    subtitle: 'A mensagem vira o catálogo: pronta entrega ou sob encomenda',
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
    const enc = opts.mode === 'encomenda';
    $step.innerHTML = `
      <div class="olist-modes" role="radiogroup" aria-label="O que é esta lista">
        <button type="button" class="olist-mode" role="radio" data-mode="pronta" aria-checked="${!enc}">
          ${icon('checkCircle')}<span><b>Pronta entrega</b><small>A lista da loja: o que tenho para vender agora. Sobe com preço e estoque.</small></span></button>
        <button type="button" class="olist-mode" role="radio" data-mode="encomenda" aria-checked="${enc}">
          ${icon('truck')}<span><b>Sob encomenda</b><small>A lista do fornecedor: o cliente pede e chega no prazo.</small></span></button>
      </div>
      <div class="form-grid">
        <div class="field span-12">
          <label class="label" for="ol-text">Mensagem do WhatsApp</label>
          <textarea class="textarea mono-soft" id="ol-text" rows="11" placeholder="${esc(EXAMPLE)}" data-autofocus>${esc(text)}</textarea>
          <div class="hint">Cole a mensagem inteira, do jeito que veio. Horário, garantia, saudação e telefone são ignorados.</div>
        </div>
        ${enc ? `
          <div class="field span-6"><label class="label" for="ol-sup">Fornecedor</label>
            <input class="input" id="ol-sup" maxlength="120" list="ol-sups" value="${esc(opts.supplier)}" placeholder="ex.: Fornecedor SP">
            <datalist id="ol-sups">${suppliers.map((s) => `<option value="${esc(s)}">`).join('')}</datalist></div>
          <div class="field span-6"><label class="label" for="ol-lead">Prazo de entrega para o cliente</label>
            <input class="input" id="ol-lead" maxlength="40" value="${esc(opts.lead)}" placeholder="ex.: 7 a 15 dias"></div>` : ''}
        <div class="field span-12"><span class="label">Condição quando a lista não diz</span>
          <div class="chips">${CONDITIONS.map((c) => `<button type="button" class="chip sm" data-cond="${esc(c)}" aria-pressed="${c === opts.condition}">${esc(c)}</button>`).join('')}</div></div>
        <div class="field span-12"><span class="label">Os valores da lista são</span>
          <div class="segmented" role="group">
            <button type="button" data-pm="venda" aria-pressed="${priceMode() === 'venda'}">O preço de venda</button>
            <button type="button" data-pm="custo" aria-pressed="${priceMode() === 'custo'}">O custo (somar margem)</button>
          </div></div>
        <div class="span-12" data-markup-box>${markupHTML()}</div>
      </div>`;
    $left.innerHTML = '';
    $right.innerHTML = `<button class="btn btn-ghost" data-close>Cancelar</button>
      <button class="btn btn-primary" data-read>${icon('search')} Ler lista</button>`;
    $right.querySelector('[data-close]').addEventListener('click', () => modal.requestClose());
  }

  function markupHTML() {
    if (priceMode() !== 'custo') return '<p class="small dim">O valor de cada modelo vira o preço no catálogo (dá para ajustar na conferência).</p>';
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
      text = v('#ol-text') ?? text;
      if (modal.body.querySelector('#ol-sup')) opts.supplier = (v('#ol-sup') || '').trim();
      if (modal.body.querySelector('#ol-lead')) opts.lead = (v('#ol-lead') || '').trim();
    }
    const dec = (x, fb) => { const n = Number(String(x ?? '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : fb; };
    if (modal.body.querySelector('#ol-markup')) opts.markup = Math.max(dec(v('#ol-markup'), opts.markup), 0);
    if (modal.body.querySelector('#ol-round')) opts.round = v('#ol-round');
    if (modal.body.querySelector('#ol-rate')) opts.rate = Math.max(dec(String(v('#ol-rate')).replace('.', ','), opts.rate), 0);
  }

  function priceOpts(currency) {
    const pm = priceMode();
    return { currency, rate: opts.rate, mode: pm === 'venda' ? 'venda' : opts.markupMode, value: opts.markup, round: pm === 'venda' ? 'none' : opts.round };
  }

  function doRead() {
    readOptions();
    if (!text.trim()) { toast('Cole a mensagem do WhatsApp', { kind: 'warn' }); modal.body.querySelector('#ol-text')?.focus(); return; }
    const keep = new Map(rows.filter((r) => r.manual).map((r) => [rowKey(r), r.sale]));
    const res = parseOrderList(text, { products: products(), defaultCondition: opts.condition });
    // A mesma oferta repetida na lista: vale a última linha.
    const map = new Map();
    for (const r of res.rows) map.set(rowKey(r), r);
    rows = [...map.values()].map((r) => {
      // Linha sem cor (fornecedor tem nas cores do modelo): "todas as cores".
      if (r.issues.includes('cor') && r.product.colors?.length) return { ...r, color: ALL_COLORS, issues: r.issues.filter((x) => x !== 'cor') };
      return r;
    }).map((r, i) => {
      const sale = keep.has(rowKey(r)) ? keep.get(rowKey(r)) : salePrice(r.price, priceOpts(r.currency));
      return { ...r, key: `r${i}`, include: !r.issues.length, manual: keep.has(rowKey(r)), qty: r.qty || (opts.mode === 'pronta' ? 1 : null),
        cost: listCost(r.price, priceOpts(r.currency)), sale };
    });
    unknown = res.unknown;
    missing = res.missing || [];
    for (const k of ['mode', 'supplier', 'lead', 'condition', 'markupMode', 'markup', 'round', 'rate']) setPref(`olist.${k}`, opts[k]);
    setPref('olist.priceMode2', opts.priceMode);
    renderReview();
  }

  const rowKey = (r) => [r.product.id, r.storage, r.color, r.size, r.condition].join('|').toLowerCase();

  /* ------------------------------------------------------------ passo 2 -- */

  function existing(r) {
    if (r.color === ALL_COLORS) return null;
    return Data.findVariant(r.product.id, { storage: r.storage, color: r.color, size: r.size, condition: r.condition });
  }

  function renderReview() {
    step = 2;
    const pronta = opts.mode === 'pronta';
    const usd = rows.some((r) => r.currency === 'USD');
    const doubt = rows.filter((r) => r.issues.length).length;
    const units = rows.filter((r) => r.include).reduce((a, r) => a + (r.qty || 1), 0);
    $step.innerHTML = `
      <div class="olist-summary">
        <span class="badge no-dot" data-tone="${pronta ? 'green' : 'indigo'}">${pronta ? icon('checkCircle') : icon('truck')} ${pronta ? 'Pronta entrega' : 'Sob encomenda'}</span>
        <span class="badge no-dot" data-tone="blue">${rows.length} ${rows.length === 1 ? 'oferta' : 'ofertas'}${pronta ? ` · ${units} un.` : ''}</span>
        ${doubt ? `<span class="badge no-dot" data-tone="amber">${doubt} para conferir</span>` : ''}
        ${missing.length ? `<span class="badge no-dot" data-tone="red">${missing.length} ${missing.length === 1 ? 'modelo não cadastrado' : 'modelos não cadastrados'}</span>` : ''}
        ${usd ? `<span class="badge no-dot" data-tone="green">US$ × ${esc(String(opts.rate).replace('.', ','))}</span>` : ''}
      </div>
      ${missing.length ? `
        <div class="olist-missing">
          <div class="strong small">${icon('alert')} Estes modelos não estão no cadastro. Crie com um toque e eles entram na lista:</div>
          ${missing.map((m, i) => `
            <div class="olist-miss-row">
              <span class="grow"><b>${esc(m.name)}</b> <span class="xs dim">${esc([m.storage, m.colors.join(', '), money(m.price)].filter(Boolean).join(' · '))}</span></span>
              <button type="button" class="btn btn-sm btn-primary" data-create="${i}">${icon('plus')} Criar modelo</button>
            </div>`).join('')}
        </div>` : ''}
      ${priceMode() === 'custo' ? `
        <details class="olist-bulk">
          <summary class="small"><span class="grow">Margem ${opts.markupMode === 'pct' ? `${esc(String(opts.markup).replace('.', ','))}%` : esc(money(opts.markup))}${opts.round !== 'none' ? ` · ${opts.round === '90' ? 'termina em 90' : `de ${opts.round} em ${opts.round}`}` : ''}</span><span class="link-btn">alterar</span></summary>
          ${markupHTML()}<button type="button" class="btn btn-sm" data-reprice>${icon('refresh')} Recalcular preços de venda</button>
        </details>` : ''}
      ${rows.length ? `<div class="olist-rows">${rows.map(rowHTML).join('')}</div>`
        : '<p class="small dim">Nenhuma oferta reconhecida. Confira se a mensagem tem modelo e valor.</p>'}
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
    const pronta = opts.mode === 'pronta';
    return `
      <div class="olist-row${r.include ? '' : ' is-off'}${missingS || missingC ? ' has-issue' : ''}" data-row="${r.key}">
        <label class="olist-check"><input type="checkbox" data-include ${r.include ? 'checked' : ''} aria-label="Publicar esta linha"></label>
        ${productThumb(p, 'sm')}
        <div class="olist-main">
          <div class="strong small">${esc(p.name)}
            ${r.color === ALL_COLORS ? `<span class="tag tone-indigo">${p.colors.length} cores · cliente escolhe</span>` : ''}
            ${r.newColor ? '<span class="tag tone-indigo">cor nova</span>' : ''}
            ${!ex && r.color !== ALL_COLORS ? '<span class="tag tone-amber">nova</span>' : ''}</div>
          <div class="olist-selects">
            ${storages.length ? `<select class="select sm${missingS ? ' is-missing' : ''}" data-f="storage" aria-label="${esc(cat?.variantLabel || 'Capacidade')}">
              <option value="">${esc(cat?.variantLabel || 'Capacidade')}?</option>${storages.map((s) => `<option ${s === r.storage ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>` : ''}
            ${colors.length ? `<select class="select sm${missingC ? ' is-missing' : ''}" data-f="color" aria-label="Cor">
              <option value="">Cor?</option>${p.colors?.length > 1 ? `<option value="${ALL_COLORS}" ${r.color === ALL_COLORS ? 'selected' : ''}>Todas as cores (${p.colors.length})</option>` : ''}${colors.map((c) => `<option ${c === r.color ? 'selected' : ''}>${esc(c)}${c === r.color && r.newColor ? ' (nova)' : ''}</option>`).join('')}</select>` : ''}
            <select class="select sm" data-f="condition" aria-label="Condição">${[...new Set([...CONDITIONS, r.condition])].map((c) => `<option ${c === r.condition ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
            ${pronta || r.qty ? `<label class="olist-qty"><span class="xs dim">qtd</span><input class="input sm" type="number" inputmode="numeric" min="1" max="99" data-qty value="${esc(r.qty || 1)}" aria-label="Quantidade"></label>` : ''}
          </div>
          <div class="xs dim olist-line" title="${esc(r.line)}">“${esc(r.line)}”</div>
        </div>
        <div class="olist-prices">
          <span class="xs dim">${priceMode() === 'custo' ? `custo ${r.currency === 'USD' ? `US$ ${esc(String(r.price).replace('.', ','))} = ` : ''}${esc(money(r.cost))}` : `lista ${esc(money(r.price))}`}</span>
          <div class="money-input"><input class="input" data-sale ${MONEY_ATTRS} value="${esc(moneyInputValue(r.sale))}" aria-label="Valor de venda"></div>
          ${ex && !pronta && ex.onOrder ? `<span class="xs dim">antes ${esc(money(ex.orderPrice))}</span>` : ''}
          ${ex && pronta && ex.price > 0 && ex.price !== r.sale ? `<span class="xs dim">antes ${esc(money(ex.price))}</span>` : ''}
        </div>
      </div>`;
  }

  function renderReviewFoot() {
    const n = rows.filter((r) => r.include).length;
    const pronta = opts.mode === 'pronta';
    $left.innerHTML = `
      <button class="btn btn-ghost" data-back>${icon('chevronLeft')} Voltar</button>
      <label class="check xs olist-replace"><input type="checkbox" data-replace ${opts.replace ? 'checked' : ''}><span class="box"></span>
        <span>${pronta ? 'Esta lista é tudo que tenho' : `Substituir a lista anterior${opts.supplier ? ` de ${esc(opts.supplier)}` : ''}`}
          <span class="dim block">${pronta ? 'o que estava à venda e não está aqui sai do catálogo' : 'o que não veio agora sai da encomenda'}</span></span></label>`;
    $right.innerHTML = `<button class="btn btn-primary" data-publish ${n ? '' : 'disabled'}>${icon('store')} Publicar ${n} no catálogo</button>`;
  }

  function rowOf(el) { return rows.find((r) => r.key === el.closest('[data-row]')?.dataset.row); }

  function refreshRow(r) {
    const el = $step.querySelector(`[data-row="${r.key}"]`);
    const p = r.product;
    r.issues = [];
    if (p.storages?.length > 1 && !r.storage) r.issues.push('capacidade');
    if (p.colors?.length > 0 && !r.color) r.issues.push('cor');
    if (r.color && r.color !== ALL_COLORS) r.newColor = !(p.colors || []).includes(r.color);
    el.outerHTML = rowHTML(r);
    renderReviewFoot();
  }

  /* -------------------------------------------- criar modelo que falta -- */

  function createModel(m) {
    const cats = Data.categories().filter((c) => c.active);
    const isPhone = /iphone/i.test(m.name);
    const cat0 = cats.find((c) => (isPhone ? c.slug === 'iphone' : false)) || cats.find((c) => /iphone/i.test(c.name) && isPhone) || cats[0];
    const storages = [...new Set([m.storage, ...(isPhone ? ['128GB', '256GB', '512GB'] : [])].filter(Boolean))];
    const dlg = openModal({
      title: 'Criar modelo',
      subtitle: 'Só o essencial - depois dá para completar',
      body: `
        <div class="form-grid">
          <div class="field span-12"><label class="label" for="cm-name">Nome</label>
            <input class="input" id="cm-name" maxlength="120" value="${esc(m.name)}" data-autofocus></div>
          <div class="field span-12"><label class="label" for="cm-cat">Categoria</label>
            <select class="select" id="cm-cat">${cats.map((c) => `<option value="${esc(c.id)}" ${c.id === cat0?.id ? 'selected' : ''}>${esc(c.emoji || '')} ${esc(c.name)}</option>`).join('')}</select></div>
          <div class="field span-12"><label class="label" for="cm-st">Capacidades <span class="dim">(separe por vírgula)</span></label>
            <input class="input" id="cm-st" value="${esc(storages.join(', '))}"></div>
          <div class="field span-12"><label class="label" for="cm-co">Cores <span class="dim">(separe por vírgula)</span></label>
            <input class="input" id="cm-co" value="${esc(m.colors.join(', '))}"></div>
        </div>`,
      footer: '<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Criar e ler a lista</button>',
    });
    dlg.foot.querySelector('[data-ok]').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const $ = (id) => dlg.body.querySelector(id).value;
      const name = $('#cm-name').trim();
      if (!name) return;
      const split = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
      const cat = Data.category($('#cm-cat'));
      await withLoading(btn, async () => {
        try {
          await Data.saveProduct({ name, categoryId: cat?.id || null, storages: split($('#cm-st')), colors: split($('#cm-co')),
            tracksSerial: !!cat?.tracksSerial, showInCatalog: true, brand: isPhone ? 'Apple' : '', year: new Date().getFullYear() });
          dlg.close();
          toast(`${name} criado`, { duration: 1800 });
          doRead();
        } catch (err) { toastError('Não foi possível criar', friendlyError(err)); }
      });
    });
  }

  /* -------------------------------------------------------------- ações -- */

  modal.panel.addEventListener('click', async (e) => {
    const t = e.target;
    const md = t.closest('[data-mode]');
    if (md) { readOptions(); opts.mode = md.dataset.mode; opts.priceMode = ''; renderPaste(); return; }
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
    const cr = t.closest('[data-create]');
    if (cr) { createModel(missing[Number(cr.dataset.create)]); return; }
    if (t.closest('[data-reprice]')) {
      readOptions();
      for (const k of ['markup', 'markupMode', 'round', 'rate']) setPref(`olist.${k}`, opts[k]);
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
    if (t.matches('[data-replace]')) { opts.replace = t.checked; return; }
    const r = rowOf(t);
    if (!r) return;
    if (t.matches('[data-include]')) {
      if (t.checked && r.issues.length) { t.checked = false; toast(`Escolha ${r.issues.join(' e ')} antes`, { kind: 'warn' }); return; }
      r.include = t.checked;
      t.closest('[data-row]').classList.toggle('is-off', !r.include);
      renderReviewFoot();
      return;
    }
    if (t.matches('[data-qty]')) { r.qty = Math.min(Math.max(Math.trunc(Number(t.value)) || 1, 1), 99); t.value = r.qty; return; }
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

  /** Todas as cores vira uma oferta por cor; linha com cor específica vence. */
  function expand(list) {
    const out = new Map();
    const put = (r, color) => out.set([r.product.id, r.storage, color, r.size, r.condition].join('|').toLowerCase(),
      { productId: r.product.id, storage: r.storage, color, size: r.size, condition: r.condition, cost: r.cost, price: r.sale, qty: r.qty });
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
    const pronta = opts.mode === 'pronta';
    if (opts.replace) {
      const go = await confirmDialog({
        title: pronta ? 'A lista é tudo que você tem?' : 'Substituir a lista anterior?',
        message: pronta
          ? 'O que está à venda no catálogo e não está nesta lista sai do catálogo (continua cadastrado, com o estoque).'
          : `As ofertas de encomenda${opts.supplier ? ` de ${opts.supplier}` : ''} que não estão nesta lista saem do catálogo.`,
        confirmText: pronta ? 'Sim, publicar assim' : 'Substituir',
      });
      if (!go) return;
    }
    await withLoading(btn, async () => {
      try {
        const res = await Data.importOrderList({
          mode: opts.mode, supplier: opts.supplier, lead: opts.lead, replace: opts.replace, items: expand(list),
        });
        text = '';
        modal.close();
        toast(pronta ? 'Pronta entrega publicada no catálogo' : 'Encomenda publicada no catálogo',
          { text: `${res.created} novas · ${res.updated} atualizadas${res.units ? ` · ${res.units} un. no estoque` : ''}${res.removed ? ` · ${res.removed} saíram` : ''}` });
        // catálogo fechado: a lista não aparece para ninguém - oferece abrir
        if (!Data.settings().catalogEnabled) {
          const open = await confirmDialog({ title: 'O catálogo está fechado', message: 'Os produtos foram publicados, mas o catálogo está fechado para os clientes. Abrir agora?', confirmText: 'Abrir catálogo' });
          if (open) await Data.saveSettings({ catalogEnabled: true }).then(() => toast('Catálogo aberto')).catch((err) => toastError('Não foi possível abrir', friendlyError(err)));
        }
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
