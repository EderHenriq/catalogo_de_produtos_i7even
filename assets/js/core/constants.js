/** Domínio do sistema: status, formas de pagamento, canais, envio. */

/**
 * Pipeline do pedido. A ordem aqui é a ordem do funil no dashboard.
 * `key` é o valor gravado no banco - não renomear sem migrar os dados.
 */
export const STATUSES = [
  // Orçamento não mexe no estoque; a partir de "Novo" o estoque já foi tirado.
  { key: 'orcamento',    label: 'Orçamento',       short: 'Orçam.',    tone: 'gray',   open: false },
  { key: 'novo',         label: 'Novo',            short: 'Novo',      tone: 'gray',   open: true },
  { key: 'aguardando',   label: 'Aguardando pgto.', short: 'Aguard.',  tone: 'amber',  open: true },
  { key: 'pago',         label: 'Pago',            short: 'Pago',      tone: 'teal',   open: true },
  { key: 'preparo',      label: 'Em preparo',      short: 'Preparo',   tone: 'indigo', open: true },
  { key: 'enviado',      label: 'Em entrega',      short: 'Entrega',   tone: 'blue',   open: true },
  { key: 'entregue',     label: 'Finalizado',      short: 'Finaliz.',  tone: 'green',  open: false },
  { key: 'cancelado',    label: 'Cancelado',       short: 'Cancel.',   tone: 'red',    open: false },
];

export const STATUS_MAP = Object.fromEntries(STATUSES.map((s) => [s.key, s]));
export const OPEN_STATUSES = STATUSES.filter((s) => s.open).map((s) => s.key);

export function statusLabel(key) {
  return STATUS_MAP[key]?.label ?? key;
}

/** Próximo passo natural do funil - alimenta o botão "avançar" da lista. */
export const NEXT_STATUS = {
  orcamento: 'novo',
  novo: 'aguardando',
  aguardando: 'pago',
  pago: 'preparo',
  preparo: 'enviado',
  enviado: 'entregue',
};

export const PAYMENT_METHODS = [
  'PIX',
  'Dinheiro',
  'Cartão de crédito',
  'Cartão de débito',
  'Link de pagamento',
  'Transferência / TED',
  'Boleto',
  'Parcelado na loja',
  'Entrada + saldo',
];

export const PAYMENT_STATUSES = [
  { key: 'pendente', label: 'Pendente', tone: 'amber' },
  { key: 'parcial',  label: 'Parcial',  tone: 'indigo' },
  { key: 'pago',     label: 'Pago',     tone: 'green' },
  { key: 'estornado', label: 'Estornado', tone: 'red' },
];

export const CHANNELS = [
  'Instagram',
  'WhatsApp',
  'Catálogo',
  'Indicação',
  'Loja física',
  'Facebook',
  'Marketplace',
  'Outro',
];

export const SHIPPING_METHODS = [
  'Retirada na loja',
  'Entrega local / motoboy',
  'Correios PAC',
  'Correios SEDEX',
  'Jadlog',
  'Transportadora',
  'Uber / 99 Entrega',
  'Outro',
];

/** Condição do aparelho - faz parte da variação (Lacrado e Seminovo têm preços diferentes). */
export const CONDITIONS = [
  'Lacrado',
  'Novo (caixa aberta)',
  'Vitrine',
  'Seminovo',
  'CPO / Recondicionado',
];

/** Origem de cada aparelho (fica na unidade e no item do pedido). */
export const ORIGINS = ['Nacional', 'Importado (EUA)', 'Importado (Paraguai)', 'Importado (outro)'];

/** Histórico de estoque: como cada movimento aparece na tela. */
export const MOVEMENT_KIND = {
  inicial: { label: 'Estoque inicial', tone: 'gray' },
  entrada: { label: 'Entrada', tone: 'green' },
  venda: { label: 'Pedido', tone: 'blue' },
  ajuste: { label: 'Ajuste', tone: 'amber' },
  baixa: { label: 'Baixa', tone: 'red' },
};

/** Motivos prontos do ajuste de estoque (produto por quantidade). */
export const ADJUST_REASONS = ['Contagem', 'Avaria / quebra', 'Perda', 'Uso próprio', 'Brinde', 'Devolução ao fornecedor', 'Correção'];

/** Motivos prontos da baixa de um aparelho. */
export const DISCARD_REASONS = ['Defeito', 'Devolvido ao fornecedor', 'Uso próprio', 'Roubo / perda', 'Peças', 'Correção'];

/** Situação de cada aparelho (unidade com IMEI). */
export const UNIT_STATUS = {
  estoque: { label: 'Em estoque', tone: 'green' },
  vendido: { label: 'Vendido', tone: 'blue' },
  baixa: { label: 'Baixado', tone: 'red' },
};

export const UFS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR',
  'PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
];
