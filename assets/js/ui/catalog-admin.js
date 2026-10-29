/**
 * Catálogo online (gestão): o que o cliente vê em catalogo.html.
 *
 *   - PEDIDOS: o que chegou pelo catálogo, em tempo real. "Criar pedido"
 *     abre o pedido já preenchido (cliente, variações, preços do banco);
 *   - ABERTO/FECHADO num toque, com os números do catálogo;
 *   - DIVULGAR: link, QR code para imprimir, mensagens prontas e link por
 *     categoria;
 *   - ANTES DE DIVULGAR: o que falta (foto, preço, WhatsApp da loja) com o
 *     botão que resolve;
 *   - PRODUTOS À MOSTRA: mostrar/esconder modelos;
 *   - SOB ENCOMENDA: a lista do fornecedor colada do WhatsApp vira oferta
 *     de encomenda (preço próprio + prazo), separada da pronta entrega.
 */

import * as Data from '../core/data.js';
import { friendlyError } from '../core/errors.js';
import { esc, money, formatDateTime, onlyDigits, maskPhone, waNumber, parseMoney, moneyInputValue } from '../core/utils.js';
import { openModal, confirmDialog, toast, toastError, withLoading, emptyState } from './kit.js';
import { icon } from './icons.js';
import { productThumb, categoryThumb, catalogUrl, catalogCategoryUrl, moneyHTML, priceRangeHTML, matches } from './common.js';
import { openOrderForm } from './order-form.js';
import { openWhatsappDialog, copyText } from './doc-preview.js';
import { openProductSheet } from './products.js';
import { openOrderListImport } from './order-list-import.js';

const QR_LIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm';

export function mount(host, ctx) {
  let tab = Data.catalogRequests().some((r) => r.status === 'novo') ? 'pedidos' : 'divulgar';
  let q = '';
  host.innerHTML = '<div class="view" data-root></div>';
  const root = host.querySelector('[data-root]');

  function stats() {
    const prods = Data.products().filter((p) => p.active && p.showInCatalog
      && (!p.categoryId || Data.category(p.categoryId)?.active));
    const shown = prods.filter((p) => Data.variantsOf(p.id).some((v) => v.active && v.showInCatalog && v.price > 0));
    const since = Date.now() - 30 * 86400000;
    const reqs = Data.catalogRequests().filter((r) => Date.parse(r.createdAt) >= since);
    return {
      shown: shown.length,
      noPhoto: shown.filter((p) => !p.imageUrl).length,
      inStock: shown.filter((p) => Data.productStock(p.id) > 0).length,
      noVariant: prods.filter((p) => !Data.variantsOf(p.id).some((v) => v.active && v.showInCatalog && v.price > 0)).length,
      reqs: reqs.length,
      converted: reqs.filter((r) => r.status === 'convertido').length,
    };
  }

  function render() {
    const s = Data.settings();
    const st = stats();
    const pending = Data.catalogRequests().filter((r) => r.status === 'novo').length;
    root.innerHTML = `
      <div class="section-head">
        <div><h2>Catálogo online</h2><p class="small dim">O link que você manda no WhatsApp e põe na bio do Instagram.</p></div>
        <div class="row gap-2 wrap">
          <a class="btn" href="${esc(catalogUrl())}" target="_blank" rel="noopener">${icon('eye')}<span>Ver como cliente</span></a>
        </div>
      </div>

      <div class="catalog-status card ${s.catalogEnabled ? 'is-open' : 'is-closed'}">
        <div class="row-between wrap gap-3">
          <div class="row gap-3">
            <span class="status-dot"></span>
            <div><div class="strong">${s.catalogEnabled ? 'Catálogo aberto' : 'Catálogo fechado'}</div>
              <div class="small dim">${s.catalogEnabled ? 'Qualquer pessoa com o link vê os produtos e pede pelo WhatsApp.' : 'Quem abrir o link vê só o WhatsApp da loja.'}</div></div>
          </div>
          <label class="switch"><input type="checkbox" data-toggle-open ${s.catalogEnabled ? 'checked' : ''}><span class="track"><span class="thumb"></span></span></label>
        </div>
        <div class="grid grid-kpi" style="margin-top:14px">
          <div class="kpi"><div class="kpi-label">${icon('store')} Modelos à mostra</div><div class="kpi-value num">${st.shown}</div><div class="kpi-foot">${st.inStock} com estoque</div></div>
          <div class="kpi"><div class="kpi-label">${icon('camera')} Sem foto</div><div class="kpi-value num ${st.noPhoto ? 'tone-amber' : ''}">${st.noPhoto}</div><div class="kpi-foot">vendem bem menos</div></div>
          <div class="kpi"><div class="kpi-label">${icon('orders')} Pedidos em 30 dias</div><div class="kpi-value num">${st.reqs}</div><div class="kpi-foot">${st.converted} viraram pedido</div></div>
        </div>
      </div>

      <div class="segmented tabs" role="tablist">
        <button type="button" data-tab="pedidos" aria-pressed="${tab === 'pedidos'}">Pedidos${pending ? ` <span class="count accent">${pending}</span>` : ''}</button>
        <button type="button" data-tab="divulgar" aria-pressed="${tab === 'divulgar'}">Divulgar</button>
        <button type="button" data-tab="encomenda" aria-pressed="${tab === 'encomenda'}">Sob encomenda${Data.orderOffers().length ? ` <span class="count">${Data.orderOffers().length}</span>` : ''}</button>
        <button type="button" data-tab="produtos" aria-pressed="${tab === 'produtos'}">Produtos à mostra</button>
        <button type="button" data-tab="regras" aria-pressed="${tab === 'regras'}">Regras</button>
      </div>

      <div data-tab-body></div>`;
    renderTab();
  }

  function renderTab() {
    const body = root.querySelector('[data-tab-body]');
    if (tab === 'pedidos') body.innerHTML = requestsHTML();
    if (tab === 'divulgar') { body.innerHTML = shareHTML(); drawQR(); }
    if (tab === 'produtos') body.innerHTML = productsHTML();
    if (tab === 'encomenda') body.innerHTML = offersHTML();
    if (tab === 'regras') body.innerHTML = rulesHTML();
  }

  /* ----------------------------------------------------------- pedidos -- */

  function requestsHTML() {
    const list = Data.catalogRequests().filter((r) => r.status !== 'descartado');
    if (!list.length) {
      return `<div class="card">${emptyState({ emoji: '🛍️', title: 'Nenhum pedido pelo catálogo ainda',
        text: 'Quando um cliente montar a sacola e tocar em "Enviar pelo WhatsApp", o pedido aparece aqui na hora - e o WhatsApp da loja recebe a mensagem.' })}</div>`;
    }
    return `<div class="request-list">${list.map((r) => {
      const order = r.orderId ? Data.order(r.orderId) : null;
      return `
        <div class="card request-card ${r.status === 'novo' ? 'is-new' : ''}">
          <div class="row-between gap-3">
            <div class="grow" style="min-width:0">
              <div class="strong">${esc(r.customerName)} <span class="mono xs dim">C${r.number}</span></div>
              <div class="xs dim">${esc(formatDateTime(r.createdAt))}${r.customerPhone ? ` · ${esc(maskPhone(r.customerPhone))}` : ''}</div>
            </div>
            <span class="badge" data-tone="${r.status === 'novo' ? 'blue' : 'green'}">${r.status === 'novo' ? 'Novo' : `Virou pedido${order ? ` #${String(order.code).padStart(4, '0')}` : ''}`}</span>
          </div>
          <ul class="request-items">
            ${r.items.map((i) => `<li><span>${i.qty}x ${esc(i.name)}${i.mode === 'encomenda' ? ` <span class="tag tone-indigo">encomenda${i.lead ? ` · ${esc(i.lead)}` : ''}</span>` : i.available ? '' : ' <span class="tag tone-amber">esgotou - confirmar</span>'}</span>
              <span class="num money-sensitive">${esc(money(i.unitPrice * i.qty))}</span></li>`).join('')}
          </ul>
          ${r.notes ? `<p class="small muted">"${esc(r.notes)}"</p>` : ''}
          <div class="row-between gap-2 wrap">
            <span class="strong">Total ${moneyHTML(r.total)}</span>
            <div class="row gap-2 wrap">
              ${r.customerPhone ? `<button class="btn btn-sm" data-req-wa="${esc(r.id)}">${icon('whatsapp')} Responder</button>` : ''}
              ${r.status === 'novo' ? `
                <button class="btn btn-sm btn-ghost" data-req-discard="${esc(r.id)}">${icon('x')} Descartar</button>
                <button class="btn btn-sm btn-primary" data-req-order="${esc(r.id)}">${icon('plus')} Criar pedido</button>` : ''}
            </div>
          </div>
        </div>`;
    }).join('')}</div>`;
  }

  /* ---------------------------------------------------------- divulgar -- */

  function shareHTML() {
    const s = Data.settings();
    const url = catalogUrl();
    const msgs = messages(s, url);
    const check = checklist();
    return `
      ${check.length ? `
        <div class="card">
          <div class="card-head"><h3>${icon('alert')} Antes de divulgar</h3></div>
          <div class="card-body alert-list">
            ${check.map((c) => `<button type="button" class="banner-btn tone-amber" data-fix="${c.fix}">${icon(c.icon)}<span class="grow">${esc(c.text)}</span>${icon('chevronRight')}</button>`).join('')}
          </div>
        </div>` : `<div class="alert" data-kind="info">${icon('checkCircle')}<div>Tudo pronto para divulgar.</div></div>`}

      <div class="grid grid-2">
        <div class="card">
          <div class="card-head"><h3>${icon('link')} Link do catálogo</h3></div>
          <div class="card-body col gap-3">
            <div class="link-box mono small">${esc(url)}</div>
            <div class="row gap-2 wrap">
              <button class="btn btn-primary" data-copy="${esc(url)}">${icon('copy')} Copiar link</button>
              <a class="btn" href="https://wa.me/?text=${encodeURIComponent(msgs.whatsapp)}" target="_blank" rel="noopener">${icon('whatsapp')} Mandar no WhatsApp</a>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h3>${icon('qr')} QR code</h3><span class="xs dim">para o balcão, a caixa do aparelho, o story</span></div>
          <div class="card-body col gap-3" style="align-items:center">
            <div class="qr-box" data-qr><span class="spinner"></span></div>
            <button class="btn btn-sm" data-qr-download disabled>${icon('download')} Baixar imagem</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Mensagens prontas</h3></div>
        <div class="card-body col gap-4">
          ${[['WhatsApp (lista de transmissão)', msgs.whatsapp], ['Status do WhatsApp / story', msgs.status], ['Bio do Instagram', msgs.bio]].map(([label, text]) => `
            <div class="ready-msg">
              <div class="row-between"><span class="strong small">${esc(label)}</span>
                <button class="btn btn-sm btn-ghost" data-copy="${esc(text)}">${icon('copy')} Copiar</button></div>
              <div class="wa-bubble small">${esc(text).replace(/\n/g, '<br>')}</div>
            </div>`).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Link por categoria</h3><span class="xs dim">"me manda só os iPhones"</span></div>
        <div class="card-body mobile-list">
          ${Data.categories().filter((c) => c.active).map((c) => `
            <div class="m-row">
              ${categoryThumb(c, 'sm')}
              <span class="m-main"><span class="m-title">${esc(c.name)}</span></span>
              <button class="btn btn-sm btn-ghost" data-copy="${esc(catalogCategoryUrl(c.id))}">${icon('copy')} Copiar link</button>
            </div>`).join('')}
        </div>
      </div>`;
  }

  function messages(s, url) {
    const name = s.storeName;
    return {
      whatsapp: `📱 *Catálogo ${name}*\niPhones lacrados e seminovos, Apple Watch, AirPods e mais - com preço atualizado e garantia.\n\nEscolha, monte a sacola e o pedido chega direto no nosso WhatsApp:\n${url}`,
      status: `Nosso catálogo está no ar ✨\nPreços atualizados, tudo com garantia.\nToque no link 👇\n${url}`,
      bio: `📱 iPhone · Watch · AirPods\n✅ Lacrados e seminovos com garantia\n🛍️ Catálogo: ${url}`,
    };
  }

  function checklist() {
    const s = Data.settings();
    const st = stats();
    const out = [];
    if (!s.catalogEnabled) out.push({ fix: 'open', icon: 'store', text: 'O catálogo está fechado - abra para os clientes verem os produtos.' });
    if (!waNumber(s.phone)) out.push({ fix: 'phone', icon: 'whatsapp', text: 'Falta o WhatsApp da loja (Ajustes → Dados da loja): é para onde os pedidos vão.' });
    if (st.noPhoto) out.push({ fix: 'photos', icon: 'camera', text: `${st.noPhoto} ${st.noPhoto === 1 ? 'modelo à mostra está' : 'modelos à mostra estão'} sem foto.` });
    if (st.noVariant) out.push({ fix: 'prices', icon: 'tag', text: `${st.noVariant} ${st.noVariant === 1 ? 'modelo marcado não aparece' : 'modelos marcados não aparecem'}: sem variação com preço.` });
    if (!st.shown) out.push({ fix: 'prices', icon: 'box', text: 'Nenhum produto à mostra ainda: cadastre as variações com preço em Produtos.' });
    return out;
  }

  let qrCanvas = null;
  async function drawQR() {
    const box = root.querySelector('[data-qr]');
    if (!box) return;
    try {
      const { default: qrcode } = await import(QR_LIB);
      const qr = qrcode(0, 'M');
      qr.addData(catalogUrl());
      qr.make();
      // Arte para imprimir: QR grande + nome da loja + "aponte a câmera".
      const n = qr.getModuleCount();
      const cell = 10;
      const pad = 40;
      const size = n * cell + pad * 2;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size + 90;
      const g = canvas.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
      g.fillStyle = '#0e0f11';
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect(pad + c * cell, pad + r * cell, cell, cell);
      g.textAlign = 'center';
      g.font = '600 30px Sora, system-ui, sans-serif';
      g.fillText(Data.settings().storeName, size / 2, size + 34);
      g.fillStyle = '#6e7076';
      g.font = '400 20px Sora, system-ui, sans-serif';
      g.fillText('Aponte a câmera e veja o catálogo', size / 2, size + 66);
      qrCanvas = canvas;
      if (!box.isConnected) return;
      box.innerHTML = `<img src="${canvas.toDataURL('image/png')}" alt="QR code do catálogo">`;
      const dl = root.querySelector('[data-qr-download]');
      if (dl) dl.disabled = false;
    } catch (err) {
      console.warn('QR', err);
      if (box.isConnected) box.innerHTML = '<span class="xs dim center">Sem internet para gerar o QR agora.</span>';
    }
  }

  /* ------------------------------------------------------ sob encomenda -- */

  function offersHTML() {
    const offers = Data.orderOffers();
    const head = `
      <div class="card offer-intro">
        <div class="row-between gap-3 wrap">
          <div class="grow" style="min-width:220px"><div class="strong">Catálogo de encomenda</div>
            <div class="small dim">Cole a lista que o fornecedor manda no WhatsApp: os modelos e valores são reconhecidos, você ajusta o preço de venda e publica.
              No catálogo aparecem com o selo "Sob encomenda" e o prazo.</div></div>
          <button class="btn btn-primary" data-paste-list>${icon('copy')} Colar lista do fornecedor</button>
        </div>
      </div>`;
    if (!offers.length) {
      return head + `<div class="card">${emptyState({ emoji: '📦', title: 'Nenhuma oferta de encomenda',
        text: 'Toque em "Colar lista do fornecedor". Também dá para ligar a encomenda numa variação em Produtos.' })}</div>`;
    }
    const groups = new Map();
    for (const v of offers) {
      const k = v.orderSupplier || '';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(v);
    }
    const old = Date.now() - 7 * 86400000;
    return head + [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR')).map(([sup, list]) => {
      list.sort((a, b) => Data.variantTitle(a).localeCompare(Data.variantTitle(b), 'pt-BR', { numeric: true }));
      const last = Math.max(...list.map((v) => Date.parse(v.orderUpdatedAt) || 0));
      const stale = last && last < old;
      return `
        <div class="card">
          <div class="card-head">
            <h3>${icon('truck')} ${esc(sup || 'Sem fornecedor')} <span class="count">${list.length}</span></h3>
            <div class="row gap-2 wrap">
              ${last ? `<span class="xs ${stale ? 'tone-amber' : 'dim'}">${stale ? 'lista com mais de 7 dias · ' : ''}atualizada ${esc(formatDateTime(new Date(last).toISOString()))}</span>` : ''}
              <button class="btn btn-sm btn-ghost" data-clear-supplier="${esc(sup)}">${icon('trash')} Tirar todos</button>
            </div>
          </div>
          <div class="mobile-list">
            ${list.map((v) => {
              const p = Data.product(v.productId);
              const margin = v.orderCost > 0 ? Math.round(((v.orderPrice - v.orderCost) / v.orderCost) * 100) : null;
              return `
                <div class="m-row offer-row">
                  ${productThumb(p, 'sm', v)}
                  <button type="button" class="m-main link-like" data-open-product="${esc(p.id)}">
                    <span class="m-title">${esc(Data.variantTitle(v))}</span>
                    <span class="m-sub">${v.orderLead ? `${esc(v.orderLead)} · ` : ''}${v.orderCost > 0 ? `<span class="money-sensitive">custo ${esc(money(v.orderCost))}${margin !== null ? ` · ${margin}%` : ''}</span>` : ''}${v.stock > 0 ? ' · <span class="tone-green">tem pronta entrega</span>' : ''}</span>
                  </button>
                  <div class="money-input offer-price"><input class="input" data-offer-price="${esc(v.id)}" inputmode="numeric" autocomplete="off" value="${esc(moneyInputValue(v.orderPrice))}" aria-label="Valor de venda na encomenda"></div>
                  <button class="icon-btn" data-offer-off="${esc(v.id)}" aria-label="Tirar da encomenda" title="Tirar da encomenda">${icon('x')}</button>
                </div>`;
            }).join('')}
          </div>
        </div>`;
    }).join('');
  }

  /* --------------------------------------------------- produtos à mostra -- */

  function productsHTML() {
    const list = Data.products().filter((p) => p.active && matches(q, p.name, Data.category(p.categoryId)?.name))
      .sort((a, b) => Number(b.showInCatalog) - Number(a.showInCatalog) || (Data.productStock(b.id) > 0) - (Data.productStock(a.id) > 0) || a.name.localeCompare(b.name, 'pt-BR'));
    return `
      <div class="row gap-2 wrap" style="margin-bottom:10px">
        <label class="search grow">${icon('search')}<input class="input" type="search" data-q value="${esc(q)}" placeholder="Buscar modelo…"></label>
      </div>
      <div class="card mobile-list">
        ${list.map((p) => {
          const vs = Data.variantsOf(p.id).filter((v) => v.active && v.showInCatalog && v.price > 0);
          const why = !vs.length ? 'sem variação com preço' : !p.imageUrl ? 'sem foto' : '';
          return `
            <div class="m-row">
              ${productThumb(p, 'sm')}
              <button type="button" class="m-main link-like" data-open-product="${esc(p.id)}">
                <span class="m-title">${esc(p.name)}</span>
                <span class="m-sub">${vs.length ? priceRangeHTML(p.id) : ''} ${why ? `<span class="tone-amber">${esc(why)}</span>` : ''}</span>
              </button>
              <label class="switch" title="Aparece no catálogo"><input type="checkbox" data-show="${esc(p.id)}" ${p.showInCatalog ? 'checked' : ''}><span class="track"><span class="thumb"></span></span></label>
            </div>`;
        }).join('') || '<p class="small dim" style="padding:14px">Nenhum modelo.</p>'}
      </div>`;
  }

  /* ------------------------------------------------------------- regras -- */

  function rulesHTML() {
    const s = Data.settings();
    return `
      <form class="card" data-rules>
        <div class="card-body col gap-4">
          <label class="check"><input type="checkbox" name="catalogShowOutOfStock" ${s.catalogShowOutOfStock ? 'checked' : ''}><span class="box"></span>
            <span>Mostrar o que está sem estoque <span class="xs dim block">Aparece com o selo "Sob encomenda" - o cliente ainda pode pedir. Desmarcado: só o que tem na loja.</span></span></label>
          <div class="field"><label class="label" for="cr-msg">Recado no topo do catálogo</label>
            <textarea class="textarea" id="cr-msg" name="catalogMessage" maxlength="300" rows="3" placeholder="ex.: Entregamos em Maringá no mesmo dia · parcelamos em até 12x">${esc(s.catalogMessage)}</textarea></div>
          <p class="xs dim">O preço que vale é sempre o do sistema: se mudar aqui, o catálogo e o pedido do cliente mudam juntos.
            Custo, estoque exato e IMEI nunca aparecem para o cliente.</p>
          <div class="row" style="justify-content:flex-end"><button type="submit" class="btn btn-primary">${icon('check')} Salvar</button></div>
        </div>
      </form>`;
  }

  /* ------------------------------------------------------------- ações -- */

  root.addEventListener('click', async (e) => {
    const t = e.target;
    const tb = t.closest('[data-tab]');
    if (tb) { tab = tb.dataset.tab; root.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b === tb))); renderTab(); return; }
    const cp = t.closest('[data-copy]');
    if (cp) { if (await copyText(cp.dataset.copy)) toast('Copiado'); else toastError('Não consegui copiar'); return; }
    if (t.closest('[data-qr-download]') && qrCanvas) {
      const a = document.createElement('a');
      a.href = qrCanvas.toDataURL('image/png');
      a.download = 'qr-catalogo-i7even.png';
      a.click();
      return;
    }
    const fix = t.closest('[data-fix]');
    if (fix) {
      const k = fix.dataset.fix;
      if (k === 'open') { await setOpen(true); return; }
      if (k === 'phone') { ctx.go?.('ajustes'); return; }
      if (k === 'photos') { try { localStorage.setItem('i7even.pref.products.filter', '"semfoto"'); } catch { /* */ } ctx.go?.('produtos'); return; }
      if (k === 'prices') { ctx.go?.('produtos'); return; }
    }
    if (t.closest('[data-paste-list]')) { openOrderListImport({ onDone: () => { tab = 'encomenda'; render(); } }); return; }
    const off = t.closest('[data-offer-off]');
    if (off) {
      try { await Data.clearOrderOffers([off.dataset.offerOff]); toast('Saiu da encomenda'); } catch (err) { toastError('Não foi possível', friendlyError(err)); }
      return;
    }
    const cs = t.closest('[data-clear-supplier]');
    if (cs) {
      const sup = cs.dataset.clearSupplier;
      const ids = Data.orderOffers().filter((v) => (v.orderSupplier || '') === sup).map((v) => v.id);
      const ok = await confirmDialog({ title: `Tirar ${ids.length} ofertas da encomenda?`, message: `Todas as ofertas ${sup ? `de ${sup}` : 'sem fornecedor'} saem do catálogo. O cadastro e a pronta entrega continuam.`, confirmText: 'Tirar', danger: true });
      if (!ok) return;
      try { await Data.clearOrderOffers(ids); toast('Ofertas retiradas'); } catch (err) { toastError('Não foi possível', friendlyError(err)); }
      return;
    }
    const op = t.closest('[data-open-product]');
    if (op) { openProductSheet(op.dataset.openProduct); return; }
    const ro = t.closest('[data-req-order]');
    if (ro) { orderFromRequest(Data.catalogRequest(ro.dataset.reqOrder)); return; }
    const rw = t.closest('[data-req-wa]');
    if (rw) {
      const r = Data.catalogRequest(rw.dataset.reqWa);
      openWhatsappDialog({
        text: `Olá, ${r.customerName.split(' ')[0]}! Recebi seu pedido *C${r.number}* pelo catálogo da ${Data.settings().storeName} 📱\n\n${r.items.map((i) => `▪️ ${i.qty}x ${i.name} - ${money(i.unitPrice * i.qty)}`).join('\n')}\n\n*Total: ${money(r.total)}*\n\nJá vou separar para você. Como prefere pagar e receber?`,
        phone: r.customerPhone, name: r.customerName,
      });
      return;
    }
    const rd = t.closest('[data-req-discard]');
    if (rd) {
      const ok = await confirmDialog({ title: 'Descartar este pedido do catálogo?', message: 'Ele sai da lista (fica no histórico como descartado).', confirmText: 'Descartar', danger: true });
      if (!ok) return;
      try { await Data.setCatalogRequest(rd.dataset.reqDiscard, { status: 'descartado' }); toast('Pedido descartado'); } catch (err) { toastError('Não foi possível', friendlyError(err)); }
    }
  });

  root.addEventListener('change', async (e) => {
    if (e.target.matches('[data-toggle-open]')) { await setOpen(e.target.checked); return; }
    const opr = e.target.closest('[data-offer-price]');
    if (opr) {
      const v = Data.variant(opr.dataset.offerPrice);
      const price = parseMoney(opr.value);
      if (!v || price === v.orderPrice) return;
      try { await Data.setOrderPrice(v.id, price); toast('Valor de encomenda salvo', { duration: 1500 }); } catch (err) { toastError('Não foi possível', friendlyError(err)); opr.value = moneyInputValue(v.orderPrice); }
      return;
    }
    const sh = e.target.closest('[data-show]');
    if (sh) {
      try { await Data.patchProducts([sh.dataset.show], { showInCatalog: sh.checked }); } catch (err) { toastError('Falhou', friendlyError(err)); sh.checked = !sh.checked; }
    }
  });

  root.addEventListener('input', (e) => {
    if (e.target.matches('[data-q]')) {
      q = e.target.value;
      const pos = e.target.selectionStart;
      renderTab();
      const input = root.querySelector('[data-q]');
      input?.focus();
      try { input?.setSelectionRange(pos, pos); } catch { /* */ }
    }
  });

  root.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('[type="submit"]');
    await withLoading(btn, async () => {
      try {
        await Data.saveSettings({
          catalogShowOutOfStock: f.querySelector('[name="catalogShowOutOfStock"]').checked,
          catalogMessage: f.querySelector('[name="catalogMessage"]').value,
        });
        toast('Regras salvas');
      } catch (err) { toastError('Não foi possível salvar', friendlyError(err)); }
    });
  });

  async function setOpen(open) {
    if (open && !waNumber(Data.settings().phone)) {
      const go = await confirmDialog({ title: 'Falta o WhatsApp da loja', message: 'Sem ele, o cliente não consegue mandar o pedido. Abrir assim mesmo?', confirmText: 'Abrir assim' });
      if (!go) { render(); return; }
    }
    try {
      await Data.saveSettings({ catalogEnabled: open });
      toast(open ? 'Catálogo aberto' : 'Catálogo fechado');
    } catch (err) { toastError('Não foi possível', friendlyError(err)); render(); }
  }

  const unsub = Data.subscribe((c) => {
    if (['settings', 'catalogRequests', 'products', 'categories', 'orders'].some((k) => c.has(k))) {
      // Não redesenha enquanto a pessoa digita na busca ou no recado.
      const active = document.activeElement;
      if (active && root.contains(active) && active.matches('input, textarea')) return;
      render();
    }
  });
  render();
  return { refresh: render, destroy: unsub };
}

/** Pedido do catálogo → pedido do sistema já preenchido (cliente reconhecido pelo telefone). */
export function orderFromRequest(r) {
  if (!r) return;
  const digits = onlyDigits(r.customerPhone).slice(-11);
  const cust = digits ? Data.customersList().find((c) => c.phone && onlyDigits(c.phone).slice(-11) === digits) : null;
  const warranty = Data.settings().warrantyDays || {};
  const items = r.items.map((i) => {
    const v = Data.variant(i.variantId);
    const p = v ? Data.product(v.productId) : null;
    return Data.newItemDraft(v && p ? {
      productId: p.id, categoryId: p.categoryId || '', variantId: v.id, productName: p.name,
      variant: v.storage, color: v.color, size: v.size, condition: v.condition,
      qty: i.qty, unitPrice: i.unitPrice, warrantyDays: Number(warranty[v.condition]) || 0,
      ...(i.mode === 'encomenda' ? { note: `Sob encomenda${i.lead ? ` · ${i.lead}` : ''}`, unitCost: v.orderCost || 0, costSource: v.cost > 0 ? 'auto' : 'manual' } : {}),
    } : { productName: i.name, qty: i.qty, unitPrice: i.unitPrice, costSource: 'manual' });
  });
  openOrderForm({
    prefill: {
      customerId: cust?.id || null,
      customerName: cust?.name || r.customerName,
      customerPhone: cust?.phone || r.customerPhone,
      channel: 'Catálogo',
      notes: `Pedido C${r.number} do catálogo${r.notes ? ` - "${r.notes}"` : ''}`,
      items,
    },
    onSaved: async (saved) => {
      try { await Data.setCatalogRequest(r.id, { status: 'convertido', orderId: saved.id }); } catch (err) { toastError('O pedido foi criado, mas não marquei o do catálogo', friendlyError(err)); }
    },
  });
}
