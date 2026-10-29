/** Peças de tela usadas em vários módulos: busca, miniaturas, selos, campo de foto, preferências. */

import * as Data from '../core/data.js';
import { variantLabel, stockLevel } from '../core/calc.js';
import { friendlyError } from '../core/errors.js';
import { esc, money, thumbUrl } from '../core/utils.js';
import { toast, toastError, openModal } from './kit.js';
import { icon } from './icons.js';

/* ------------------------------------------------------------- busca --- */

/** Minúsculas e sem acento: "Titânio" acha "titanio", "PRO MAX" acha "pro max". */
export function norm(s) {
  return String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

/** Todas as palavras da busca aparecem em algum dos campos (em qualquer ordem). */
export function matches(query, ...fields) {
  const q = norm(query);
  if (!q) return true;
  const hay = norm(fields.filter(Boolean).join(' '));
  return q.split(/\s+/).every((w) => hay.includes(w));
}

/* -------------------------------------------------------- miniaturas --- */

/**
 * Foto do modelo (ou da variação, quando ela tem a própria - ex.: a cor);
 * sem foto, o emoji da categoria. Listas usam a miniatura (~15 KB); foto sem
 * miniatura cai na grande (data-full + installThumbFallback).
 */
export function productThumb(p, size = 'md', v = null) {
  const url = v?.imageUrl || (v?.color && p?.colorPhotos?.[v.color]?.[0]) || p?.imageUrl || Object.values(p?.colorPhotos || {})[0]?.[0] || '';
  if (url) {
    const src = size === 'lg' || size === 'xl' ? url : thumbUrl(url);
    return `<span class="thumb thumb-${size}"><img src="${esc(src)}" data-full="${esc(url)}" alt="" loading="lazy" decoding="async"></span>`;
  }
  const cat = p ? Data.category(p.categoryId) : null;
  const big = size === 'lg' || size === 'xl';
  return `<span class="thumb thumb-${size} thumb-emoji" aria-hidden="true">${esc(cat?.emoji || '📦')}${big ? `<span class="thumb-nophoto">${icon('camera')}</span>` : ''}</span>`;
}

export function categoryThumb(c, size = 'sm') {
  if (c?.image) {
    const src = size === 'xl' ? c.image : thumbUrl(c.image);
    return `<span class="thumb thumb-${size}"><img src="${esc(src)}" data-full="${esc(c.image)}" alt="" loading="lazy"></span>`;
  }
  return `<span class="thumb thumb-${size} thumb-emoji" aria-hidden="true">${esc(c?.emoji || '📦')}</span>`;
}

/* ------------------------------------------------------------- selos --- */

/** "3 un" (verde), "Baixo · 1 un" (âmbar), "Zerado" (vermelho). */
export function stockBadge(stock, minStock = 0, { compact = false, serial = false } = {}) {
  const lvl = stockLevel(stock, minStock);
  const unit = `${stock} ${serial ? (stock === 1 ? 'aparelho' : 'aparelhos') : 'un'}`;
  if (lvl === 'zerado') return `<span class="badge" data-tone="red">${stock < 0 ? `${stock} un` : 'Zerado'}</span>`;
  if (lvl === 'baixo') return `<span class="badge" data-tone="amber">${compact ? unit : `Baixo · ${unit}`}</span>`;
  return `<span class="badge" data-tone="green">${compact ? stock : unit}</span>`;
}

export function variantStockBadge(v, opts = {}) {
  const p = Data.product(v.productId);
  return stockBadge(v.stock, v.minStock, { serial: !!p?.tracksSerial, ...opts });
}

/** "#0042" */
export const code = (n) => (n == null ? '-' : `#${String(n).padStart(4, '0')}`);

/** "128GB · Preto · Lacrado" */
export { variantLabel };

export const moneyHTML = (v, cls = '') => `<span class="num money-sensitive ${cls}">${esc(money(v))}</span>`;

/** Faixa de preço de um modelo: "R$ 4.299" ou "R$ 4.299 – 5.899". */
export function priceRangeHTML(productId) {
  const r = Data.priceRange(productId);
  if (!r) return '<span class="dim small">sem preço</span>';
  if (r.min === r.max) return moneyHTML(r.min);
  return `<span class="num money-sensitive">${esc(money(r.min))}<span class="dim"> – </span>${esc(money(r.max).replace('R$', '').trim())}</span>`;
}

/* ------------------------------------------------------------ catálogo --- */

/** Endereço do catálogo público (mesmo site, página catalogo.html). */
export function catalogUrl(productId = '') {
  const base = `${location.origin}${location.pathname.replace(/[^/]*$/, '')}catalogo.html`;
  return productId ? `${base}#p=${encodeURIComponent(productId)}` : base;
}

/** Link do catálogo já aberto numa categoria ("manda só os iPhones"). */
export function catalogCategoryUrl(categoryId) {
  return `${catalogUrl()}#c=${encodeURIComponent(categoryId)}`;
}

/* ------------------------------------------------------- campo de foto --- */

const TOUCH = window.matchMedia('(hover: none) and (pointer: coarse)');

/**
 * Campo de foto: no celular, "Câmera" abre direto a câmera traseira e
 * "Galeria" as fotos do aparelho; no computador, escolher arquivo,
 * arrastar ou colar (Ctrl+V). A foto é reduzida e enviada na hora; o
 * formulário só guarda a URL.
 *
 * Fotos enviadas e depois trocadas/descartadas sem salvar vão para
 * `discarded()` - quem chama apaga do Storage ao fechar.
 *
 * @param {HTMLElement} box
 * @param {{ value?: string, label?: string, onChange?: (url: string) => void }} opts
 */
export function mountPhotoField(box, { value = '', label = 'Foto', onChange } = {}) {
  let url = value;
  let busy = false;
  const original = value;
  const uploaded = new Set();

  function render() {
    box.innerHTML = `
      <div class="photo-field">
        <div class="photo-frame${busy ? ' is-busy' : ''}" data-drop title="${TOUCH.matches ? '' : 'Arraste uma imagem para cá'}">
          ${url ? `<img src="${esc(url)}" alt="${esc(label)}">` : `<span class="photo-empty">${icon('camera')}<span>Sem foto</span></span>`}
          ${busy ? '<span class="photo-busy"><span class="spinner"></span><span class="xs">Enviando…</span></span>' : ''}
        </div>
        <div class="photo-actions">
          ${TOUCH.matches ? `
            <label class="btn btn-sm photo-btn${busy ? ' is-disabled' : ''}">${icon('camera')}<span>Câmera</span>
              <input type="file" accept="image/*" capture="environment" data-file hidden ${busy ? 'disabled' : ''}></label>
            <label class="btn btn-sm photo-btn${busy ? ' is-disabled' : ''}">${icon('image')}<span>Galeria</span>
              <input type="file" accept="image/*" data-file hidden ${busy ? 'disabled' : ''}></label>`
          : `<label class="btn btn-sm photo-btn${busy ? ' is-disabled' : ''}">${icon('image')}<span>${url ? 'Trocar foto' : 'Escolher foto'}</span>
              <input type="file" accept="image/*" data-file hidden ${busy ? 'disabled' : ''}></label>`}
          ${url && !busy ? `<button type="button" class="btn btn-ghost btn-sm" data-rm-photo>${icon('trash')}<span>Remover</span></button>` : ''}
        </div>
        ${TOUCH.matches ? '' : '<span class="xs dim photo-tip">ou arraste / cole a imagem (Ctrl+V)</span>'}
      </div>`;
  }

  async function take(file) {
    if (!file || busy) return;
    if (!/^image\//.test(file.type || 'image/')) { toastError('Isso não é uma imagem', 'Escolha uma foto JPG, PNG ou HEIC.'); return; }
    busy = true;
    render();
    try {
      const next = await Data.uploadProductImage(file);
      uploaded.add(next);
      url = next;
      onChange?.(url);
    } catch (err) {
      toastError('Não consegui enviar a foto', friendlyError(err));
    } finally {
      busy = false;
      render();
    }
  }

  box.addEventListener('change', (e) => {
    const input = e.target.closest('[data-file]');
    if (input?.files?.[0]) take(input.files[0]);
  });
  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-rm-photo]')) { url = ''; onChange?.(url); render(); }
  });
  box.addEventListener('dragover', (e) => { e.preventDefault(); box.querySelector('[data-drop]')?.classList.add('is-over'); });
  box.addEventListener('dragleave', () => box.querySelector('[data-drop]')?.classList.remove('is-over'));
  box.addEventListener('drop', (e) => {
    e.preventDefault();
    box.querySelector('[data-drop]')?.classList.remove('is-over');
    take(e.dataTransfer?.files?.[0]);
  });
  const onPaste = (e) => {
    if (!box.isConnected) { document.removeEventListener('paste', onPaste); return; }
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) { e.preventDefault(); take(file); }
  };
  if (!TOUCH.matches) document.addEventListener('paste', onPaste);

  render();
  return {
    get value() { return url; },
    get busy() { return busy; },
    /** Fotos que subiram nesta edição e não ficaram (trocadas ou descartadas). */
    discarded(saved) {
      const keep = saved ? url : original;
      return [...uploaded].filter((u) => u !== keep);
    },
    /** Foto antiga que deixou de ser usada depois de salvar. */
    replaced() {
      return original && original !== url ? original : '';
    },
    dispose() { document.removeEventListener('paste', onPaste); },
  };
}

/* -------------------------------------------- galeria de fotos (modelo) -- */

const MAX_PHOTOS = 9;   // capa + 8 extras (products.gallery ≤ 8)

/**
 * Fotos do modelo: a primeira é a CAPA (lista, pedido, cartão do catálogo);
 * as outras viram o carrossel da ficha no catálogo.
 *   - várias de uma vez (Galeria / escolher arquivos), enviadas em sequência;
 *   - "Enquadrar com fundo branco" (padrão): todas as fotos ficam quadradas,
 *     com o aparelho inteiro - o catálogo fica alinhado como vitrine;
 *   - "Tornar capa" e "Remover" em cada foto; arrastar/colar no computador.
 *
 * @param {HTMLElement} box
 * @param {{ cover?: string, gallery?: string[], label?: string, max?: number }} opts
 */
export function mountGalleryField(box, { cover = '', gallery = [], label = 'Foto', max = MAX_PHOTOS } = {}) {
  let photos = [cover, ...gallery].filter(Boolean);
  const original = new Set(photos);
  const uploaded = new Set();
  let queue = 0;
  let done = 0;
  let square = pref('photo.square', true);

  function render() {
    const busy = queue > 0;
    box.innerHTML = `
      <div class="gallery-field">
        <div class="gallery-grid">
          ${photos.map((u, i) => `
            <div class="gallery-tile${i === 0 ? ' is-cover' : ''}">
              <img src="${esc(thumbUrl(u))}" data-full="${esc(u)}" alt="${esc(label)} ${i + 1}" loading="lazy">
              ${i === 0 ? '<span class="gallery-badge">Capa</span>' : ''}
              <div class="gallery-tools">
                ${i > 0 ? `<button type="button" class="icon-btn sm" data-cover="${i}" aria-label="Tornar capa" title="Tornar capa">${icon('star')}</button>` : ''}
                ${i > 1 ? `<button type="button" class="icon-btn sm" data-left="${i}" aria-label="Mover para a esquerda" title="Mover">${icon('chevronLeft')}</button>` : ''}
                <button type="button" class="icon-btn sm" data-rm="${i}" aria-label="Remover foto" title="Remover">${icon('x')}</button>
              </div>
            </div>`).join('')}
          ${busy ? `<div class="gallery-tile is-busy"><span class="spinner"></span><span class="xs">Enviando ${done + 1} de ${done + queue}</span></div>` : ''}
          ${photos.length + queue < max ? `
            <div class="gallery-add" data-drop>
              ${TOUCH.matches ? `
                <label class="gallery-add-btn">${icon('camera')}<span>Câmera</span>
                  <input type="file" accept="image/*" capture="environment" data-file hidden></label>
                <label class="gallery-add-btn">${icon('image')}<span>Galeria</span>
                  <input type="file" accept="image/*" multiple data-file hidden></label>`
              : `<label class="gallery-add-btn wide">${icon('image')}<span>${photos.length ? 'Adicionar fotos' : 'Escolher fotos'}</span>
                  <input type="file" accept="image/*" multiple data-file hidden></label>`}
            </div>` : ''}
        </div>
        <label class="check xs"><input type="checkbox" data-square ${square ? 'checked' : ''}><span class="box"></span>
          <span>Enquadrar com fundo branco <span class="dim">(recomendado: o catálogo fica alinhado)</span></span></label>
        ${TOUCH.matches ? '' : `<span class="xs dim">Arraste fotos para cá ou cole (Ctrl+V). Até ${max} fotos; a primeira é a capa.</span>`}
      </div>`;
  }

  async function take(files) {
    const list = [...(files || [])].filter((f) => /^image\//.test(f.type || 'image/')).slice(0, max - photos.length - queue);
    if (!list.length) return;
    queue += list.length;
    render();
    for (const file of list) {
      try {
        const url = await Data.uploadProductImage(file, { square });
        uploaded.add(url);
        photos.push(url);
      } catch (err) {
        toastError('Uma foto não foi enviada', friendlyError(err));
      } finally {
        queue -= 1;
        done += 1;
        if (!queue) done = 0;
        render();
      }
    }
  }

  box.addEventListener('change', (e) => {
    const input = e.target.closest('[data-file]');
    if (input?.files?.length) { take(input.files); return; }
    if (e.target.matches('[data-square]')) { square = e.target.checked; setPref('photo.square', square); }
  });
  box.addEventListener('click', (e) => {
    const c = e.target.closest('[data-cover]');
    if (c) { const i = Number(c.dataset.cover); photos.unshift(...photos.splice(i, 1)); render(); return; }
    const l = e.target.closest('[data-left]');
    if (l) { const i = Number(l.dataset.left); [photos[i - 1], photos[i]] = [photos[i], photos[i - 1]]; render(); return; }
    const rm = e.target.closest('[data-rm]');
    if (rm) { photos.splice(Number(rm.dataset.rm), 1); render(); }
  });
  box.addEventListener('dragover', (e) => { e.preventDefault(); box.querySelector('[data-drop]')?.classList.add('is-over'); });
  box.addEventListener('dragleave', () => box.querySelector('[data-drop]')?.classList.remove('is-over'));
  box.addEventListener('drop', (e) => {
    e.preventDefault();
    box.querySelector('[data-drop]')?.classList.remove('is-over');
    take(e.dataTransfer?.files);
  });
  const onPaste = (e) => {
    if (!box.isConnected) { document.removeEventListener('paste', onPaste); return; }
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); take(files); }
  };
  if (!TOUCH.matches) document.addEventListener('paste', onPaste);

  render();
  return {
    get cover() { return photos[0] || ''; },
    get gallery() { return photos.slice(1); },
    get busy() { return queue > 0; },
    /** Mudou alguma coisa nas fotos? */
    get dirty() { return photos.join('|') !== [...original].join('|'); },
    /** Fotos para apagar do Storage: ao salvar, as que saíram; ao cancelar, as que subiram agora. */
    toDelete(saved) {
      const keep = new Set(saved ? photos : original);
      return [...new Set([...uploaded, ...(saved ? original : [])])].filter((u) => !keep.has(u));
    },
    dispose() { document.removeEventListener('paste', onPaste); },
  };
}

/**
 * Fotos de UMA cor do modelo (as que o cliente vê ao escolher a cor no
 * catálogo): várias, a primeira é a principal, trocar a ordem, remover e
 * adicionar - Estoque e ficha do modelo. A foto que uma variação dessa cor
 * guardava sozinha entra na lista (e sai da variação ao salvar). Sem cor
 * (ex.: perfume, acessório): as fotos do próprio modelo.
 */
export function openColorPhotos(product, color, { onDone } = {}) {
  const p = Data.product(product.id) || product;
  const own = color ? Data.variantsOf(p.id).filter((v) => v.color === color && v.imageUrl).map((v) => v.imageUrl) : [];
  const start = color ? [...new Set([...(p.colorPhotos?.[color] || []), ...own])] : [p.imageUrl, ...(p.gallery || [])].filter(Boolean);
  let saved = false;
  let field = null;
  const modal = openModal({
    title: color ? `Fotos · ${color}` : 'Fotos do modelo',
    subtitle: p.name,
    size: 'lg',
    body: `<p class="small muted" style="margin:0 0 12px">${color ? `O cliente vê estas fotos ao escolher <b>${esc(color)}</b> no catálogo.` : 'As fotos do modelo no catálogo.'} A primeira é a principal (estrela = tornar principal).</p><div data-g></div>`,
    footer: '<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Salvar fotos</button>',
    // fechou sem salvar: as fotos que subiram agora saem do Storage
    onClose: () => {
      if (!saved && field) field.toDelete(false).forEach((u) => Data.deleteProductImage(u));
      field?.dispose();
    },
  });
  field = mountGalleryField(modal.body.querySelector('[data-g]'), { cover: start[0] || '', gallery: start.slice(1), label: color || p.name, max: color ? 8 : MAX_PHOTOS });
  modal.foot.querySelector('[data-ok]').addEventListener('click', async (e) => {
    if (field.busy) { toast('Espere as fotos terminarem de subir', { kind: 'warn' }); return; }
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      if (!color) { if (field.dirty) await Data.saveProduct({ ...(Data.product(p.id) || p), imageUrl: field.cover, gallery: field.gallery }); }
      else if (field.dirty || own.length) await Data.setColorPhotos(p.id, color, [field.cover, ...field.gallery]);
      field.toDelete(true).forEach((u) => Data.deleteProductImage(u));
      saved = true;
      modal.close();
      toast(color ? `Fotos da cor ${color} salvas` : 'Fotos salvas', { text: 'Já aparecem no catálogo.' });
      onDone?.();
    } catch (err) {
      btn.disabled = false;
      toastError('Não consegui salvar as fotos', friendlyError(err));
    }
  });
  return modal;
}

/**
 * Foto rápida: abre a câmera/galeria e já grava no modelo, sem passar pelo
 * formulário - para fotografar o estoque em sequência. Sem capa, a foto vira
 * a capa; com capa, entra na galeria.
 */
export function quickPhoto(product, { camera = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (camera) input.setAttribute('capture', 'environment');
    else input.multiple = true;
    input.addEventListener('change', async () => {
      const files = [...(input.files || [])];
      if (!files.length) { resolve(false); return; }
      const p = Data.product(product.id) || product;
      let cover = p.imageUrl;
      const gallery = [...p.gallery];
      try {
        for (const f of files.slice(0, MAX_PHOTOS - (cover ? 1 : 0) - gallery.length)) {
          const url = await Data.uploadProductImage(f, { square: pref('photo.square', true) });
          if (!cover) cover = url; else gallery.push(url);
        }
        await Data.saveProduct({ ...p, imageUrl: cover, gallery });
        resolve(true);
      } catch (err) {
        toastError('Não consegui salvar a foto', friendlyError(err));
        resolve(false);
      }
    });
    input.click();
  });
}

/* ------------------------------------------------- preferência da tela -- */

/** Lembra filtros simples entre aberturas (só neste aparelho). */
export function pref(key, fallback) {
  try {
    const v = localStorage.getItem(`i7even.pref.${key}`);
    return v === null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
export function setPref(key, value) {
  try { localStorage.setItem(`i7even.pref.${key}`, JSON.stringify(value)); } catch { /* modo privado */ }
}

/* --------------------------------------------------------- listas de texto */

/** "128GB, 256GB, 512GB" ⇄ ['128GB','256GB','512GB'] (campo de opções do modelo). */
export const listToText = (a) => (a || []).join(', ');
export const textToList = (s) => [...new Set(String(s || '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean))];
