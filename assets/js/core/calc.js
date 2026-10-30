/**
 * Fórmulas de negócio - puras, sem tela e sem banco, cobertas por
 * tests/unit/calc.test.mjs.
 *
 * Regra do projeto (contextos/03): toda conta que o banco também faz
 * (supabase/schema.sql) tem o MESMO resultado aqui e lá. A tela mostra a
 * prévia com estas funções; quem grava o valor oficial é o banco. Quem mudar
 * uma fórmula muda as duas e o teste.
 */

/** Arredonda para centavos sem o erro clássico de 1.005 → 1.00. */
export function round2(n) {
  const v = Number(n) || 0;
  return Math.round((v + Math.sign(v) * Number.EPSILON) * 100) / 100;
}

/** Custo unitário guarda 4 casas (numeric(12,4) no banco): rateio sem perder centavos. */
export function round4(n) {
  const v = Number(n) || 0;
  return Math.round((v + Math.sign(v) * Number.EPSILON) * 10000) / 10000;
}

/** Quantidade como o banco grava: inteira, no mínimo 1 e nunca menos que os IMEIs escolhidos. */
const qtyOf = (it) => Math.max(Math.trunc(Number(it.qty) || 1), 1, (it.unitIds || []).length);

/* ------------------------------------------------------------ pedido --- */

/**
 * Totais do pedido - espelho de orders_compute_totals().
 *   subtotal = Σ preço × qtd
 *   total    = subtotal − desconto + frete cobrado
 *   lucro    = total − Σ custo × qtd − frete que a loja pagou
 *              (o frete cobrado do cliente é receita; o pago ao entregador, despesa)
 *   recebido = Σ pagamentos (estorno entra negativo)
 */
export function orderTotals({ items = [], payments = [], discount = 0, shippingCost = 0, shippingExpense = 0 }) {
  let subtotal = 0;
  let costTotal = 0;
  let units = 0;
  for (const it of items) {
    const q = qtyOf(it);
    subtotal += (Number(it.unitPrice) || 0) * q;
    costTotal += (Number(it.unitCost) || 0) * q;
    units += q;
  }
  const disc = Math.max(Number(discount) || 0, 0);
  const ship = Math.max(Number(shippingCost) || 0, 0);
  const shipExp = Math.max(Number(shippingExpense) || 0, 0);
  const paid = round2(payments.reduce((a, p) => a + (Number(p.amount) || 0), 0));
  const total = round2(subtotal - disc + ship);
  return {
    units,
    subtotal: round2(subtotal),
    costTotal: round2(costTotal),
    discount: round2(disc),
    shipping: round2(ship),
    total,
    paid,
    profit: round2(subtotal - disc + ship - costTotal - shipExp),
    balance: round2(Math.max(total - paid, 0)),
    overpaid: round2(Math.max(paid - total, 0)),
  };
}

/** Situação do pagamento - espelho do gatilho do banco. */
export function paymentState(total, paid, hasRefund = false) {
  const t = round2(total);
  const p = round2(paid);
  if (t > 0 && p >= t) return 'pago';
  if (p > 0) return 'parcial';
  if (hasRefund) return 'estornado';
  return 'pendente';
}

/* ------------------------------------------------------------ entrada --- */

/**
 * Custo REAL de cada linha de uma entrada - espelho de post_purchase().
 *   custo em R$  = custo digitado × câmbio (nota em US$) ou × 1
 *   rateio       = (frete + taxas) × valor da linha ÷ valor da nota
 *                  (nota sem valor: dividido pelas unidades)
 *   custo real   = custo em R$ + rateio ÷ unidades da linha
 * Aparelho com IMEI: cada unidade é uma "linha" de 1 (pode ter custo próprio).
 *
 * @param {{qty:number, unitCost:number, units?:{cost?:number}[]}[]} lines
 * @returns {{ itemsTotal:number, total:number, lines:{qty:number, unitCost:number, unitCosts:number[]}[] }}
 */
export function apportionCosts(lines, { freight = 0, otherCosts = 0, exchangeRate = 1, currency = 'BRL' } = {}) {
  const rate = currency === 'USD' ? Math.max(Number(exchangeRate) || 0, 0.0001) : 1;
  const extra = Math.max(Number(freight) || 0, 0) + Math.max(Number(otherCosts) || 0, 0);
  const norm = lines.map((l) => {
    const base = Math.max(Number(l.unitCost) || 0, 0);
    if (l.units?.length) {
      const costs = l.units.map((u) => (u.cost === '' || u.cost == null ? base : Math.max(Number(u.cost) || 0, 0)) * rate);
      return { qty: costs.length, costs };
    }
    const q = Math.max(Math.trunc(Number(l.qty) || 1), 1);
    return { qty: q, costs: Array(q).fill(base * rate) };
  });
  const itemsTotal = norm.reduce((a, l) => a + l.costs.reduce((x, c) => x + c, 0), 0);
  const totalUnits = norm.reduce((a, l) => a + l.qty, 0);
  const share = (cost) => (itemsTotal > 0 ? extra * (cost / itemsTotal) : totalUnits > 0 ? extra / totalUnits : 0);
  return {
    itemsTotal: round2(itemsTotal),
    total: round2(round2(itemsTotal) + extra),
    lines: norm.map((l) => {
      const unitCosts = l.costs.map((c) => round4(c + share(c)));
      return { qty: l.qty, unitCosts, unitCost: round4(unitCosts.reduce((a, c) => a + c, 0) / l.qty) };
    }),
  };
}

/** Custo médio ponderado - espelho de post_purchase() (produto sem IMEI). */
export function weightedAvgCost(stock, cost, qtyIn, costIn) {
  const s = Math.max(Number(stock) || 0, 0);
  if (s === 0) return round4(costIn);
  return round4((s * (Number(cost) || 0) + qtyIn * (Number(costIn) || 0)) / (s + qtyIn));
}

/** Preço sugerido pela margem padrão, arredondado para cima em R$ 10 (aparelho) ou R$ 1. */
export function suggestPrice(cost, markupPct) {
  const raw = (Number(cost) || 0) * (1 + (Number(markupPct) || 0) / 100);
  if (raw <= 0) return 0;
  const step = raw >= 500 ? 10 : 1;
  return Math.ceil(raw / step) * step;
}

/** Margem de lucro em % sobre o preço de venda. */
export function marginPct(price, cost) {
  const p = Number(price) || 0;
  if (p <= 0) return null;
  return round2(((p - (Number(cost) || 0)) / p) * 100);
}

/* ------------------------------------------------------------ estoque --- */

/** Nível do estoque de uma variação: ok / baixo / zerado. */
export function stockLevel(stock, minStock) {
  const s = Number(stock) || 0;
  if (s <= 0) return 'zerado';
  if (s <= (Number(minStock) || 0)) return 'baixo';
  return 'ok';
}

/** "256GB · Titânio natural · Lacrado" - mesma ordem do variant_label() do banco. */
export function variantLabel(v = {}) {
  return [v.size, v.storage, v.color, v.condition].map((x) => String(x || '').trim()).filter(Boolean).join(' · ');
}

/* ------------------------------------------------------ fiado / parcelas --- */

const isoDay = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const parseDay = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const dayDiff = (a, b) => Math.round((parseDay(a) - parseDay(b)) / 86400000);

/**
 * Soma `months` meses mantendo o dia (31/01 + 1 mês = 28 ou 29/02, nunca 03/03).
 * `step` 'mensal' | 'quinzenal' | 'semanal'.
 */
export function addPeriod(iso, n, step = 'mensal') {
  const d = parseDay(iso);
  if (step === 'semanal') { d.setDate(d.getDate() + 7 * n); return isoDay(d); }
  if (step === 'quinzenal') { d.setDate(d.getDate() + 15 * n); return isoDay(d); }
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return isoDay(d);
}

/**
 * Monta o combinado: entrada (parcela 0, hoje) + N parcelas iguais. Os
 * centavos que sobram da divisão vão na última - a soma fecha EXATAMENTE
 * com o total (o banco confere).
 */
export function buildPlan({ total, down = 0, downDate, count = 1, first, step = 'mensal' }) {
  const t = round2(total);
  const entrada = Math.min(round2(Math.max(down, 0)), t);
  const rest = round2(t - entrada);
  const n = rest > 0 ? Math.max(Math.trunc(count) || 0, 1) : 0;
  const out = [];
  if (entrada > 0) out.push({ number: 0, dueDate: downDate, amount: entrada, note: 'Entrada' });
  if (n > 0) {
    const each = Math.floor((rest / n) * 100) / 100;
    for (let i = 0; i < n; i++) {
      const amount = i === n - 1 ? round2(rest - each * (n - 1)) : each;
      out.push({ number: i + 1, dueDate: addPeriod(first, i, step), amount, note: '' });
    }
  }
  return out;
}

/**
 * Situação de cada parcela: o que já foi pago abate primeiro a entrada e
 * depois as parcelas na ordem do vencimento (a mais antiga primeiro).
 *   status: 'paga' | 'atrasada' | 'hoje' | 'aberta'
 *   open:   quanto falta desta parcela;  late: dias de atraso (0 se não).
 */
export function planState(plan, paid, today) {
  let left = round2(Math.max(Number(paid) || 0, 0));
  return [...(plan || [])]
    .sort((a, b) => (a.number === 0 ? 0 : 1) - (b.number === 0 ? 0 : 1)
      || String(a.dueDate).localeCompare(String(b.dueDate)) || a.number - b.number)
    .map((p) => {
      const amount = round2(p.amount);
      const got = Math.min(left, amount);
      left = round2(left - got);
      const open = round2(amount - got);
      // sem vencimento (saldo de um pedido que ainda vai ser entregue): aberta, nunca atrasa
      const diff = p.dueDate ? dayDiff(today, p.dueDate) : null;
      const status = open <= 0.005 ? 'paga' : diff === null ? 'aberta' : diff > 0 ? 'atrasada' : diff === 0 ? 'hoje' : 'aberta';
      return { ...p, amount, paid: round2(got), open: status === 'paga' ? 0 : open, status, late: status === 'atrasada' ? diff : 0, inDays: diff ? -diff : 0 };
    });
}

/** Soma do combinado (para conferir com o total do pedido). */
export const planTotal = (plan) => round2((plan || []).reduce((a, p) => a + (Number(p.amount) || 0), 0));

/**
 * Ajusta o combinado a um total novo (o pedido mudou): parcelas quitadas
 * ficam como estão; o resto é repartido igualmente nas abertas (centavos na
 * última). Sem parcela aberta, cria uma no fim. A soma fecha com o total.
 */
export function rebalancePlan(plan, total, paid, today) {
  const strip = ({ id, number, dueDate, amount, note }) => ({ id, number, dueDate, amount, note });
  const st = planState(plan, paid, today);
  const settled = st.filter((p) => p.status === 'paga').map(strip);
  const open = st.filter((p) => p.status !== 'paga').map(strip);
  const t = round2(total);
  let rest = round2(t - planTotal(settled));
  if (rest <= 0) {
    // ficou mais barato do que o já quitado: corta do fim até fechar
    const out = [];
    let left = t;
    for (const p of settled) { const a = Math.min(p.amount, round2(left)); if (a > 0) out.push({ ...p, amount: a }); left = round2(left - a); }
    return out;
  }
  if (!open.length) {
    const last = settled[settled.length - 1];
    return [...settled, { number: (last?.number || 0) + 1, dueDate: last ? addPeriod(last.dueDate, 1) : today, amount: rest, note: '' }];
  }
  const each = Math.floor((rest / open.length) * 100) / 100;
  open.forEach((p, i) => { p.amount = i === open.length - 1 ? round2(rest - each * (open.length - 1)) : each; });
  return [...settled, ...open].sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)) || a.number - b.number);
}
