/**
 * Cobrança gentil no WhatsApp: a mensagem já sai com o valor, o vencimento,
 * o produto e a chave Pix da loja. Ao abrir/copiar, a parcela fica marcada
 * "cobrei hoje" (aparece na ficha e em A receber - ninguém cobra duas vezes).
 */

import * as Data from '../core/data.js';
import { formatDate, money, todayISO } from '../core/utils.js';
import { toastError } from './kit.js';
import { friendlyError } from '../core/errors.js';
import { openWhatsappDialog } from './doc-preview.js';
import { instName } from './plan-editor.js';

const when = (x) => {
  if (x.status === 'hoje') return 'vence *hoje*';
  if (x.status === 'atrasada') return `venceu em *${formatDate(x.dueDate)}*`;
  if (x.inDays === 1) return 'vence *amanhã*';
  return `vence em *${formatDate(x.dueDate)}*`;
};

/** Texto da cobrança de uma ou mais parcelas do mesmo pedido. */
export function reminderText(order, insts) {
  const s = Data.settings();
  const first = String(order.customerName || '').trim().split(/\s+/)[0] || '';
  const what = order.items.length === 1 ? order.items[0].productName : `pedido #${String(order.code).padStart(4, '0')}`;
  const late = insts.some((x) => x.status === 'atrasada');
  const lines = insts.map((x) => `▪️ ${instName(x, order.plan)}: *${money(x.open)}* - ${when(x)}`);
  const sum = insts.reduce((a, x) => a + x.open, 0);
  return [
    `Olá${first ? `, ${first}` : ''}! Tudo bem? 😊`,
    '',
    late
      ? `Passando para lembrar do pagamento do seu ${what} na ${s.storeName}, que ficou em aberto:`
      : `Passando para lembrar do pagamento do seu ${what} na ${s.storeName}:`,
    '',
    ...lines,
    insts.length > 1 ? `\n*Total: ${money(sum)}*` : '',
    '',
    s.pixKey ? `Pix: *${s.pixKey}*` : '',
    s.pixKey ? 'Assim que pagar, me manda o comprovante por aqui 🙏' : 'Me avisa por aqui quando pagar 🙏',
    late ? 'Se já pagou, desconsidere e me manda o comprovante, por favor.' : '',
    '',
    `Obrigado! - ${s.storeName}`,
  ].filter((x, i, a) => x !== '' || (a[i - 1] !== '' && i > 0)).join('\n').trim();
}

/** Abre a cobrança e marca as parcelas como cobradas quando a pessoa envia. */
export function remind(order, insts) {
  return openWhatsappDialog({
    text: reminderText(order, insts),
    phone: order.customerPhone,
    name: order.customerName,
    onSend: () => {
      Data.markReminded(insts.map((x) => x.id)).catch((err) => toastError('Não marquei como cobrado', friendlyError(err)));
    },
  });
}

/** "cobrado hoje", "cobrado há 3 dias". */
export function remindedText(iso) {
  if (!iso) return '';
  const d = Math.round((Date.parse(todayISO()) - Date.parse(todayISO(new Date(iso)))) / 86400000);
  return d <= 0 ? 'cobrado hoje' : d === 1 ? 'cobrado ontem' : `cobrado há ${d} dias`;
}
