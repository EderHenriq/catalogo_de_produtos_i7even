// Fórmulas puras (assets/js/core/calc.js): totais do pedido, custo médio,
// rateio de entrada e o fiado (parcelas).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  round2, orderTotals, paymentState, apportionCosts, weightedAvgCost, marginPct,
  addPeriod, buildPlan, planState, planTotal, rebalancePlan,
} from '../../assets/js/core/calc.js';

test('round2 sem o erro do 1.005', () => {
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(-1.005), -1.01);
  assert.equal(round2('abc'), 0);
});

test('totais do pedido (espelho do banco)', () => {
  const t = orderTotals({
    items: [{ qty: 1, unitPrice: 4699, unitCost: 3903.4722 }, { qty: 3, unitPrice: 99.9, unitCost: 14.77 }],
    payments: [{ amount: 1000 }], discount: 0, shippingCost: 0,
  });
  assert.equal(t.total, 4998.7);
  assert.equal(t.balance, 3998.7);
  assert.equal(paymentState(4998.7, 1000), 'parcial');
  assert.equal(paymentState(100, 100), 'pago');
  assert.equal(paymentState(100, 0, true), 'estornado');
});

test('lucro conta o frete cobrado e desconta o frete pago (igual ao banco)', () => {
  const t = orderTotals({ items: [{ qty: 1, unitPrice: 200, unitCost: 50 }], discount: 0, shippingCost: 30, shippingExpense: 25 });
  assert.equal(t.total, 230);
  assert.equal(t.profit, 155, '200 + 30 − 50 − 25');
  const gratis = orderTotals({ items: [{ qty: 1, unitPrice: 200, unitCost: 50 }], shippingExpense: 25 });
  assert.equal(gratis.profit, 125, 'frete grátis para o cliente: a loja paga 25');
});

test('quantidade como o banco grava: nunca menos que os IMEIs escolhidos', () => {
  const t = orderTotals({ items: [{ qty: 1, unitPrice: 3000, unitCost: 2000, unitIds: ['a', 'b'] }] });
  assert.equal(t.units, 2);
  assert.equal(t.subtotal, 6000);
  assert.equal(orderTotals({ items: [{ qty: 0, unitPrice: 10 }] }).subtotal, 10, 'quantidade 0 vira 1');
});

test('custo médio e margem', () => {
  assert.equal(weightedAvgCost(2, 100, 2, 200), 150);
  assert.equal(Math.round(marginPct(150, 100)), 33, 'margem sobre o preço de venda');
});

test('rateio do frete na entrada (proporcional ao custo, em US$)', () => {
  const r = apportionCosts([{ qty: 1, unitCost: 100 }, { qty: 1, unitCost: 300 }], { freight: 40 });
  assert.deepEqual(r.lines.map((l) => l.unitCost), [110, 330]);
  assert.equal(r.total, 440);
  const u = apportionCosts([{ unitCost: 700, units: [{}, { cost: 720 }] }], { currency: 'USD', exchangeRate: 5 });
  assert.deepEqual(u.lines[0].unitCosts, [3500, 3600]);
});

test('meses: dia 31 vira o último dia do mês, nunca pula', () => {
  assert.equal(addPeriod('2026-01-31', 1), '2026-02-28');
  assert.equal(addPeriod('2028-01-31', 1), '2028-02-29');
  assert.equal(addPeriod('2026-01-31', 2), '2026-03-31');
  assert.equal(addPeriod('2026-11-15', 2), '2027-01-15');
  assert.equal(addPeriod('2026-10-01', 1, 'quinzenal'), '2026-10-16');
  assert.equal(addPeriod('2026-10-01', 2, 'semanal'), '2026-10-15');
});

test('combinado: entrada + parcelas fecham EXATAMENTE com o total', () => {
  const p = buildPlan({ total: 1000, down: 400, downDate: '2026-10-28', count: 3, first: '2026-11-28' });
  assert.deepEqual(p.map((x) => [x.number, x.dueDate, x.amount]), [
    [0, '2026-10-28', 400], [1, '2026-11-28', 200], [2, '2026-12-28', 200], [3, '2027-01-28', 200]]);
  for (const total of [999.99, 1000, 4998.7, 7.01, 12345.67]) {
    for (const count of [1, 2, 3, 7, 12]) {
      const q = buildPlan({ total, down: total / 5, downDate: '2026-10-28', count, first: '2026-11-10' });
      assert.equal(planTotal(q), round2(total), `total ${total} em ${count}x`);
      assert.ok(q.every((x) => x.amount > 0));
    }
  }
  assert.deepEqual(buildPlan({ total: 300, count: 0, first: '2026-11-01' }).map((x) => x.amount), [300], 'sem parcelas: uma só');
  assert.deepEqual(buildPlan({ total: 300, down: 500, downDate: '2026-10-01', count: 3, first: '2026-11-01' }).map((x) => x.amount), [300],
    'entrada maior que o total vira à vista');
});

test('situação das parcelas: pagamentos abatem da mais antiga', () => {
  const plan = buildPlan({ total: 1000, down: 400, downDate: '2026-09-01', count: 3, first: '2026-10-01' });
  let st = planState(plan, 500, '2026-10-28');
  assert.deepEqual(st.map((x) => x.status), ['paga', 'atrasada', 'aberta', 'aberta']);
  assert.equal(st[1].open, 100);
  assert.equal(st[1].late, 27);
  st = planState(plan, 400, '2026-11-01');
  assert.deepEqual(st.map((x) => x.status), ['paga', 'atrasada', 'hoje', 'aberta']);
  assert.equal(st[2].inDays, 0);
  st = planState(plan, 1000, '2027-06-01');
  assert.ok(st.every((x) => x.status === 'paga' && x.open === 0));
  st = planState(plan, -50, '2026-08-01');
  assert.ok(st.every((x) => x.paid === 0), 'estorno não paga parcela');
});

test('pedido mudou de valor: rebalanceia só as abertas', () => {
  const plan = buildPlan({ total: 1000, down: 400, downDate: '2026-09-01', count: 3, first: '2026-10-01' });
  let r = rebalancePlan(plan, 1300, 400, '2026-09-15');
  assert.equal(planTotal(r), 1300);
  assert.deepEqual(r.map((x) => x.amount), [400, 300, 300, 300]);
  r = rebalancePlan(plan, 1000.01, 400, '2026-09-15');
  assert.equal(planTotal(r), 1000.01);
  r = rebalancePlan(plan, 300, 400, '2026-09-15');
  assert.equal(planTotal(r), 300, 'mais barato que a entrada já paga: corta');
  r = rebalancePlan(plan, 1500, 1000, '2027-01-01');
  assert.equal(planTotal(r), 1500, 'tudo quitado e o pedido subiu: parcela nova no fim');
  assert.equal(r[r.length - 1].amount, 500);
});
