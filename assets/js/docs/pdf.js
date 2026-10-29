/**
 * Pedido/orçamento em PDF, gerado no próprio aparelho (sem servidor).
 *
 * A biblioteca (jsPDF, ~350 KB) só é baixada na primeira vez que alguém gera
 * um PDF - a abertura do sistema não paga esse peso. O desenho em si
 * (drawOrderPdf) recebe a biblioteca por parâmetro: assim o mesmo código roda
 * no navegador e no teste em Node.
 *
 * Visual da i7even: monocromático (o preto e o grafite da marca), números em
 * destaque, cabeçalho escuro com a logo. Fonte: Helvetica embutida do PDF
 * (cobre acentos do português) - por isso nada de "→", "•" ou emoji aqui.
 */

import { money, formatDate, maskPhone } from '../core/utils.js';

// Versão fixa (mesma regra do supabase-js).
const JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@4.2.1/+esm';
// Logo em JPEG (o "7" da marca sobre o grafite): leve, vai bem pelo WhatsApp.
const LOGO_URL = 'assets/brand/i7even-logo-pdf.jpg';

const C = {
  ink: [14, 15, 17],          // #0e0f11 - superfície escura da marca
  graphite: [23, 24, 26],     // #17181a
  text: [24, 25, 28],
  muted: [110, 112, 118],
  line: [226, 226, 222],
  zebra: [247, 247, 245],
  panel: [244, 244, 242],     // #f4f4f2 - superfície clara da marca
  white: [255, 255, 255],
  red: [190, 30, 45],
  green: [22, 128, 72],
};

const PAGE_W = 210;
const PAGE_H = 297;
const M = 16;
const CW = PAGE_W - 2 * M;
const FOOT = 18;

/** Texto seguro para a fonte do PDF. */
const pt = (s) => String(s ?? '').replace(/[  ]/g, ' ').replace(/[→−•–—]/g, '-')
  .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').trim();
const brl = (n) => pt(money(n));

/**
 * Desenha o documento. Devolve a instância do jsPDF.
 * @param {Function} JsPDF  construtor jsPDF
 * @param {ReturnType<import('./order-doc.js').buildDocument>} doc
 * @param {{logo?: string}} [opts]  logo JPEG em data URL
 */
export function drawOrderPdf(JsPDF, doc, { logo } = {}) {
  const pdf = new JsPDF({ unit: 'mm', format: 'a4', compress: true });
  const fill = (rgb) => pdf.setFillColor(...rgb);
  const color = (rgb) => pdf.setTextColor(...rgb);
  const font = (style, size) => { pdf.setFont('helvetica', style); pdf.setFontSize(size); };
  const store = doc.store;

  pdf.setProperties({
    title: `${doc.kindLabel} ${doc.code} - ${store.name}`,
    subject: `${doc.kindLabel} para ${doc.customer.name || 'cliente'}`,
    author: store.name,
    creator: `${store.name} - sistema de pedidos`,
  });

  /* ------------------------------------------------- cabeçalho escuro -- */

  const HEAD_H = 38;
  fill(C.ink); pdf.rect(0, 0, PAGE_W, HEAD_H, 'F');
  let infoX = M;
  if (logo) {
    pdf.addImage(logo, 'JPEG', M, 8, 22, 22, 'logo', 'FAST');
    infoX = M + 27;
  }
  font('bold', 15); color(C.white);
  pdf.text(pt(store.name), infoX, 15);
  font('normal', 8); color([190, 191, 196]);
  const contact = [
    [store.phone && `WhatsApp ${maskPhone(store.phone)}`, store.instagram].filter(Boolean).join('   |   '),
    [store.email, store.address].filter(Boolean).join('   |   '),
  ].filter(Boolean);
  let cy = 21;
  for (const l of contact) {
    for (const s of pdf.splitTextToSize(pt(l), 100)) { pdf.text(s, infoX, cy); cy += 4; }
  }

  font('bold', 9); color([160, 162, 168]);
  pdf.text(pt(doc.kindLabel).toUpperCase(), PAGE_W - M, 13, { align: 'right' });
  font('bold', 22); color(C.white);
  pdf.text(doc.number == null ? '-' : String(doc.number).padStart(4, '0'), PAGE_W - M, 23, { align: 'right' });
  font('normal', 8.5); color([190, 191, 196]);
  pdf.text(`Emitido em ${formatDate(doc.date)}`, PAGE_W - M, 29, { align: 'right' });
  if (doc.validUntil) pdf.text(`Válido até ${formatDate(doc.validUntil)}`, PAGE_W - M, 33.5, { align: 'right' });

  let y = HEAD_H + 9;

  /* --------------------------------------------------------- cliente -- */

  const custLines = [
    doc.customer.phone && `WhatsApp ${maskPhone(doc.customer.phone)}`,
    doc.customer.doc && `CPF/Doc. ${doc.customer.doc}`,
  ].filter(Boolean).join('   |   ');
  font('normal', 8.5);
  const addrLines = doc.customer.address ? pdf.splitTextToSize(pt(doc.customer.address), CW - 8) : [];
  const custH = 15 + (custLines ? 4.5 : 0) + addrLines.length * 4;
  fill(C.panel); pdf.roundedRect(M, y, CW, custH, 2.5, 2.5, 'F');
  font('bold', 7); color(C.muted); pdf.text('CLIENTE', M + 4, y + 5.5);
  font('bold', 12); color(C.text);
  pdf.text(pdf.splitTextToSize(pt(doc.customer.name || 'Consumidor'), CW - 8)[0], M + 4, y + 11.5);
  let iy = y + 16.5;
  font('normal', 8.5); color(C.muted);
  if (custLines) { pdf.text(pt(custLines), M + 4, iy); iy += 4.5; }
  for (const l of addrLines) { pdf.text(l, M + 4, iy); iy += 4; }
  y += custH + 7;

  /* ------------------------------------------------------------ itens -- */

  const X_QTY = M + CW - 64;
  const X_UNIT = M + CW - 30;
  const X_TOTAL = M + CW - 3;
  const DESC_W = CW - 80;

  const tableHead = () => {
    font('bold', 7.5); color(C.muted);
    pdf.text('PRODUTO', M + 2, y + 4);
    pdf.text('QTD', X_QTY, y + 4, { align: 'center' });
    pdf.text('UNITÁRIO', X_UNIT, y + 4, { align: 'right' });
    pdf.text('TOTAL', X_TOTAL, y + 4, { align: 'right' });
    y += 6.5;
    pdf.setDrawColor(...C.ink); pdf.setLineWidth(0.5); pdf.line(M, y, PAGE_W - M, y);
    y += 1;
  };
  const newPage = () => { pdf.addPage(); y = M; };

  tableHead();
  doc.items.forEach((it, i) => {
    font('bold', 10);
    const descLines = pdf.splitTextToSize(pt(it.description), DESC_W);
    font('normal', 8.2);
    const extraLines = it.details.flatMap((d) => pdf.splitTextToSize(pt(d), DESC_W));
    const rowH = Math.max(6 + (descLines.length - 1) * 4.5 + extraLines.length * 3.8 + 3, 11);

    if (y + rowH > PAGE_H - FOOT - 4) { newPage(); tableHead(); }
    if (i % 2 === 1) { fill(C.zebra); pdf.rect(M, y, CW, rowH, 'F'); }

    let ty = y + 6;
    font('bold', 10); color(C.text);
    descLines.forEach((l) => { pdf.text(l, M + 2, ty); ty += 4.5; });
    font('normal', 8.2); color(C.muted);
    extraLines.forEach((l) => { pdf.text(l, M + 2, ty - 0.4); ty += 3.8; });

    font('normal', 10); color(C.text);
    pdf.text(String(it.qty), X_QTY, y + 6, { align: 'center' });
    pdf.text(it.unitPrice ? brl(it.unitPrice) : 'Cortesia', X_UNIT, y + 6, { align: 'right' });
    font('bold', 10);
    pdf.text(brl(it.unitPrice * it.qty), X_TOTAL, y + 6, { align: 'right' });

    y += rowH;
    pdf.setDrawColor(...C.line); pdf.setLineWidth(0.2); pdf.line(M, y, PAGE_W - M, y);
  });
  y += 7;

  /* ------------------------------------------- pagamento + totais -- */

  const t = doc.totals;
  const totRows = (t.discount || t.shipping) ? [
    ['Subtotal', brl(t.subtotal)],
    t.discount ? ['Desconto', `- ${brl(t.discount)}`] : null,
    t.shipping ? ['Frete', brl(t.shipping)] : null,
  ].filter(Boolean) : [];
  const after = [];
  if (doc.kind === 'pedido' && doc.paid > 0) {
    after.push(['Recebido', brl(doc.paid)]);
    if (doc.balance > 0) after.push(['Falta pagar', brl(doc.balance)]);
  }
  const blockH = Math.max(totRows.length * 5.6 + 15 + after.length * 5.6, 32);
  if (y + blockH > PAGE_H - FOOT - 4) newPage();

  const TX = PAGE_W - M - 82;
  let ry = y + 4;
  font('normal', 9.5);
  for (const [label, value] of totRows) {
    color(C.muted); pdf.text(label, TX + 3, ry);
    color(C.text); pdf.text(value, PAGE_W - M - 3, ry, { align: 'right' });
    ry += 5.6;
  }
  fill(C.ink); pdf.roundedRect(TX, ry - 2, 82, 12.5, 2.2, 2.2, 'F');
  font('bold', 8.5); color([180, 182, 188]); pdf.text('TOTAL', TX + 4, ry + 5.6);
  font('bold', 14); color(C.white); pdf.text(brl(t.total), PAGE_W - M - 4, ry + 6.2, { align: 'right' });
  ry += 16.5;
  for (const [label, value] of after) {
    const owe = label === 'Falta pagar';
    font(owe ? 'bold' : 'normal', 9.5);
    color(owe ? C.red : C.muted); pdf.text(label, TX + 3, ry);
    color(owe ? C.red : C.text); pdf.text(value, PAGE_W - M - 3, ry, { align: 'right' });
    ry += 5.6;
  }
  if (doc.kind === 'pedido' && doc.balance <= 0 && doc.paid > 0) {
    font('bold', 9); color(C.green); pdf.text('Pagamento quitado. Obrigado!', PAGE_W - M - 3, ry, { align: 'right' });
    ry += 5.6;
  }

  let ly = y + 4;
  const LW = TX - M - 8;
  const payLines = [
    doc.paymentMethod && `Forma combinada: ${doc.paymentMethod}${doc.installments > 1 ? ` em ${doc.installments}x` : ''}`,
    ...doc.payments.map((p) => `${formatDate(p.date)}  ${p.method || 'Pagamento'}  ${brl(p.amount)}${p.note ? ` (${p.note})` : ''}`),
    doc.plan?.length && `Parcelas a pagar: ${doc.plan.map((p) => `${formatDate(p.dueDate)} ${brl(p.open)}`).join(' · ')}`,
    doc.shippingMethod && `Entrega: ${doc.shippingMethod}`,
    doc.trackingCode && `Rastreio: ${doc.trackingCode}`,
  ].filter(Boolean);
  if (payLines.length || (store.pixKey && doc.balance > 0)) {
    font('bold', 7.5); color(C.muted); pdf.text('PAGAMENTO E ENTREGA', M, ly); ly += 5;
    font('normal', 9); color(C.text);
    for (const l of payLines) {
      for (const s of pdf.splitTextToSize(pt(l), LW)) { pdf.text(s, M, ly); ly += 4.5; }
    }
    if (store.pixKey && doc.balance > 0) {
      ly += 1.5;
      pdf.setDrawColor(...C.ink); pdf.setLineWidth(0.35);
      pdf.roundedRect(M, ly - 4, LW, 11, 1.8, 1.8, 'S');
      font('bold', 7.5); color(C.muted); pdf.text('CHAVE PIX', M + 3, ly);
      font('bold', 10.5); color(C.text);
      pdf.text(pdf.splitTextToSize(pt(store.pixKey), LW - 6)[0], M + 3, ly + 5);
      ly += 11;
    }
  }
  y = Math.max(ry, ly) + 5;

  /* ---------------------------------------------- textos da loja -- */

  if (doc.notes) {
    font('normal', 8.8);
    const lines = pdf.splitTextToSize(pt(doc.notes), CW);
    if (y + 6 + Math.min(lines.length, 3) * 4 > PAGE_H - FOOT - 4) newPage();
    font('bold', 7.5); color(C.muted); pdf.text('OBSERVAÇÕES', M, y); y += 4.6;
    font('normal', 8.8); color(C.text);
    for (const l of lines) {
      if (y > PAGE_H - FOOT - 4) newPage();
      pdf.text(l, M, y); y += 4;
    }
    y += 3;
  }

  if (store.footerText) {
    if (y + 8 > PAGE_H - FOOT - 4) newPage();
    y += 3;
    font('italic', 9.5); color(C.text);
    for (const l of pdf.splitTextToSize(pt(store.footerText), CW)) {
      pdf.text(l, PAGE_W / 2, y, { align: 'center' }); y += 4.5;
    }
  }

  /* -------------------------------------- rodapé e marca d'água -- */

  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    if (doc.sample) {
      pdf.saveGraphicsState();
      pdf.setGState(new pdf.GState({ opacity: 0.06 }));
      font('bold', 96); color(C.ink);
      pdf.text('EXEMPLO', PAGE_W / 2, PAGE_H / 2 + 20, { align: 'center', angle: 32 });
      pdf.restoreGraphicsState();
    }
    pdf.setDrawColor(...C.line); pdf.setLineWidth(0.3);
    pdf.line(M, PAGE_H - 13, PAGE_W - M, PAGE_H - 13);
    font('normal', 7.5); color(C.muted);
    pdf.text(pt([store.name, store.instagram, 'Documento sem valor fiscal'].filter(Boolean).join('   |   ')), M, PAGE_H - 8.5);
    pdf.text(`Página ${p} de ${pages}`, PAGE_W - M, PAGE_H - 8.5, { align: 'right' });
  }

  return pdf;
}

/* ===================================================================== */
/*  Navegador                                                            */
/* ===================================================================== */

let libPromise = null;
let logoPromise = null;

/** Baixa a biblioteca uma vez só; chamadas seguintes reaproveitam. */
export function loadJsPDF() {
  libPromise ||= import(JSPDF_URL).then((m) => m.jsPDF || m.default?.jsPDF || m.default)
    .catch((err) => { libPromise = null; throw err; });
  return libPromise;
}

/** Logo em data URL. Sem logo (offline, arquivo faltando) o PDF sai com o nome em texto. */
function loadLogo() {
  logoPromise ||= fetch(LOGO_URL)
    .then((r) => (r.ok ? r.blob() : null))
    .then((blob) => blob && new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    }))
    .catch(() => null);
  return logoPromise;
}

/** Adianta o download da biblioteca (ex.: ao abrir a ficha de um pedido). */
export function preloadPdf() {
  loadJsPDF().catch(() => {});
  loadLogo();
}

/** @returns {Promise<Blob>} */
export async function orderPdfBlob(doc) {
  const [JsPDF, logo] = await Promise.all([loadJsPDF(), loadLogo()]);
  return drawOrderPdf(JsPDF, doc, { logo }).output('blob');
}

/** O aparelho consegue mandar o arquivo direto para o WhatsApp (folha de compartilhar)? */
export function canShareFile(file) {
  try {
    return !!navigator.canShare && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/**
 * Compartilhar exige um toque "fresco" (o Safari recusa se houver espera no
 * meio). Por isso a tela gera o PDF primeiro e só depois oferece o botão.
 * @returns {Promise<'shared'|'cancelled'>}
 */
export async function sharePdf(file, { title, text } = {}) {
  try {
    await navigator.share({ files: [file], title, text });
    return 'shared';
  } catch (err) {
    if (err?.name === 'AbortError') return 'cancelled';
    throw err;
  }
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function openBlob(blob) {
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (win) win.opener = null;
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return !!win;
}
