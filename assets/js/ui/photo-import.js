/**
 * Importar pasta de fotos (no computador): escolhe a pasta "Imagens" e o
 * sistema liga cada foto ao seu lugar - foto da categoria, capa do modelo e
 * fotos de cada cor - pela estrutura Categoria / Modelo / Cor / fotos
 * (core/photo-folder.js). Mostra a prévia antes de enviar: o que vai ligar,
 * modelos que faltam (cria com um toque), fotos pequenas demais e o que não
 * reconheceu.
 *
 * Rodar de novo é seguro: por padrão só preenche o que está SEM foto - dá para
 * ir baixando mais fotos e importar a pasta outra vez.
 */

import * as Data from '../core/data.js';
import { planFolder } from '../core/photo-folder.js';
import { friendlyError } from '../core/errors.js';
import { esc } from '../core/utils.js';
import { openModal, toast, toastError, confirmDialog } from './kit.js';
import { icon } from './icons.js';

const MIN_PX = 600;

export function openPhotoImport({ onDone } = {}) {
  const opts = { replace: false, create: true, perColor: 4 };
  let plan = null;
  let dims = new Map();   // arquivo → lado maior em px
  let running = false;

  const modal = openModal({
    title: 'Importar pasta de fotos',
    subtitle: 'Categoria / Modelo / Cor / fotos - cada foto vai para o seu lugar',
    size: 'xl',
    body: '<div data-pi></div>',
    footer: '<span class="grow small dim" data-pi-foot></span><button class="btn btn-ghost" data-close>Fechar</button><button class="btn btn-primary" data-go hidden>Enviar fotos</button>',
    beforeClose: async () => !running || confirmDialog({ title: 'Parar o envio?', message: 'As fotos que já subiram ficam.', confirmText: 'Parar', danger: true }),
  });
  modal.panel.classList.add('pi-modal');
  const $b = modal.body.querySelector('[data-pi]');
  const $go = modal.foot.querySelector('[data-go]');
  const $foot = modal.foot.querySelector('[data-pi-foot]');

  function renderPick() {
    $b.innerHTML = `
      <div class="pi-pick">
        <span class="pi-pick-ic">${icon('image')}</span>
        <div>
          <p class="strong">Escolha a pasta <b>Imagens</b> (ou só a pasta de uma categoria)</p>
          <p class="small dim">Organização: <span class="mono xs">01_iPhone / iPhone 16 Pro / Titânio preto / foto.webp</span>.
            Uma foto chamada <b>categoria</b> na pasta da categoria vira a foto da categoria; na pasta do modelo, vira a capa dele.</p>
          <p class="small dim">As fotos são reduzidas (até 1600 px, com miniatura para a vitrine) e enquadradas em fundo branco antes de subir.</p>
          <label class="btn btn-primary">${icon('upload')} Escolher pasta
            <input type="file" data-dir webkitdirectory directory multiple hidden></label>
        </div>
      </div>`;
    $go.hidden = true;
  }

  async function analyse(fileList) {
    const files = [...fileList].map((file) => ({ path: file.webkitRelativePath || file.name, file, size: file.size }));
    plan = planFolder(files, {
      categories: Data.categories(),
      products: Data.products().filter((p) => p.active !== false),
    });
    $b.innerHTML = '<p class="small dim"><span class="spinner"></span> Conferindo o tamanho das fotos…</p>';
    dims = new Map();
    const all = allFiles();
    await Promise.all(all.map(async (f) => {
      try { const bmp = await createImageBitmap(f.file); dims.set(f, Math.max(bmp.width, bmp.height)); bmp.close?.(); } catch { dims.set(f, 0); }
    }));
    renderPlan();
  }

  function allFiles() {
    if (!plan) return [];
    return [
      ...plan.categories.map((c) => c.cover).filter(Boolean),
      ...plan.models.flatMap((m) => [m.cover, ...m.colors.flatMap((c) => c.files.slice(0, opts.perColor + 2))].filter(Boolean)),
    ];
  }

  /** Arquivo que o navegador não consegue abrir (download pela metade, formato estranho). */
  const broken = (f) => dims.has(f) && !dims.get(f);
  const usable = (list) => list.filter((f) => !broken(f));

  /** O que vai mudar (respeita "só o que está sem foto"). */
  function work() {
    const jobs = [];
    for (const c of plan.categories) {
      if (c.category && c.cover && !broken(c.cover) && (opts.replace || !c.category.image)) jobs.push({ kind: 'cat', c });
    }
    for (const m of plan.models) {
      if (!m.product && !(opts.create && m.create !== false)) continue;
      const p = m.product;
      if (m.cover && !broken(m.cover) && (opts.replace || !p?.imageUrl)) jobs.push({ kind: 'cover', m });
      for (const col of m.colors) {
        if (!opts.replace && p?.colorPhotos?.[col.color]?.length) continue;
        const files = usable(col.files).slice(0, opts.perColor);
        if (files.length) jobs.push({ kind: 'color', m, col, files });
      }
    }
    return jobs;
  }

  function renderPlan() {
    const jobs = work();
    const nFiles = jobs.reduce((a, j) => a + (j.kind === 'color' ? j.files.length : 1), 0);
    const small = allFiles().filter((f) => (dims.get(f) || 0) > 0 && dims.get(f) < MIN_PX);
    const bad = allFiles().filter(broken);
    const missing = plan.models.filter((m) => !m.product);
    const has = (m, col) => !!m.product?.colorPhotos?.[col.color]?.length;
    $b.innerHTML = `
      <div class="pi-summary">
        <span class="badge no-dot" data-tone="blue">${plan.models.length} modelos</span>
        <span class="badge no-dot" data-tone="green">${nFiles} fotos para enviar</span>
        ${missing.length ? `<span class="badge no-dot" data-tone="amber">${missing.length} modelos fora do cadastro</span>` : ''}
        ${small.length ? `<span class="badge no-dot" data-tone="red">${small.length} pequenas demais (&lt; ${MIN_PX}px)</span>` : ''}
        ${bad.length ? `<span class="badge no-dot" data-tone="red">${bad.length} com defeito</span>` : ''}
        ${plan.skipped.length ? `<span class="badge no-dot" data-tone="gray">${plan.skipped.length} ignoradas</span>` : ''}
      </div>
      <div class="pi-opts">
        <label class="check"><input type="checkbox" data-opt="replace" ${opts.replace ? 'checked' : ''}><span class="box"></span>
          <span>Trocar também as fotos que já existem <span class="xs dim block">desmarcado: só preenche o que está sem foto (seguro para rodar de novo)</span></span></label>
        <label class="check"><input type="checkbox" data-opt="create" ${opts.create ? 'checked' : ''}><span class="box"></span>
          <span>Criar os modelos que não estão no cadastro</span></label>
        <label class="pi-per"><span class="small">Fotos por cor</span>
          <select class="select" data-opt="perColor">${[1, 2, 3, 4, 6, 8].map((n) => `<option ${n === opts.perColor ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
      ${plan.categories.map((cat) => `
        <div class="card pi-cat">
          <div class="card-head"><h3>${esc(cat.category?.emoji || '')} ${esc(cat.category?.name || cat.folder)}</h3>
            <span class="xs ${cat.cover ? '' : 'dim'}">${cat.cover ? (cat.category?.image && !opts.replace ? 'categoria já tem foto' : `${icon('image')} foto da categoria`) : 'sem foto de categoria'}</span></div>
          <div class="pi-models">
            ${plan.models.filter((m) => m.catFolder === cat.folder && (m.colors.length || m.cover)).map((m, i) => `
              <div class="pi-model${m.product ? '' : ' is-new'}">
                <div class="pi-model-head">
                  <b>${esc(m.product?.name || m.folder)}</b>
                  ${m.product ? (m.product.name !== m.folder ? `<span class="xs dim">pasta "${esc(m.folder)}"</span>` : '')
                    : `<label class="check xs"><input type="checkbox" data-create="${esc(m.catFolder)}|${esc(m.folder)}" ${m.create !== false && opts.create ? 'checked' : ''}><span class="box"></span><span>criar modelo novo</span></label>`}
                  ${m.cover ? `<span class="tag">${icon('image')} capa</span>` : ''}
                </div>
                <div class="pi-colors">${m.colors.map((col) => `
                  <span class="pi-color${has(m, col) && !opts.replace ? ' is-skip' : ''}${col.files.slice(0, opts.perColor).some((f) => dims.get(f) && dims.get(f) < MIN_PX) ? ' is-small' : ''}" title="${esc(col.folder)}">
                    ${esc(col.color)}${col.isNew ? ' <em>nova</em>' : ''} · ${Math.min(col.files.length, opts.perColor)}${has(m, col) && !opts.replace ? ' (já tem)' : ''}</span>`).join('')}</div>
              </div>`).join('') || '<p class="xs dim" style="margin:0">Nenhum modelo com fotos nesta categoria ainda.</p>'}
          </div>
        </div>`).join('')}
      ${small.length ? `<details class="pi-details"><summary class="small">${small.length} fotos pequenas (vão ficar borradas - troque por maiores)</summary>
        <ul>${small.map((f) => `<li class="xs"><span class="mono">${esc(f.path)}</span> - ${dims.get(f)}px</li>`).join('')}</ul></details>` : ''}
      ${bad.length ? `<details class="pi-details" open><summary class="small tone-red">${bad.length} ${bad.length === 1 ? 'arquivo com defeito' : 'arquivos com defeito'} - não abre (download pela metade?). Baixe de novo; os outros sobem normalmente.</summary>
        <ul>${bad.map((f) => `<li class="xs mono">${esc(f.path)}</li>`).join('')}</ul></details>` : ''}
      ${plan.skipped.length ? `<details class="pi-details"><summary class="small">${plan.skipped.length} arquivos ignorados</summary>
        <ul>${plan.skipped.map((s) => `<li class="xs"><span class="mono">${esc(s.path)}</span> - ${esc(s.reason)}</li>`).join('')}</ul></details>` : ''}
      <p class="xs dim"><label class="link-btn" style="cursor:pointer">${icon('refresh')} Escolher outra pasta<input type="file" data-dir webkitdirectory directory multiple hidden></label></p>`;
    $go.hidden = false;
    $go.disabled = !nFiles;
    $go.innerHTML = `${icon('upload')} Enviar ${nFiles} ${nFiles === 1 ? 'foto' : 'fotos'}`;
    $foot.textContent = nFiles ? `≈ ${Math.max(1, Math.round(nFiles * 0.12))} MB no Storage` : 'Nada novo para enviar.';
  }

  async function run() {
    const jobs = work();
    const total = jobs.reduce((a, j) => a + (j.kind === 'color' ? j.files.length : 1), 0);
    if (!total) return;
    running = true;
    $go.disabled = true;
    let done = 0;
    const errors = [];
    const prog = () => {
      $b.innerHTML = `<div class="pi-progress"><div class="pi-bar"><span style="width:${Math.round((done / total) * 100)}%"></span></div>
        <p class="small">Enviando ${Math.min(done + 1, total)} de ${total}…</p>${errors.length ? `<p class="xs tone-red">${errors.length} com erro</p>` : ''}</div>`;
    };
    const up = async (f) => {
      prog();
      try { return await Data.uploadProductImage(f.file, { square: true }); } catch (err) { errors.push(`${f.path}: ${friendlyError(err)}`); return ''; } finally { done += 1; }
    };
    try {
      // categorias
      for (const j of jobs.filter((x) => x.kind === 'cat')) {
        const url = await up(j.c.cover);
        if (url) await Data.saveCategory({ ...j.c.category, image: url }).catch((err) => errors.push(`${j.c.folder}: ${friendlyError(err)}`));
      }
      // modelos (cria o que falta, depois capa + fotos por cor numa gravação só)
      const byModel = new Map();
      for (const j of jobs.filter((x) => x.kind !== 'cat')) {
        if (!byModel.has(j.m)) byModel.set(j.m, []);
        byModel.get(j.m).push(j);
      }
      for (const [m, list] of byModel) {
        try {
          let p = m.product ? Data.product(m.product.id) : null;
          if (!p) {
            p = await Data.saveProduct({ name: m.folder, categoryId: m.category?.id || null, colors: m.colors.map((c) => c.color),
              storages: [], tracksSerial: !!m.category?.tracksSerial, showInCatalog: true, active: true, needsReview: true });
          }
          const colorPhotos = { ...(p.colorPhotos || {}) };
          const colors = [...(p.colors || [])];
          let imageUrl;
          for (const j of list) {
            if (j.kind === 'cover') { const u = await up(m.cover); if (u) imageUrl = u; continue; }
            const urls = [];
            for (const f of j.files) { const u = await up(f); if (u) urls.push(u); }
            if (urls.length) colorPhotos[j.col.color] = urls;
            if (!colors.includes(j.col.color)) colors.push(j.col.color);
          }
          await Data.patchProductMedia(p.id, { imageUrl, colorPhotos, colors }, { reloadAfter: false });
        } catch (err) {
          errors.push(`${m.folder}: ${friendlyError(err)}`);
        }
      }
      await Data.reload('products', 'categories');
    } finally {
      running = false;
    }
    $b.innerHTML = `
      <div class="pi-done">
        <span class="pi-done-ic">${icon(errors.length ? 'alert' : 'checkCircle')}</span>
        <p class="strong">${done - errors.length} ${done - errors.length === 1 ? 'foto enviada' : 'fotos enviadas'}</p>
        <p class="small dim">Já aparecem nos produtos e no catálogo. Baixou mais fotos? É só importar a pasta de novo - o que já tem foto fica como está.</p>
        ${errors.length ? `<details class="pi-details" open><summary class="small tone-red">${errors.length} com problema</summary><ul>${errors.map((e) => `<li class="xs">${esc(e)}</li>`).join('')}</ul></details>` : ''}
      </div>`;
    $go.hidden = true;
    $foot.textContent = '';
    toast('Fotos importadas', { text: `${done - errors.length} enviadas${errors.length ? ` · ${errors.length} com problema` : ''}` });
    onDone?.();
  }

  modal.body.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-dir]')) { if (t.files?.length) analyse(t.files).catch((err) => toastError('Não consegui ler a pasta', friendlyError(err))); return; }
    const o = t.dataset.opt;
    if (o === 'replace' || o === 'create') { opts[o] = t.checked; renderPlan(); return; }
    if (o === 'perColor') { opts.perColor = Number(t.value) || 4; renderPlan(); return; }
    if (t.dataset.create) {
      const m = plan.models.find((x) => `${x.catFolder}|${x.folder}` === t.dataset.create);
      if (m) { m.create = t.checked; renderPlan(); }
    }
  });
  $go.addEventListener('click', () => run().catch((err) => { running = false; toastError('O envio parou', friendlyError(err)); }));

  renderPick();
  return modal;
}
