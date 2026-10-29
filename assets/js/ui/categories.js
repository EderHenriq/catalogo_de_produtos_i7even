/**
 * Categorias: a ordem aqui é a ordem do catálogo e do seletor do pedido.
 * Cada categoria tem foto (ou emoji), descrição para o catálogo, como chama
 * as opções dos modelos dela ("Armazenamento", "Caixa"...) e se os modelos
 * novos já nascem com controle por IMEI.
 */

import * as Data from '../core/data.js';
import { friendlyError } from '../core/errors.js';
import { esc } from '../core/utils.js';
import { openModal, confirmDialog, toast, toastError, withLoading, emptyState, openMenu } from './kit.js';
import { icon } from './icons.js';
import { categoryThumb, mountPhotoField, catalogCategoryUrl, listToText, textToList } from './common.js';
import { copyText } from './doc-preview.js';

const EMOJIS = ['📱', '⌚️', '💻', '📋', '🎧', '🎮', '🧴', '🔌', '🔋', '📷', '🖥️', '⌨️', '🖱️', '🕶️', '🎁', '⭐️', '🔥', '💎'];

export function mount(host) {
  host.innerHTML = `
    <div class="view">
      <div class="section-head">
        <div><h2>Categorias</h2><p class="small dim">A ordem daqui é a do catálogo e do seletor do pedido.</p></div>
        <button class="btn btn-primary" data-new-cat>${icon('plus')} Categoria</button>
      </div>
      <div data-list></div>
    </div>`;
  const $list = host.querySelector('[data-list]');

  function render() {
    const cats = Data.categories();
    const orphan = Data.products().filter((p) => p.active && !p.categoryId).length;
    if (!cats.length) {
      $list.innerHTML = `<div class="card">${emptyState({ emoji: '🗂️', title: 'Nenhuma categoria',
        text: 'Rode o supabase/seed_catalogo.sql (iPhone, Watch, Mac, iPad, AirPods, consoles, perfumes, acessórios) ou crie a primeira.',
        action: `<button class="btn btn-primary" data-new-cat>${icon('plus')} Criar categoria</button>` })}</div>`;
      return;
    }
    $list.innerHTML = `
      ${orphan ? `<div class="alert" data-kind="warn">${icon('alert')}<div>${orphan} ${orphan === 1 ? 'modelo está' : 'modelos estão'} sem categoria - no catálogo eles aparecem só na busca.</div></div>` : ''}
      <div class="card mobile-list">
        ${cats.map((c, i) => {
          const n = Data.products().filter((p) => p.categoryId === c.id && p.active).length;
          return `
            <div class="m-row cat-row${c.active ? '' : ' is-muted'}" data-cat="${esc(c.id)}">
              <div class="cat-order">
                <button type="button" class="icon-btn sm" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Subir">${icon('arrowUp')}</button>
                <button type="button" class="icon-btn sm" data-down="${i}" ${i === cats.length - 1 ? 'disabled' : ''} aria-label="Descer">${icon('arrowDown')}</button>
              </div>
              <button type="button" class="catrow-main" data-edit="${esc(c.id)}">
                ${categoryThumb(c, 'md')}
                <span class="m-main">
                  <span class="m-title">${esc(c.name)}</span>
                  <span class="m-sub">${n} ${n === 1 ? 'modelo' : 'modelos'}${c.tracksSerial ? ` · ${icon('device')} IMEI` : ''}${c.active ? '' : ' · fora do catálogo'}</span>
                </span>
              </button>
              <button type="button" class="icon-btn" data-menu="${esc(c.id)}" aria-label="Mais">${icon('more')}</button>
            </div>`;
        }).join('')}
      </div>`;
  }

  host.addEventListener('click', async (e) => {
    if (e.target.closest('[data-new-cat]')) { openCategoryForm({}); return; }
    const up = e.target.closest('[data-up]');
    const down = e.target.closest('[data-down]');
    if (up || down) {
      const ids = Data.categories().map((c) => c.id);
      const i = Number((up || down).dataset[up ? 'up' : 'down']);
      const j = up ? i - 1 : i + 1;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      try { await Data.reorderCategories(ids); } catch (err) { toastError('Não foi possível mudar a ordem', friendlyError(err)); }
      return;
    }
    const ed = e.target.closest('[data-edit]');
    if (ed) { openCategoryForm(Data.category(ed.dataset.edit)); return; }
    const m = e.target.closest('[data-menu]');
    if (m) {
      const c = Data.category(m.dataset.menu);
      openMenu(m, [
        { label: 'Editar', icon: 'edit', onSelect: () => openCategoryForm(c) },
        { label: 'Copiar link da categoria', icon: 'link', onSelect: async () => { if (await copyText(catalogCategoryUrl(c.id))) toast('Link copiado'); } },
        { label: c.active ? 'Esconder do catálogo' : 'Mostrar no catálogo', icon: c.active ? 'eyeOff' : 'eye',
          onSelect: () => Data.saveCategory({ ...c, active: !c.active }).catch((err) => toastError('Falhou', friendlyError(err))) },
        { label: 'Excluir', icon: 'trash', danger: true, separatorBefore: true, onSelect: () => removeCategory(c) },
      ]);
    }
  });

  const unsub = Data.subscribe((c) => { if (c.has('categories') || c.has('products')) render(); });
  render();
  return { refresh: render, destroy: unsub };
}

async function removeCategory(c) {
  const n = Data.products().filter((p) => p.categoryId === c.id).length;
  const others = Data.categories().filter((x) => x.id !== c.id);
  let moveTo = null;
  if (n) {
    const m = openModal({
      title: `Excluir ${c.name}?`,
      sheet: true,
      body: `<p class="muted">${n} ${n === 1 ? 'modelo usa' : 'modelos usam'} esta categoria. Para onde ${n === 1 ? 'ele vai' : 'eles vão'}?</p>
        <select class="select" data-dest><option value="">Sem categoria</option>
          ${others.map((o) => `<option value="${esc(o.id)}">${esc(o.emoji || '')} ${esc(o.name)}</option>`).join('')}</select>`,
      footer: '<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-danger" data-ok>Excluir</button>',
    });
    m.foot.querySelector('[data-ok]').addEventListener('click', async (e) => {
      moveTo = m.body.querySelector('[data-dest]').value || null;
      await withLoading(e.currentTarget, async () => {
        try { await Data.deleteCategory(c.id, moveTo); m.close(); toast('Categoria excluída'); } catch (err) { toastError('Não foi possível', friendlyError(err)); }
      });
    });
    return;
  }
  const ok = await confirmDialog({ title: `Excluir ${c.name}?`, confirmText: 'Excluir', danger: true });
  if (!ok) return;
  try { await Data.deleteCategory(c.id); toast('Categoria excluída'); } catch (err) { toastError('Não foi possível', friendlyError(err)); }
}

export function openCategoryForm(c = {}) {
  const editing = !!c.id;
  const d = {
    id: c.id || null, name: c.name || '', emoji: c.emoji || '📦', image: c.image || '', description: c.description || '',
    variantLabel: c.variantLabel || 'Armazenamento', colorLabel: c.colorLabel || 'Cor', sizeLabel: c.sizeLabel || 'Tamanho',
    tracksSerial: !!c.tracksSerial, bands: c.bands || [], active: c.active !== false,
  };
  const modal = openModal({
    title: editing ? 'Editar categoria' : 'Nova categoria',
    size: 'lg',
    body: `
      <div class="form-grid">
        <div class="field span-8"><label class="label" for="cg-name">Nome *</label>
          <input class="input" id="cg-name" name="name" maxlength="60" value="${esc(d.name)}" placeholder="ex.: iPhone" data-autofocus></div>
        <div class="field span-4"><span class="label">Prévia no catálogo</span><div class="cat-preview" data-preview></div></div>
        <div class="field span-12"><span class="label">Emoji <span class="dim">(aparece quando não tem foto)</span></span>
          <div class="chips">${EMOJIS.map((em) => `<button type="button" class="chip emoji-chip" data-emoji="${em}" aria-pressed="${em === d.emoji}">${em}</button>`).join('')}</div></div>
        <div class="field span-5"><span class="label">Foto <span class="dim">(opcional)</span></span><div data-photo></div></div>
        <div class="field span-7"><label class="label" for="cg-desc">Descrição no catálogo</label>
          <textarea class="textarea" id="cg-desc" name="description" maxlength="240" rows="4" placeholder="ex.: iPhones lacrados e seminovos com garantia.">${esc(d.description)}</textarea></div>
        <div class="span-12 fieldset-title">Como os modelos desta categoria chamam as opções</div>
        <div class="field span-4"><label class="label" for="cg-vl">Variação</label>
          <input class="input" id="cg-vl" name="variantLabel" maxlength="30" value="${esc(d.variantLabel)}" placeholder="Armazenamento"></div>
        <div class="field span-4 span-half-mobile"><label class="label" for="cg-cl">Cor</label>
          <input class="input" id="cg-cl" name="colorLabel" maxlength="30" value="${esc(d.colorLabel)}"></div>
        <div class="field span-4 span-half-mobile"><label class="label" for="cg-sl">Tamanho</label>
          <input class="input" id="cg-sl" name="sizeLabel" maxlength="30" value="${esc(d.sizeLabel)}" placeholder="Caixa"></div>
        <div class="field span-12"><label class="label" for="cg-bands">Pulseiras / extras escolhidos na venda <span class="dim">(opcional, separe por vírgula)</span></label>
          <input class="input" id="cg-bands" name="bands" value="${esc(listToText(d.bands))}" placeholder="ex.: Esportiva, Loop solo, Milanese"></div>
        <div class="field span-12"><label class="check"><input type="checkbox" name="tracksSerial" ${d.tracksSerial ? 'checked' : ''}><span class="box"></span>
          <span>Modelos novos desta categoria têm IMEI / número de série <span class="xs dim block">Só o padrão: cada modelo pode mudar no próprio cadastro.</span></span></label></div>
        <div class="field span-12"><label class="check"><input type="checkbox" name="active" ${d.active ? 'checked' : ''}><span class="box"></span>
          <span>Aparece no catálogo <span class="xs dim block">Escondida, os modelos dela também saem do catálogo (continuam no sistema).</span></span></label></div>
      </div>
      <div class="alert hide" data-erro data-kind="warn">${icon('alert')}<div data-erro-txt></div></div>`,
    footer: '<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Salvar</button>',
    beforeClose: async () => { photo.discarded(false).forEach((u) => Data.deleteProductImage(u)); photo.dispose(); return true; },
  });
  const $ = (n) => modal.body.querySelector(`[name="${n}"]`);
  const photo = mountPhotoField(modal.body.querySelector('[data-photo]'), {
    value: d.image, label: 'Foto da categoria', onChange: (u) => { d.image = u; preview(); },
  });
  const preview = () => {
    d.name = $('name').value;
    modal.body.querySelector('[data-preview]').innerHTML = `<span class="chip cat-chip-preview">${categoryThumb(d, 'xs')}${esc(d.name || 'Categoria')}</span>`;
  };
  modal.body.addEventListener('input', (e) => { if (e.target.name === 'name') preview(); });
  modal.body.addEventListener('click', (e) => {
    const em = e.target.closest('[data-emoji]');
    if (!em) return;
    d.emoji = em.dataset.emoji;
    modal.body.querySelectorAll('[data-emoji]').forEach((b) => b.setAttribute('aria-pressed', String(b === em)));
    preview();
  });
  modal.foot.querySelector('[data-ok]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const row = {
      ...d, name: $('name').value.trim(), image: photo.value, description: $('description').value,
      variantLabel: $('variantLabel').value, colorLabel: $('colorLabel').value, sizeLabel: $('sizeLabel').value,
      bands: textToList($('bands').value), tracksSerial: $('tracksSerial').checked, active: $('active').checked,
    };
    if (!row.name) { $('name').focus(); return; }
    if (photo.busy) return;
    await withLoading(btn, async () => {
      try {
        const saved = await Data.saveCategory(row);
        photo.discarded(true).forEach((u) => Data.deleteProductImage(u));
        if (photo.replaced()) Data.deleteProductImage(photo.replaced(), { except: saved.id });
        photo.dispose();
        modal.close();
        toast(editing ? 'Categoria atualizada' : 'Categoria criada');
      } catch (err) {
        modal.body.querySelector('[data-erro-txt]').textContent = friendlyError(err);
        modal.body.querySelector('[data-erro]').classList.remove('hide');
      }
    });
  });
  preview();
}
