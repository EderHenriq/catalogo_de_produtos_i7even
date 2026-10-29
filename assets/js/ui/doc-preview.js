/**
 * Saídas do documento do pedido: PDF e mensagem de WhatsApp.
 *
 * PDF em dois passos de propósito: gerar leva um instante (e na primeira vez
 * baixa a biblioteca), e o iPhone só deixa abrir a folha de compartilhar se
 * o toque for imediato. Então: gera → mostra "PDF pronto" → o toque em
 * "Enviar" chama o compartilhamento na hora.
 */

import { orderPdfBlob, canShareFile, sharePdf, downloadBlob, openBlob } from '../docs/pdf.js';
import { fileName } from '../docs/order-doc.js';
import { orderMessage, whatsappUrl, previewHTML, WA_URL_LIMIT } from '../docs/whatsapp.js';
import { openModal, toast, toastError } from './kit.js';
import { icon } from './icons.js';
import { esc } from '../core/utils.js';

/* ------------------------------------------------------------------ PDF */

export function openPdfDialog(doc) {
  const modal = openModal({
    title: `${doc.kindLabel} ${doc.code} em PDF`,
    subtitle: doc.customer.name || '',
    sheet: true,
    body: `
      <div class="pdf-ready" data-state="loading">
        <div class="col gap-3" style="align-items:center;padding:18px 0">
          <div class="spinner"></div>
          <p class="small dim">Gerando o PDF…</p>
        </div>
      </div>`,
    footer: '<button class="btn btn-ghost" data-close>Fechar</button>',
  });
  const box = modal.body.querySelector('.pdf-ready');

  orderPdfBlob(doc).then((blob) => {
    if (!modal.el.isConnected) return;
    const name = fileName(doc);
    const file = new File([blob], name, { type: 'application/pdf' });
    const share = canShareFile(file);
    box.dataset.state = 'ready';
    box.innerHTML = `
      <div class="pdf-file">
        <span class="pdf-icon" aria-hidden="true">PDF</span>
        <div class="grow col" style="min-width:0">
          <span class="strong truncate">${esc(name)}</span>
          <span class="xs dim">${esc(Math.max(1, Math.round(blob.size / 1024)))} KB · pronto para enviar</span>
        </div>
      </div>
      <div class="pdf-actions">
        ${share ? `<button class="btn btn-primary btn-block" data-share>${icon('whatsapp')} Enviar pelo WhatsApp</button>` : ''}
        <button class="btn ${share ? '' : 'btn-primary'} btn-block" data-open>${icon('eye')} Abrir</button>
        <button class="btn btn-block" data-download>${icon('download')} Baixar</button>
      </div>
      ${share ? '<p class="xs dim center">No celular, "Enviar" abre a lista de apps: escolha o WhatsApp e a conversa.</p>'
        : '<p class="xs dim center">No computador: baixe o PDF e arraste para a conversa no WhatsApp Web.</p>'}`;

    box.addEventListener('click', async (e) => {
      if (e.target.closest('[data-share]')) {
        try {
          const r = await sharePdf(file, { title: `${doc.kindLabel} ${doc.code}` });
          if (r === 'shared') { toast('PDF enviado'); modal.close(); }
        } catch (err) {
          console.error(err);
          toastError('Não foi possível compartilhar', 'Use "Baixar" e envie o arquivo pelo WhatsApp.');
        }
      } else if (e.target.closest('[data-open]')) {
        if (!openBlob(blob)) toastError('O navegador bloqueou a nova aba', 'Use "Baixar".');
      } else if (e.target.closest('[data-download]')) {
        downloadBlob(blob, name);
        toast('PDF baixado', { text: name });
      }
    });
  }).catch((err) => {
    console.error(err);
    if (!modal.el.isConnected) return;
    box.dataset.state = 'error';
    box.innerHTML = `<div class="alert" data-kind="error">${icon('alert')}
      <div>Não consegui gerar o PDF. Confira a internet (o gerador é baixado na primeira vez) e tente de novo.</div></div>`;
  });

  return modal;
}

/* ------------------------------------------------------------- WhatsApp */

/** @param {object} doc  documento; ou `{ text, phone, name }` para uma mensagem pronta. */
export function openWhatsappDialog(doc) {
  const text = doc.text || orderMessage(doc);
  const to = doc.text ? { phone: doc.phone || '', name: doc.name || '' } : doc.customer;
  const url = whatsappUrl(to.phone, text);
  const long = url.length > WA_URL_LIMIT;

  const modal = openModal({
    title: 'Mensagem para o WhatsApp',
    subtitle: to.phone ? `Para ${to.name || to.phone}` : 'Você escolhe a conversa ao abrir',
    size: 'lg',
    body: `
      <div class="wa-chat"><div class="wa-bubble">${previewHTML(text, esc)}</div></div>
      ${long ? `<div class="alert" data-kind="warn">${icon('info')}<div>Mensagem longa: alguns celulares cortam o link.
        Se chegar incompleta, use <b>Copiar texto</b> e cole na conversa.</div></div>` : ''}`,
    footer: `
      <button class="btn" data-copy>${icon('copy')} Copiar texto</button>
      <a class="btn btn-primary" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-open-wa>${icon('whatsapp')} Abrir no WhatsApp</a>`,
  });

  // doc.onSend: quem chamou quer saber que a mensagem foi (ex.: "cobrei hoje").
  let sent = false;
  const markSent = () => { if (!sent) { sent = true; doc.onSend?.(); } };
  modal.foot.querySelector('[data-open-wa]').addEventListener('click', markSent);
  modal.foot.querySelector('[data-copy]').addEventListener('click', async () => {
    if (await copyText(text)) { markSent(); toast('Texto copiado', { text: 'Agora é só colar na conversa.' }); }
    else toastError('Não foi possível copiar', 'Selecione o texto e copie manualmente.');
  });
  return modal;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    // Com um modal aberto, o resto da página fica inerte: o campo mora no modal da frente.
    const open = document.querySelectorAll('dialog.modal[open]');
    (open[open.length - 1] || document.body).appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}
