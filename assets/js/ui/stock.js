/**
 * Estoque: o que está na loja AGORA (pronta entrega), item por item.
 *
 *   Lista   cada variação com saldo (foto, modelo, capacidade · cor ·
 *           condição, preço e quantidade), por categoria; busca acha até
 *           pelo IMEI. Atalhos: sem foto, sem IMEI, fora do catálogo.
 *   Ficha   tudo do item numa tela só - fotos da cor, preço, catálogo e a
 *           quantidade: botões − e + (sem IMEI) ou a lista de aparelhos com
 *           IMEI e bateria editáveis ali mesmo (IMEI continua opcional).
 *
 * Por baixo é o mesmo estoque de Produtos: aparelho com IMEI é unidade
 * (cadastrar / dar baixa), o resto é ajuste de quantidade - tudo vira
 * movimento no histórico. Cadastrar mais: "Adicionar" (cadastro rápido já
 * em pronta entrega).
 */

import * as Data from '../core/data.js';
import { variantLabel } from '../core/calc.js';
import { friendlyError } from '../core/errors.js';
import { esc, money, parseMoney, moneyInputValue, thumbUrl } from '../core/utils.js';
import { openModal, toast, toastError, withLoading, emptyState, openMenu, confirmDialog } from './kit.js';
import { icon } from './icons.js';
import { matches, productThumb, moneyHTML, pref, setPref, openColorPhotos } from './common.js';
import { openQuickProduct } from './quick-product.js';

const MONEY_ATTRS = 'inputmode="numeric" autocomplete="off" placeholder="0,00"';
const NOTE = 'Ajuste na tela Estoque';

const FILTERS = [
  { key: 'todos', label: 'Tudo' },
  { key: 'semfoto', label: 'Sem foto' },
  { key: 'semimei', label: 'Sem IMEI' },
  { key: 'fora', label: 'Fora do catálogo' },
];

/** A foto que o item mostra (a dele, a da cor ou a do modelo). */
const hasPhoto = (p, v) => !!(v.imageUrl || p.colorPhotos?.[v.color]?.length || p.imageUrl);
const noSerial = (v) => Data.stockUnitsOf(v.id).filter((u) => !u.serial).length;

/** Itens com saldo, de modelos ativos. */
function stockItems() {
  return Data.variants().filter((v) => v.active && v.stock > 0 && Data.product(v.productId)?.active !== false);
}

/* =================================================================== */
/*  Lista                                                               */
/* =================================================================== */

export function mount(host, ctx) {
  const st = { q: '', filter: pref('stock.filter', 'todos'), cat: pref('stock.cat', '') };

  host.innerHTML = `
    <div class="view">
      <div class="section-head">
        <div>
          <h2>Estoque</h2>
          <p class="small dim" data-count></p>
        </div>
        <div class="row gap-2 wrap">
          <button class="btn hide-mobile" data-go-vitrine title="O que aparece no catálogo e a ordem das fotos">${icon('image')}<span>Vitrine</span></button>
          <button class="btn only-mobile" data-more-actions>${icon('more')}<span>Mais</span></button>
          <button class="btn btn-primary" data-add>${icon('plus')} Adicionar</button>
        </div>
      </div>

      <div class="grid grid-kpi" data-kpis></div>

      <div class="filters">
        <div class="chips filter-chips" data-filters>
          ${FILTERS.map((f) => `<button type="button" class="chip sm" data-filter="${f.key}" aria-pressed="${f.key === st.filter}">${esc(f.label)}<span class="chip-n" data-n="${f.key}"></span></button>`).join('')}
        </div>
        <div class="chips filter-chips" data-cats></div>
      </div>

      <div data-list></div>
    </div>`;

  const $list = host.querySelector('[data-list]');

  function test(v, key) {
    const p = Data.product(v.productId);
    switch (key) {
      case 'semfoto': return !hasPhoto(p, v);
      case 'semimei': return !!p.tracksSerial && noSerial(v) > 0;
      case 'fora': return !v.showInCatalog || !p.showInCatalog;
      default: return true;
    }
  }

  function filtered() {
    const catOrder = new Map(Data.categories().map((c, i) => [c.id, i]));
    return stockItems().filter((v) => {
      const p = Data.product(v.productId);
      if (!test(v, st.filter)) return false;
      if (st.cat && p.categoryId !== st.cat) return false;
      if (!st.q) return true;
      const serials = Data.stockUnitsOf(v.id).map((u) => u.serial).join(' ');
      return matches(st.q, p.name, variantLabel(v), Data.category(p.categoryId)?.name, serials, String(v.code || ''));
    }).sort((a, b) => {
      const pa = Data.product(a.productId);
      const pb = Data.product(b.productId);
      return (catOrder.get(pa.categoryId) ?? 999) - (catOrder.get(pb.categoryId) ?? 999)
        || pa.name.localeCompare(pb.name, 'pt-BR', { numeric: true })
        || variantLabel(a).localeCompare(variantLabel(b), 'pt-BR', { numeric: true });
    });
  }

  function renderKpis() {
    const all = stockItems();
    const units = all.reduce((a, v) => a + v.stock, 0);
    const sale = all.reduce((a, v) => a + v.stock * (v.price || 0), 0);
    const noPhoto = all.filter((v) => test(v, 'semfoto')).length;
    const noImei = all.reduce((a, v) => a + (Data.product(v.productId)?.tracksSerial ? noSerial(v) : 0), 0);
    host.querySelector('[data-kpis]').innerHTML = `
      <div class="kpi"><div class="kpi-label">${icon('box')} Na loja</div>
        <div class="kpi-value num">${units.toLocaleString('pt-BR')}</div>
        <div class="kpi-foot">${all.length} ${all.length === 1 ? 'item' : 'itens'} diferentes</div></div>
      <div class="kpi"><div class="kpi-label">${icon('wallet')} A preço de venda</div>
        <div class="kpi-value sm">${moneyHTML(sale)}</div><div class="kpi-foot">tudo que está a pronta entrega</div></div>
      <button type="button" class="kpi kpi-btn" data-go-filter="semfoto"><div class="kpi-label">${icon('camera')} Sem foto</div>
        <div class="kpi-value num ${noPhoto ? 'tone-amber' : ''}">${noPhoto}</div><div class="kpi-foot">o cliente vê sem imagem</div></button>
      <button type="button" class="kpi kpi-btn" data-go-filter="semimei"><div class="kpi-label">${icon('device')} Sem IMEI</div>
        <div class="kpi-value num">${noImei}</div><div class="kpi-foot">aparelhos para anotar depois</div></button>`;
  }

  function renderCats() {
    const used = new Set(stockItems().map((v) => Data.product(v.productId)?.categoryId));
    const cats = Data.categories().filter((c) => used.has(c.id));
    host.querySelector('[data-cats]').innerHTML = cats.length > 1 ? `
      <button type="button" class="chip sm" data-cat="" aria-pressed="${!st.cat}">Todas</button>
      ${cats.map((c) => `<button type="button" class="chip sm" data-cat="${esc(c.id)}" aria-pressed="${c.id === st.cat}">
        <span aria-hidden="true">${esc(c.emoji || '')}</span>${esc(c.name)}</button>`).join('')}` : '';
  }

  function rowHTML(v) {
    const p = Data.product(v.productId);
    const missing = p.tracksSerial ? noSerial(v) : 0;
    const tags = [
      !hasPhoto(p, v) ? `<span class="tag tone-amber">${icon('camera')} sem foto</span>` : '',
      missing ? `<span class="tag">${missing} sem IMEI</span>` : '',
      !v.showInCatalog || !p.showInCatalog ? '<span class="tag">fora do catálogo</span>' : '',
    ].join('');
    return `
      <button type="button" class="m-row" data-item="${esc(v.id)}">
        ${productThumb(p, 'md', v)}
        <span class="m-main">
          <span class="m-title">${esc(p.name)}</span>
          <span class="m-sub">${esc(variantLabel(v) || 'Padrão')} ${tags}</span>
        </span>
        <span class="m-side">
          <span class="strong">${v.price > 0 ? moneyHTML(v.price) : '<span class="badge no-dot" data-tone="amber">sem preço</span>'}</span>
          <span class="badge" data-tone="green">${v.stock} ${p.tracksSerial ? (v.stock === 1 ? 'aparelho' : 'aparelhos') : 'un'}</span>
        </span>
      </button>`;
  }

  function render() {
    renderKpis();
    renderCats();
    for (const f of FILTERS) {
      const el = host.querySelector(`[data-n="${f.key}"]`);
      const n = f.key === 'todos' ? 0 : stockItems().filter((v) => test(v, f.key)).length;
      if (el) el.textContent = n ? String(n) : '';
    }
    const items = filtered();
    const units = items.reduce((a, v) => a + v.stock, 0);
    host.querySelector('[data-count]').textContent = `${units} ${units === 1 ? 'unidade' : 'unidades'} a pronta entrega`;
    if (!items.length) {
      const empty = !stockItems().length;
      $list.innerHTML = `<div class="card">${emptyState({
        emoji: empty ? '📦' : '🔎',
        title: empty ? 'Nada a pronta entrega' : 'Nada com esse filtro',
        text: empty ? 'Toque em Adicionar: escolha o modelo, as cores, o preço e a quantidade - já aparece no catálogo.' : 'Tente outra busca ou outro filtro.',
        action: `<button class="btn btn-primary" data-add>${icon('plus')} Adicionar ao estoque</button>`,
      })}</div>`;
      return;
    }
    const groups = new Map();
    for (const v of items) {
      const key = st.cat || st.q ? '_' : (Data.product(v.productId).categoryId || '_none');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(v);
    }
    $list.innerHTML = [...groups.entries()].map(([key, list]) => {
      const c = Data.category(key);
      const title = key === '_' ? '' : (c ? `${c.emoji || ''} ${c.name}` : 'Sem categoria');
      const n = list.reduce((a, v) => a + v.stock, 0);
      return `
        <section class="product-group">
          ${title ? `<div class="fieldset-title">${esc(title)} <span class="dim">${n}</span></div>` : ''}
          <div class="card mobile-list">${list.map(rowHTML).join('')}</div>
        </section>`;
    }).join('');
  }

  host.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-add]')) { openQuickProduct({ mode: 'pronta', categoryId: st.cat || null, onDone: render }); return; }
    if (t.closest('[data-go-vitrine]')) { ctx?.go?.('vitrine'); return; }
    const more = t.closest('[data-more-actions]');
    if (more) {
      openMenu(more, [
        { label: 'Vitrine: fotos do catálogo', icon: 'image', onSelect: () => ctx?.go?.('vitrine') },
        { label: 'Todos os modelos (Produtos)', icon: 'box', onSelect: () => ctx?.go?.('produtos') },
      ]);
      return;
    }
    const f = t.closest('[data-filter]') || t.closest('[data-go-filter]');
    if (f) {
      st.filter = f.dataset.filter || f.dataset.goFilter;
      setPref('stock.filter', st.filter);
      host.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === st.filter)));
      render();
      return;
    }
    const c = t.closest('[data-cat]');
    if (c) { st.cat = c.dataset.cat; setPref('stock.cat', st.cat); render(); return; }
    const row = t.closest('[data-item]');
    if (row) openStockItem(row.dataset.item, { onDone: render });
  });

  const unsub = Data.subscribe((changed) => {
    if (['products', 'units', 'categories'].some((k) => changed.has(k))) render();
  });

  render();
  return {
    onSearch(q) { st.q = q; render(); },
    refresh: render,
    destroy() { unsub(); },
  };
}

/* =================================================================== */
/*  Ficha do item                                                       */
/* =================================================================== */

/**
 * Tudo de um item do estoque numa tela: fotos da cor, preço, catálogo e
 * quantidade. Nada é gravado até "Salvar" (as fotos têm o próprio editor).
 */
export function openStockItem(variantId, { onDone } = {}) {
  const v0 = Data.variant(variantId);
  const p0 = v0 ? Data.product(v0.productId) : null;
  if (!v0 || !p0) { toastError('Item não encontrado.'); return null; }
  const serial = !!p0.tracksSerial;
  const s = {
    price: v0.price,
    show: v0.showInCatalog,
    qty: Math.max(v0.stock, 0),
    // aparelhos: os que estão na loja (editáveis) + os novos desta tela
    units: Data.stockUnitsOf(v0.id).map((u) => ({ id: u.id, serial: u.serial, battery: u.batteryHealth ?? '', remove: false, u })),
  };
  let dirty = false;

  const modal = openModal({
    title: p0.name,
    subtitle: variantLabel(v0) || 'Padrão',
    size: 'lg',
    body: '<div data-item-sheet></div>',
    footer: `
      <button class="icon-btn" data-more aria-label="Mais ações">${icon('more')}</button>
      <button class="btn" data-sell title="Abrir um pedido já com este item">${icon('orders')}<span>Vender</span></button>
      <span class="grow"></span>
      <button class="btn btn-ghost hide-mobile" data-close>Cancelar</button>
      <button class="btn btn-primary" data-ok>${icon('check')} Salvar</button>`,
    beforeClose: async () => !dirty || confirmDialog({ title: 'Sair sem salvar?', message: 'As mudanças deste item ainda não foram salvas.', confirmText: 'Sair', cancelText: 'Continuar', danger: true }),
  });
  const $s = modal.body.querySelector('[data-item-sheet]');

  const photosOf = () => {
    const p = Data.product(p0.id) || p0;
    const v = Data.variant(v0.id) || v0;
    const list = v.color ? [...new Set([v.imageUrl, ...(p.colorPhotos?.[v.color] || [])].filter(Boolean))] : [p.imageUrl, ...(p.gallery || [])].filter(Boolean);
    return list;
  };
  const kept = () => s.units.filter((x) => !x.remove);

  function photosHTML() {
    const list = photosOf();
    return `
      <div class="stock-photos">
        ${list.slice(0, 4).map((u) => `<span class="thumb thumb-lg"><img src="${esc(thumbUrl(u))}" data-full="${esc(u)}" alt="" loading="lazy"></span>`).join('')}
        <button type="button" class="stock-photo-btn" data-photos>${icon(list.length ? 'edit' : 'camera')}
          <span>${list.length ? `Fotos (${list.length})` : 'Pôr fotos'}</span></button>
      </div>
      <p class="xs dim" style="margin:6px 0 0">${v0.color ? `Fotos da cor ${esc(v0.color)}: valem para todas as capacidades dessa cor no catálogo.` : 'Fotos do modelo no catálogo.'}</p>`;
  }

  function qtyHTML() {
    if (!serial) {
      return `
        <div class="field"><span class="label">Quantidade na loja</span>
          <div class="stepper">
            <button type="button" class="icon-btn" data-qty="-1" aria-label="Menos um">${icon('minus')}</button>
            <input class="input num" data-qty-input type="number" inputmode="numeric" min="0" max="9999" value="${s.qty}" aria-label="Quantidade">
            <button type="button" class="icon-btn" data-qty="1" aria-label="Mais um">${icon('plus')}</button>
          </div>
          ${s.qty !== v0.stock ? `<div class="hint">${s.qty > v0.stock ? `+${s.qty - v0.stock}` : s.qty - v0.stock} ao salvar (fica no histórico como ajuste)</div>` : ''}</div>`;
    }
    const n = kept().length;
    return `
      <div class="field"><span class="label">Aparelhos na loja · ${n} <span class="dim">(IMEI e bateria são opcionais)</span></span>
        <div class="stock-units">
          ${s.units.map((x, i) => x.remove ? '' : `
            <div class="stock-unit" data-i="${i}">
              <input class="input mono" data-f="serial" maxlength="40" inputmode="numeric" value="${esc(x.serial)}" placeholder="IMEI (opcional)" aria-label="IMEI do aparelho ${i + 1}">
              <span class="stock-bat"><input class="input" data-f="battery" type="number" inputmode="numeric" min="0" max="100" value="${esc(x.battery)}" placeholder="Bat." aria-label="Bateria %"><span class="xs dim">%</span></span>
              <button type="button" class="icon-btn sm" data-rm="${i}" aria-label="Tirar este aparelho do estoque">${icon('trash')}</button>
            </div>`).join('') || '<p class="small dim" style="margin:4px 0">Nenhum aparelho - o item sai da pronta entrega ao salvar.</p>'}
        </div>
        <button type="button" class="btn btn-sm" data-add-unit style="align-self:flex-start;margin-top:8px">${icon('plus')} Aparelho</button>
        ${s.units.some((x) => x.remove && x.id) ? `<div class="hint">${s.units.filter((x) => x.remove && x.id).length} sai(em) do estoque ao salvar (baixa no histórico - dá para desfazer em Produtos).</div>` : ''}
      </div>`;
  }

  function render() {
    $s.innerHTML = `
      <div class="col gap-4">
        ${photosHTML()}
        <div class="form-grid">
          <div class="field span-6"><label class="label" for="si-price">Preço de venda</label>
            <div class="money-input"><input class="input" id="si-price" ${MONEY_ATTRS} value="${esc(moneyInputValue(s.price))}"></div></div>
          <div class="field span-6" style="justify-content:flex-end">
            <label class="check"><input type="checkbox" data-show ${s.show ? 'checked' : ''}><span class="box"></span><span>Aparece no catálogo</span></label></div>
        </div>
        <div data-qty-box>${qtyHTML()}</div>
      </div>`;
  }
  const renderQty = () => { modal.body.querySelector('[data-qty-box]').innerHTML = qtyHTML(); };

  modal.body.addEventListener('input', (e) => {
    const t = e.target;
    dirty = true;
    if (t.id === 'si-price') { s.price = parseMoney(t.value); return; }
    if (t.matches('[data-qty-input]')) { s.qty = Math.min(Math.max(Math.trunc(Number(t.value)) || 0, 0), 9999); return; }
    const row = t.closest('[data-i]');
    if (row) s.units[Number(row.dataset.i)][t.dataset.f] = t.value;
  });
  modal.body.addEventListener('change', (e) => {
    if (e.target.matches('[data-show]')) { s.show = e.target.checked; dirty = true; }
    if (e.target.matches('[data-qty-input]')) renderQty();
  });
  modal.body.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-photos]')) {
      openColorPhotos(Data.product(p0.id) || p0, v0.color, { onDone: () => { $s.querySelector('.stock-photos')?.parentElement && render(); onDone?.(); } });
      return;
    }
    const q = t.closest('[data-qty]');
    if (q) { s.qty = Math.max(s.qty + Number(q.dataset.qty), 0); dirty = true; renderQty(); return; }
    if (t.closest('[data-add-unit]')) {
      s.units.push({ id: null, serial: '', battery: '', remove: false });
      dirty = true;
      renderQty();
      modal.body.querySelector(`[data-i="${s.units.length - 1}"] [data-f="serial"]`)?.focus();
      return;
    }
    const rm = t.closest('[data-rm]');
    if (rm) {
      const i = Number(rm.dataset.rm);
      if (s.units[i].id) s.units[i].remove = true; else s.units.splice(i, 1);
      dirty = true;
      renderQty();
    }
  });

  // Vender: o pedido já abre com este item (preço de venda e garantia da condição)
  modal.foot.querySelector('[data-sell]').addEventListener('click', async () => {
    if (dirty && !(await confirmDialog({ title: 'Vender sem salvar?', message: 'As mudanças deste item ainda não foram salvas.', confirmText: 'Vender assim', cancelText: 'Continuar', danger: true }))) return;
    const v = Data.variant(v0.id) || v0;
    const p = Data.product(p0.id) || p0;
    const warranty = Data.settings().warrantyDays || {};
    dirty = false;
    modal.close();
    const { openOrderForm } = await import('./order-form.js');
    openOrderForm({
      prefill: {
        items: [Data.newItemDraft({
          productId: p.id, categoryId: p.categoryId || '', variantId: v.id, productName: p.name,
          variant: v.storage, color: v.color, size: v.size, condition: v.condition,
          qty: 1, unitPrice: v.price, unitCost: v.cost || 0, warrantyDays: Number(warranty[v.condition]) || 0,
        })],
      },
      onSaved: () => onDone?.(),
    });
  });

  modal.foot.querySelector('[data-more]').addEventListener('click', (e) => {
    openMenu(e.currentTarget, [
      { label: 'Abrir o modelo completo', icon: 'box', onSelect: async () => { const m = await import('./products.js'); m.openProductSheet(p0.id); } },
      { label: 'Trocar capacidade, cor ou condição', icon: 'edit', onSelect: async () => {
        const m = await import('./products.js');
        m.openVariantForm(Data.variant(v0.id) || v0, { onSaved: () => { modal.close(); onDone?.(); } });
      } },
      { label: 'Tirar tudo do estoque', icon: 'trash', danger: true, separatorBefore: true, onSelect: () => {
        if (serial) s.units.forEach((x) => { if (x.id) x.remove = true; }), (s.units = s.units.filter((x) => x.id)); else s.qty = 0;
        dirty = true;
        renderQty();
        toast('Salve para confirmar', { text: 'O item sai da pronta entrega.', duration: 2200 });
      } },
    ]);
  });

  modal.foot.querySelector('[data-ok]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const v = Data.variant(v0.id) || v0;
    if (!(s.price > 0) && (serial ? kept().length : s.qty) > 0) { toast('Informe o preço de venda', { kind: 'warn' }); modal.body.querySelector('#si-price')?.focus(); return; }
    for (const x of kept()) {
      const b = String(x.battery ?? '').trim();
      if (b && !(Number(b) >= 0 && Number(b) <= 100)) { toast('Bateria entre 0 e 100%', { kind: 'warn' }); return; }
    }
    await withLoading(btn, async () => {
      try {
        if (s.price !== v.price || s.show !== v.showInCatalog) await Data.saveVariant({ ...v, price: s.price, showInCatalog: s.show });
        if (serial) {
          for (const x of s.units) {
            if (!x.id || x.remove) continue;
            const bat = String(x.battery ?? '').trim();
            if (x.serial.trim() !== x.u.serial || bat !== String(x.u.batteryHealth ?? '')) {
              await Data.saveUnit({ ...x.u, serial: x.serial, batteryHealth: bat });
            }
          }
          for (const x of s.units.filter((y) => y.id && y.remove)) await Data.discardUnit(x.id, NOTE);
          const fresh = s.units.filter((y) => !y.id && !y.remove);
          if (fresh.length) {
            await Data.addUnits(v.id, fresh.map((y) => ({ serial: y.serial, batteryHealth: String(y.battery ?? '').trim(), cost: v.cost })), 'Cadastrado na tela Estoque');
          }
        } else if (s.qty !== v.stock) {
          await Data.adjustStock(v.id, s.qty, NOTE);
        }
        dirty = false;
        modal.close();
        const left = serial ? kept().length : s.qty;
        toast('Item salvo', { text: left ? `${left} ${serial ? (left === 1 ? 'aparelho' : 'aparelhos') : 'un'} a ${money(s.price)}` : 'Saiu da pronta entrega' });
        onDone?.();
      } catch (err) {
        toastError('Não foi possível salvar', friendlyError(err));
      }
    });
  });

  render();
  return modal;
}
