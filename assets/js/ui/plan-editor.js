/**
 * Fiado / parcelas: o combinado de QUANDO o cliente paga.
 *
 *   - Montar: entrada (já vem com o que foi pago) + N parcelas iguais, a
 *     partir de uma data, mensal / quinzenal / semanal. Os centavos da divisão
 *     caem na última - a soma fecha com o total (o banco confere).
 *   - Conferir: cada parcela com data e valor editáveis e a situação de hoje
 *     (paga, atrasada, vence hoje, aberta) - calculada pelos pagamentos.
 *   - Pedido mudou de valor: "Ajustar ao total" reparte a diferença só nas
 *     parcelas abertas.
 *
 * Usado no formulário do pedido (mountPlanEditor) e sozinho, na ficha e no
 * "entregar no fiado" (openPlanDialog).
 */

import * as Data from '../core/data.js';
import { buildPlan, planState, planTotal, rebalancePlan, addPeriod, round2 } from '../core/calc.js';
import { friendlyError, isConflict } from '../core/errors.js';
import { esc, money, parseMoney, moneyInputValue, formatDate, todayISO, uid } from '../core/utils.js';
import { openModal, toast, toastError, withLoading, confirmDialog } from './kit.js';
import { icon } from './icons.js';

const MONEY_ATTRS = 'inputmode="numeric" autocomplete="off" placeholder="0,00"';
const STEPS = [['mensal', 'Todo mês'], ['quinzenal', 'A cada 15 dias'], ['semanal', 'Toda semana']];
export const INST_TONE = { paga: 'green', atrasada: 'red', hoje: 'amber', aberta: 'gray' };

/** Rótulo curto da situação de uma parcela. */
export function instLabel(p) {
  if (p.status === 'paga') return 'Paga';
  if (p.status === 'hoje') return 'Vence hoje';
  if (p.status === 'atrasada') return p.late === 1 ? 'Atrasada 1 dia' : `Atrasada ${p.late} dias`;
  if (p.inDays === 1) return 'Vence amanhã';
  return p.inDays <= 7 ? `Vence em ${p.inDays} dias` : `Vence ${formatDate(p.dueDate)}`;
}

/** "Entrada", "Parcela 2/5". */
export function instName(p, plan) {
  if (p.synthetic) return 'Saldo';
  const n = (plan || []).filter((x) => x.number > 0).length;
  return p.number === 0 ? 'Entrada' : `Parcela ${p.number}/${n}`;
}

/**
 * Editor dentro de um contêiner.
 * @param {HTMLElement} host
 * @param {{plan: object[], total: () => number, paid: () => number, onChange: (plan: object[]) => void}} opts
 */
export function mountPlanEditor(host, { plan = [], total, paid, onChange }) {
  let rows = plan.map((p) => ({ ...p }));
  const today = todayISO();
  const s = { down: round2(Math.max(paid(), 0)), count: 3, first: addPeriod(today, 1), step: 'mensal' };
  let downTouched = false;   // até a pessoa mexer, a entrada acompanha o que já foi recebido

  function emit() { onChange?.(rows.map(({ id, number, dueDate, amount, note }) => ({ id, number, dueDate, amount, note }))); }

  function render() {
    const t = round2(total());
    if (!rows.length) {
      if (!downTouched) s.down = round2(Math.max(paid(), 0));
      host.innerHTML = `
        <div class="plan-build">
          <div class="form-grid">
            <div class="field span-3 span-half-mobile"><label class="label" for="pl-down">Entrada</label>
              <div class="money-input"><input class="input" id="pl-down" data-pl="down" ${MONEY_ATTRS} value="${esc(moneyInputValue(s.down))}"></div></div>
            <div class="field span-3 span-half-mobile"><label class="label" for="pl-count">Parcelas</label>
              <select class="select" id="pl-count" data-pl="count">${Array.from({ length: 24 }, (_, i) => i + 1).map((n) => `<option value="${n}" ${n === s.count ? 'selected' : ''}>${n}x</option>`).join('')}</select></div>
            <div class="field span-3 span-half-mobile"><label class="label" for="pl-first">1º vencimento</label>
              <input class="input" id="pl-first" data-pl="first" type="date" value="${esc(s.first)}"></div>
            <div class="field span-3 span-half-mobile"><label class="label" for="pl-step">Depois</label>
              <select class="select" id="pl-step" data-pl="step">${STEPS.map(([k, l]) => `<option value="${k}" ${k === s.step ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          </div>
          <div class="plan-preview small" data-pl-preview>${previewText(t)}</div>
          <button type="button" class="btn btn-outline btn-block" data-pl-build ${t > 0 ? '' : 'disabled'}>${icon('calendar')} Montar parcelas</button>
        </div>`;
      return;
    }
    const st = planState(rows, paid(), today);
    const byKey = new Map(st.map((p) => [p.id, p]));
    const sum = planTotal(rows);
    const diff = round2(t - sum);
    host.innerHTML = `
      <div class="plan-rows">
        ${rows.map((r) => {
          const p = byKey.get(r.id) || r;
          return `
            <div class="plan-row" data-row="${esc(r.id)}">
              <span class="plan-n">${r.number === 0 ? 'Entrada' : `${r.number}ª`}</span>
              <input class="input plan-date" type="date" data-f="dueDate" value="${esc(r.dueDate)}" aria-label="Vencimento">
              <div class="money-input plan-amount"><input class="input" data-f="amount" ${MONEY_ATTRS} value="${esc(moneyInputValue(r.amount))}" aria-label="Valor"></div>
              <span class="badge no-dot plan-st" data-tone="${INST_TONE[p.status] || 'gray'}">${esc(p.status ? instLabel(p) : '')}</span>
              <button type="button" class="icon-btn sm" data-pl-del="${esc(r.id)}" aria-label="Tirar parcela">${icon('trash')}</button>
            </div>`;
        }).join('')}
      </div>
      <div class="plan-foot">
        <span class="small ${Math.abs(diff) > 0.005 ? 'tone-red strong' : 'dim'}">
          ${Math.abs(diff) > 0.005 ? `Parcelas somam ${esc(money(sum))} · pedido ${esc(money(t))} (${diff > 0 ? 'faltam' : 'sobram'} ${esc(money(Math.abs(diff)))})` : `${rows.length} ${rows.length === 1 ? 'parcela' : 'parcelas'} · soma ${esc(money(sum))}`}
        </span>
        <div class="row gap-2 wrap">
          ${Math.abs(diff) > 0.005 ? `<button type="button" class="btn btn-sm btn-primary" data-pl-fit>${icon('refresh')} Ajustar ao total</button>` : ''}
          <button type="button" class="btn btn-sm" data-pl-add>${icon('plus')} Parcela</button>
          <button type="button" class="btn btn-sm btn-ghost" data-pl-reset>Refazer</button>
        </div>
      </div>`;
  }

  function previewText(t) {
    const down = Math.min(s.down, t);
    const rest = round2(t - down);
    if (!(t > 0)) return 'Adicione os produtos para montar as parcelas.';
    if (rest <= 0) return 'A entrada cobre o pedido inteiro.';
    const each = Math.floor((rest / s.count) * 100) / 100;
    return `${down > 0 ? `Entrada de <b>${esc(money(down))}</b> + ` : ''}<b>${s.count}x de ${esc(money(each))}</b>${s.count > 1 && round2(rest - each * s.count) ? ' (a última com os centavos)' : ''}, a primeira em ${esc(formatDate(s.first))}.`;
  }

  host.addEventListener('input', (e) => {
    const k = e.target.dataset.pl;
    if (k) {
      if (k === 'down') { s.down = parseMoney(e.target.value); downTouched = true; }
      host.querySelector('[data-pl-preview]').innerHTML = previewText(round2(total()));
      return;
    }
    const f = e.target.dataset.f;
    const row = rows.find((r) => r.id === e.target.closest('[data-row]')?.dataset.row);
    if (!f || !row) return;
    if (f === 'amount') row.amount = parseMoney(e.target.value);
    emit();
  });
  host.addEventListener('change', (e) => {
    const k = e.target.dataset.pl;
    if (k === 'count') s.count = Number(e.target.value) || 1;
    if (k === 'first') s.first = e.target.value || s.first;
    if (k === 'step') s.step = e.target.value;
    if (k) { host.querySelector('[data-pl-preview]').innerHTML = previewText(round2(total())); return; }
    const row = rows.find((r) => r.id === e.target.closest('[data-row]')?.dataset.row);
    if (!row) return;
    if (e.target.dataset.f === 'dueDate' && e.target.value) row.dueDate = e.target.value;
    rows.sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)) || a.number - b.number);
    emit();
    render();
  });
  host.addEventListener('focusout', (e) => {
    // terminou de digitar um valor: atualiza a soma e as situações
    if (e.target.dataset.f === 'amount') render();
  });
  host.addEventListener('click', async (e) => {
    if (e.target.closest('[data-pl-build]')) {
      rows = buildPlan({ total: total(), down: s.down, downDate: today, count: s.count, first: s.first, step: s.step }).map((p) => ({ ...p, id: uid() }));
      emit(); render();
      return;
    }
    if (e.target.closest('[data-pl-fit]')) {
      rows = rebalancePlan(rows, total(), paid(), today).map((p) => ({ ...p, id: p.id || uid() }));
      renumber(); emit(); render();
      return;
    }
    if (e.target.closest('[data-pl-add]')) {
      const last = rows[rows.length - 1];
      rows.push({ id: uid(), number: (Math.max(0, ...rows.map((r) => r.number)) + 1), dueDate: last ? addPeriod(last.dueDate, 1) : addPeriod(today, 1), amount: 0, note: '' });
      emit(); render();
      host.querySelector('.plan-row:last-child [data-f="amount"]')?.focus();
      return;
    }
    if (e.target.closest('[data-pl-reset]')) {
      const ok = await confirmDialog({ title: 'Refazer as parcelas?', message: 'O combinado atual é apagado (os pagamentos já lançados continuam).', confirmText: 'Refazer' });
      if (!ok) return;
      rows = []; emit(); render();
      return;
    }
    const del = e.target.closest('[data-pl-del]');
    if (del) { rows = rows.filter((r) => r.id !== del.dataset.plDel); renumber(); emit(); render(); }
  });

  function renumber() {
    let n = 0;
    rows.sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)) || a.number - b.number);
    for (const r of rows) { if (r.number !== 0 || r.note !== 'Entrada') { n += 1; r.number = n; } }
  }

  render();
  return {
    refresh: render,
    get plan() { return rows; },
    /** Soma confere com o total? */
    fits: () => !rows.length || Math.abs(planTotal(rows) - round2(total())) <= 0.05,
    fit() { rows = rebalancePlan(rows, total(), paid(), today).map((p) => ({ ...p, id: p.id || uid() })); renumber(); emit(); render(); },
  };
}

/**
 * Combinado num modal (ficha do pedido / entregar no fiado). Grava pelo
 * save_order - o pedido inteiro, conferindo se ninguém mexeu nele antes.
 */
export function openPlanDialog(orderId, { title = 'Parcelas do fiado', onSaved } = {}) {
  const o = Data.order(orderId);
  if (!o) return null;
  let plan = (o.plan || []).map((p) => ({ ...p }));
  const modal = openModal({
    title,
    subtitle: `#${String(o.code).padStart(4, '0')} · ${o.customerName} · falta ${money(o.balance)} de ${money(o.total)}`,
    size: 'lg',
    body: '<div data-plan></div>',
    footer: '<button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Salvar parcelas</button>',
  });
  const ed = mountPlanEditor(modal.body.querySelector('[data-plan]'), {
    plan, total: () => o.total, paid: () => o.paidAmount, onChange: (p) => { plan = p; },
  });
  modal.foot.querySelector('[data-ok]').addEventListener('click', async () => {
    const btn = modal.foot.querySelector('[data-ok]');
    if (!ed.fits()) {
      const fix = await confirmDialog({ title: 'As parcelas não fecham com o total', message: `O pedido é de ${money(o.total)}. Ajustar as parcelas abertas para fechar?`, confirmText: 'Ajustar e salvar' });
      if (!fix) return;
      ed.fit();
    }
    await withLoading(btn, async () => {
      try {
        await Data.saveOrder({ ...structuredClone(Data.order(orderId)), plan });
        modal.close();
        toast(plan.length ? 'Parcelas salvas' : 'Parcelas removidas');
        onSaved?.();
      } catch (err) {
        toastError(isConflict(err) ? 'Pedido alterado em outro aparelho' : 'Não foi possível salvar', friendlyError(err));
      }
    });
  });
  return modal;
}
