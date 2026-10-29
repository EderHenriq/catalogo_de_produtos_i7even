/**
 * Mensagem do pedido para o WhatsApp do cliente (o WhatsApp entende
 * *negrito* e _itálico_). Feita a partir do mesmo documento do PDF
 * (docs/order-doc.js) - o que sai no PDF e na mensagem é sempre igual.
 */

import { money, formatDate, waNumber } from '../core/utils.js';

/** Acima disso alguns celulares cortam o link wa.me - a tela oferece "Copiar texto". */
export const WA_URL_LIMIT = 1900;

export function orderMessage(doc) {
  const s = doc.store;
  const first = (doc.customer.name || '').trim().split(/\s+/)[0];
  const lines = [];
  lines.push(`Olá${first ? `, ${first}` : ''}! Segue o ${doc.kind === 'orcamento' ? 'orçamento' : 'resumo do seu pedido'} *${doc.code}* da *${s.name}*:`);
  lines.push('');
  for (const it of doc.items) {
    lines.push(`▪️ ${it.qty > 1 ? `${it.qty}x ` : ''}*${it.description}* - ${it.unitPrice ? money(it.unitPrice * it.qty) : 'cortesia'}`);
    for (const d of it.details) lines.push(`   ${d}`);
  }
  lines.push('');
  const t = doc.totals;
  if (t.discount) lines.push(`Desconto: - ${money(t.discount)}`);
  if (t.shipping) lines.push(`Frete: ${money(t.shipping)}`);
  lines.push(`*Total: ${money(t.total)}*`);
  if (doc.kind === 'pedido' && doc.paid > 0) {
    lines.push(`Recebido: ${money(doc.paid)}`);
    lines.push(doc.balance > 0 ? `*Falta: ${money(doc.balance)}*` : 'Pagamento quitado ✅');
  }
  if (doc.plan?.length) {
    lines.push('');
    lines.push('*Parcelas a pagar:*');
    for (const p of doc.plan) lines.push(`▪️ ${formatDate(p.dueDate)} - ${money(p.open)}${p.status === 'atrasada' ? ' (em atraso)' : p.status === 'hoje' ? ' (vence hoje)' : ''}`);
  }
  if (doc.paymentMethod) lines.push(`Pagamento: ${doc.paymentMethod}${doc.installments > 1 ? ` em ${doc.installments}x` : ''}`);
  if (doc.balance > 0 && s.pixKey) lines.push(`Chave Pix: ${s.pixKey}`);
  if (doc.validUntil) lines.push(`_Orçamento válido até ${formatDate(doc.validUntil)}_`);
  if (doc.trackingCode) lines.push(`Rastreio: ${doc.trackingCode}`);
  lines.push('');
  lines.push(doc.kind === 'orcamento' ? 'Posso separar para você? 😉' : 'Qualquer dúvida é só chamar por aqui. 🙌');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Link do WhatsApp (sem telefone: o WhatsApp pergunta a conversa). */
export function whatsappUrl(phone, text) {
  const n = waNumber(phone);
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

/** Prévia em HTML do jeito que o WhatsApp mostra (*negrito*, _itálico_). */
export function previewHTML(text, esc) {
  return esc(text)
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/(^|\s)_([^_\n]+)_/g, '$1<i>$2</i>')
    .replace(/\n/g, '<br>');
}
