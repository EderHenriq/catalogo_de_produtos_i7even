/**
 * Documento do pedido: o "retrato" de um pedido/orçamento pronto para virar
 * PDF ou mensagem de WhatsApp.
 *
 * Fica separado do formato do banco de propósito: o PDF e o WhatsApp não
 * precisam saber como as tabelas são - quem chama entrega um objeto neste
 * formato (fromOrder faz isso a partir de um pedido do sistema).
 */

import { orderTotals, paymentState, planState } from '../core/calc.js';
import { todayISO, addDays, formatDate } from '../core/utils.js';

export const KIND_LABEL = { orcamento: 'Orçamento', pedido: 'Pedido' };

/** "#0042" */
export const docCode = (n) => (n == null ? '(provisório)' : `#${String(n).padStart(4, '0')}`);

/** Configurações da loja (data.settings()) → dados usados no documento. */
export function storeFromSettings(s = {}) {
  return {
    name: s.storeName || 'i7even Store',
    phone: s.phone || '',
    instagram: s.instagram || '',
    email: s.email || '',
    address: s.address || '',
    pixKey: s.pixKey || '',
    footerText: s.footerText || '',
    validityDays: 3,
  };
}

/**
 * Monta o documento e calcula os totais pelas mesmas fórmulas de core/calc.js.
 * @param {object} input
 */
export function buildDocument(input) {
  const kind = input.kind === 'orcamento' ? 'orcamento' : 'pedido';
  const items = (input.items || []).map((it) => ({
    description: String(it.description || 'Item').trim(),
    details: (it.details || []).filter(Boolean).map(String),
    qty: Math.max(Math.trunc(Number(it.qty) || 1), 1),
    unitPrice: Number(it.unitPrice) || 0,
  }));
  const payments = input.payments || [];
  const totals = orderTotals({ items, payments, discount: input.discount, shippingCost: input.shipping });
  const paid = kind === 'pedido' ? totals.paid : 0;
  const store = input.store || storeFromSettings();
  return {
    kind,
    kindLabel: KIND_LABEL[kind],
    number: input.number ?? null,
    code: docCode(input.number),
    date: input.date || todayISO(),
    validUntil: kind === 'orcamento' ? (input.validUntil || todayISO(addDays(new Date(), store.validityDays))) : '',
    store,
    customer: { name: '', phone: '', doc: '', address: '', ...(input.customer || {}) },
    items,
    totals,
    paid,
    balance: kind === 'pedido' ? Math.max(totals.total - paid, 0) : totals.total,
    paymentKey: paymentState(totals.total, paid),
    paymentMethod: input.paymentMethod || '',
    installments: Number(input.installments) || 1,
    payments: kind === 'pedido' ? payments.filter((p) => Number(p.amount)) : [],
    // fiado: parcelas que ainda faltam (paga sai daqui), com a situação de hoje
    plan: kind === 'pedido' ? planState(input.plan || [], paid, todayISO()).filter((p) => p.status !== 'paga') : [],
    shippingMethod: input.shippingMethod || '',
    trackingCode: input.trackingCode || '',
    notes: input.notes || '',
    sample: !!input.sample,
  };
}

/** Garantia de um item: "Garantia 365 dias (até 12/10/2027)" quando o pedido já foi finalizado. */
function warrantyLine(it, order) {
  if (!it.warrantyDays) return '';
  if (order.deliveredAt) {
    const until = new Date(order.deliveredAt);
    until.setDate(until.getDate() + Number(it.warrantyDays));
    return `Garantia ${it.warrantyDays} dias (até ${formatDate(until)})`;
  }
  return `Garantia ${it.warrantyDays} dias`;
}

/** Pedido do sistema (data.order) → documento. */
export function fromOrder(order, settings) {
  const address = [
    [order.shipStreet, order.shipNumber].filter(Boolean).join(', '),
    order.shipComplement, order.shipDistrict,
    [order.shipCity, order.shipUf].filter(Boolean).join(' - '),
    order.shipCep,
  ].filter(Boolean).join(' · ');
  return buildDocument({
    kind: order.status === 'orcamento' ? 'orcamento' : 'pedido',
    number: order.code,
    date: order.orderDate,
    store: storeFromSettings(settings),
    customer: { name: order.customerName, phone: order.customerPhone, doc: order.customerDoc, address },
    items: order.items.map((it) => ({
      description: it.productName,
      details: [
        [it.size, it.variant, it.color, it.condition].filter(Boolean).join(' · '),
        it.band ? `Pulseira: ${it.band}` : '',
        it.origin ? `Origem: ${it.origin}` : '',
        it.serial ? `IMEI/série: ${it.serial}` : '',
        warrantyLine(it, order),
        it.note,
      ],
      qty: it.qty,
      unitPrice: it.unitPrice,
    })),
    discount: order.discount,
    shipping: order.shippingCost,
    payments: order.payments,
    plan: order.plan || [],
    paymentMethod: order.paymentMethod,
    installments: order.installments,
    shippingMethod: order.shippingMethod,
    trackingCode: order.trackingCode,
    notes: order.notes,
  });
}

/** Nome do arquivo: i7even-Pedido-0042-Maria-Souza.pdf (sem acento nem espaço). */
export function fileName(doc) {
  const slug = (s) => String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const prefix = doc.kind === 'orcamento' ? 'Orcamento' : 'Pedido';
  return ['i7even', prefix, doc.number == null ? 'provisorio' : String(doc.number).padStart(4, '0'), slug(doc.customer.name)]
    .filter(Boolean).join('-') + '.pdf';
}

/** Pedido de exemplo para a prévia em Ajustes, com os dados reais da loja. */
export function sampleDocument(store) {
  return buildDocument({
    kind: 'pedido',
    number: 42,
    store,
    customer: { name: 'Cliente Exemplo', phone: '44900000000' },
    items: [
      { description: 'iPhone 16 Pro', details: ['256GB · Titânio-deserto · Lacrado', 'IMEI/série: 350000000000001', 'Garantia 365 dias'], qty: 1, unitPrice: 7499 },
      { description: 'Apple Watch Series 10', details: ['42mm · GPS · Preto · Seminovo', 'Pulseira: Loop esportiva', 'Garantia 90 dias'], qty: 1, unitPrice: 2190 },
      { description: 'Película de privacidade', qty: 1, unitPrice: 0 },
    ],
    discount: 89,
    shipping: 0,
    payments: [{ amount: 2000, method: 'PIX', date: todayISO() }],
    paymentMethod: 'PIX',
    notes: 'Entrega combinada para sábado à tarde.',
    sample: true,
  });
}
