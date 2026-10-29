/**
 * Nomes da v1 para os pedidos, apontando para o repositório novo
 * (core/data.js). As telas antigas falavam com `Store.*`; aqui cada nome
 * antigo chama a função nova - um lugar só falando com o banco.
 * Código novo: importe direto de './data.js'.
 */

import * as Data from './data.js';

export {
  subscribe, isLoaded, msSinceLoad, isRealtimeUp, newOrderDraft, newItemDraft, newPaymentDraft, refreshOrder,
} from './data.js';

export const all = () => Data.orders();
export const byId = (id) => Data.order(id);
export const save = (draft) => Data.saveOrder(draft);
export const setStatus = (id, status) => Data.setOrderStatus(id, status);
export const remove = (id) => Data.deleteOrder(id);
export const customers = () => Data.customerStats();
export const importOrders = (list) => Data.importOrders(list);
export const load = () => Data.reload();
export const reset = () => Data.reset();

/** Campos soltos: urgência (direto) ou status (pela função, que mexe no estoque). */
export async function patch(id, fields) {
  if ('status' in fields) await Data.setOrderStatus(id, fields.status);
  if ('priority' in fields) await Data.setPriority(id, fields.priority);
  return Data.order(id);
}

export async function removeMany(ids) {
  for (const id of ids) await Data.deleteOrder(id);
}
