/**
 * Ajustes: dados da loja (vão para o PDF, o WhatsApp e o catálogo), regras
 * de venda, aparência, conta, backup, exportações e diagnóstico de erros.
 *
 * Atenção (bug 11.2 do guia): os botões de tema usam `data-set-theme`, nunca
 * `data-theme` - esse atributo existe no <html> e o `closest()` casava com
 * ele em QUALQUER toque da tela.
 */

import * as Data from '../core/data.js';
import { APP } from '../config.js';
import { CONDITIONS } from '../core/constants.js';
import { friendlyError } from '../core/errors.js';
import { signOut, signOutEverywhere, updatePassword, getUser } from '../core/supabase.js';
import { getTheme, applyTheme, isPrivacy, applyPrivacy } from './theme.js';
import { toast, toastError, confirmDialog, openModal, withLoading } from './kit.js';
import { exportCSV } from './orders.js';
import { exportCustomers } from './customers.js';
import { exportItems } from './reports.js';
import { icon } from './icons.js';
import { moneyHTML } from './common.js';
import { esc, maskPhone, downloadFile, formatDateTime, todayISO } from '../core/utils.js';

export function mount(host, ctx) {
  host.innerHTML = '<div class="view" data-root></div>';
  const root = host.querySelector('[data-root]');
  const userReq = getUser().catch(() => null);
  let diag = null;

  async function render() {
    const user = await userReq;
    const s = Data.settings();
    const orders = Data.orders();
    const revenue = orders.filter((o) => o.status !== 'cancelado' && o.status !== 'orcamento').reduce((a, o) => a + o.total, 0);

    root.innerHTML = `
      <div class="section-head"><h2>Ajustes</h2></div>

      <form class="card" data-store-form>
        <div class="card-head"><h3>${icon('store')} Dados da loja</h3><span class="xs dim">aparecem no PDF do pedido, no WhatsApp e no catálogo</span></div>
        <div class="card-body">
          <div class="form-grid">
            <div class="field span-6"><label class="label" for="st-name">Nome da loja</label>
              <input class="input" id="st-name" name="storeName" maxlength="80" value="${esc(s.storeName)}"></div>
            <div class="field span-6 span-half-mobile"><label class="label" for="st-phone">WhatsApp da loja</label>
              <input class="input" id="st-phone" name="phone" inputmode="tel" maxlength="16" value="${esc(maskPhone(s.phone))}" placeholder="(44) 99999-0000"></div>
            <div class="field span-6 span-half-mobile"><label class="label" for="st-ig">Instagram</label>
              <input class="input" id="st-ig" name="instagram" maxlength="60" value="${esc(s.instagram)}" placeholder="@i7evenstore"></div>
            <div class="field span-6"><label class="label" for="st-pix">Chave Pix</label>
              <input class="input" id="st-pix" name="pixKey" maxlength="120" value="${esc(s.pixKey)}" placeholder="CNPJ, e-mail, telefone ou aleatória"></div>
            <div class="field span-6"><label class="label" for="st-email">E-mail</label>
              <input class="input" id="st-email" name="email" type="email" maxlength="120" value="${esc(s.email)}"></div>
            <div class="field span-12"><label class="label" for="st-addr">Endereço / cidade</label>
              <input class="input" id="st-addr" name="address" maxlength="240" value="${esc(s.address)}" placeholder="ex.: Maringá - PR · entregamos em toda a cidade"></div>
            <div class="field span-12"><label class="label" for="st-footer">Rodapé do PDF</label>
              <input class="input" id="st-footer" name="footerText" maxlength="240" value="${esc(s.footerText)}" placeholder="ex.: Obrigado pela preferência! Garantia conforme condição do aparelho."></div>
          </div>
          <div class="row gap-2" style="justify-content:flex-end;margin-top:14px">
            <button type="submit" class="btn btn-primary" data-save-store>${icon('check')} Salvar dados da loja</button>
          </div>
        </div>
      </form>

      <form class="card" data-rules-form>
        <div class="card-head"><h3>${icon('settings')} Regras de venda</h3></div>
        <div class="card-body col gap-4">
          <div>
            <div class="strong">Garantia padrão por condição (dias)</div>
            <div class="small dim">Já vem preenchida no item do pedido e sai no PDF.</div>
          </div>
          <div class="form-grid">
            ${CONDITIONS.map((c, i) => `<div class="field span-4 span-half-mobile"><label class="label" for="w-${i}">${esc(c)}</label>
              <input class="input" id="w-${i}" data-warranty="${esc(c)}" type="number" inputmode="numeric" min="0" max="3650" value="${esc(s.warrantyDays?.[c] ?? '')}"></div>`).join('')}
          </div>
          <div class="form-grid">
            <div class="field span-6"><label class="label" for="st-markup">Margem para sugerir o preço na entrada (%)</label>
              <input class="input" id="st-markup" name="defaultMarkupPct" type="text" inputmode="decimal" value="${esc(String(s.defaultMarkupPct).replace('.', ','))}"></div>
            <div class="field span-6" style="justify-content:flex-end">
              <label class="check"><input type="checkbox" name="allowNegativeStock" ${s.allowNegativeStock ? 'checked' : ''}><span class="box"></span>
                <span>Vender acessório/perfume sem estoque <span class="xs dim block">Aparelho com IMEI vira encomenda de qualquer jeito.</span></span></label>
            </div>
          </div>
          <div class="row gap-2" style="justify-content:flex-end">
            <button type="submit" class="btn btn-primary" data-save-rules>${icon('check')} Salvar regras</button>
          </div>
        </div>
      </form>

      <div class="card">
        <div class="card-head"><h3>Aparência</h3></div>
        <div class="card-body col gap-5">
          <div class="row-between wrap gap-3">
            <div><div class="strong">Tema</div><div class="small dim">"Automático" acompanha o aparelho.</div></div>
            <div class="segmented" role="group" aria-label="Tema">
              ${[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Escuro']].map(([k, label]) => `
                <button type="button" data-set-theme="${k}" aria-pressed="${getTheme() === k}">${label}</button>`).join('')}
            </div>
          </div>
          <div class="row-between wrap gap-3">
            <div><div class="strong">Modo privacidade</div><div class="small dim">Borra todos os valores em R$ - para mostrar a tela em público.</div></div>
            <label class="switch"><input type="checkbox" data-toggle-privacy ${isPrivacy() ? 'checked' : ''}><span class="track"><span class="thumb"></span></span></label>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Conta</h3></div>
        <div class="card-body col gap-4">
          <div class="row gap-3">
            <span class="avatar">${icon('lock')}</span>
            <div class="grow truncate">
              <div class="strong truncate">${esc(Data.memberName() ? `${Data.memberName()} · ` : '')}${esc(user?.email || '-')}</div>
              <div class="small dim">Entrou em ${esc(user?.last_sign_in_at ? formatDateTime(user.last_sign_in_at) : '-')}</div>
            </div>
          </div>
          <div class="row gap-2 wrap">
            <button class="btn" data-password>${icon('lock')} Trocar senha</button>
            <button class="btn" data-logout-all>${icon('logout')} Sair de todos os aparelhos</button>
            <button class="btn btn-danger" data-logout>${icon('logout')} Sair</button>
          </div>
          ${APP.idleLogoutMinutes ? `<p class="hint">O sistema desconecta sozinho depois de ${APP.idleLogoutMinutes} minutos sem uso.</p>` : ''}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Seus dados</h3></div>
        <div class="card-body col gap-4">
          <div class="grid grid-3">
            <div><div class="small dim">Pedidos (12 meses + abertos)</div><div class="kpi-value sm">${orders.length}</div></div>
            <div><div class="small dim">Clientes</div><div class="kpi-value sm">${Data.customersList().length}</div></div>
            <div><div class="small dim">Faturamento carregado</div><div class="kpi-value sm">${moneyHTML(revenue)}</div></div>
          </div>
          <div><div class="strong">Exportar planilhas (CSV)</div><div class="small dim">Abre no Excel ou no Google Planilhas.</div></div>
          <div class="row gap-2 wrap">
            <button class="btn" data-csv>${icon('download')} Pedidos</button>
            <button class="btn" data-csv-items>${icon('download')} Itens vendidos</button>
            <button class="btn" data-csv-customers>${icon('download')} Clientes</button>
          </div>
          <div><div class="strong">Backup completo</div>
            <div class="small dim">Tudo num arquivo: pedidos (todos), produtos, variações, aparelhos com IMEI, clientes e entradas.
              Guarde uma cópia fora do computador de vez em quando - e sempre antes de atualizar o banco.</div></div>
          <div class="row gap-2 wrap">
            <button class="btn" data-backup>${icon('download')} Baixar backup (JSON)</button>
            <button class="btn btn-outline" data-restore>${icon('upload')} Restaurar pedidos de um backup</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>${icon('alert')} Diagnóstico</h3><span class="xs dim">erros que aconteceram nos aparelhos (90 dias)</span></div>
        <div class="card-body" data-diag>${diagHTML()}</div>
      </div>

      <p class="xs dim center">i7even · app ${esc(APP.version)} · banco versão ${esc(APP.schemaVersion)}</p>`;
  }

  function diagHTML() {
    if (!diag) return `<button class="btn btn-sm" data-load-diag>${icon('search')} Ver erros registrados</button>`;
    if (!diag.length) return '<p class="small dim">Nenhum erro registrado. 🎉</p>';
    return `
      <div class="movement-list">${diag.map((e) => `
        <div class="movement-row"><span class="grow small"><b>${esc(e.message)}</b>
          <span class="xs dim block">${esc(formatDateTime(e.created_at))} · ${esc(e.context?.source === 'catalogo' ? 'catálogo (cliente)' : 'sistema')} · v${esc(e.app_version || '?')}</span></span></div>`).join('')}</div>
      <button class="btn btn-sm btn-ghost" data-clear-diag style="margin-top:10px">${icon('trash')} Limpar</button>`;
  }

  /* ------------------------------------------------------------ ações */

  root.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('[type="submit"]');
    const val = (n) => form.querySelector(`[name="${n}"]`);
    let patch;
    if (form.matches('[data-store-form]')) {
      patch = {};
      for (const k of ['storeName', 'phone', 'instagram', 'pixKey', 'email', 'address', 'footerText']) patch[k] = val(k).value;
    } else {
      const w = {};
      form.querySelectorAll('[data-warranty]').forEach((el) => { if (el.value !== '') w[el.dataset.warranty] = Math.max(Math.trunc(Number(el.value)) || 0, 0); });
      patch = {
        warrantyDays: w,
        defaultMarkupPct: Math.min(Math.max(Number(String(val('defaultMarkupPct').value).replace(',', '.')) || 0, 0), 1000),
        allowNegativeStock: val('allowNegativeStock').checked,
      };
    }
    await withLoading(btn, async () => {
      try {
        await Data.saveSettings(patch);
        toast('Salvo');
      } catch (err) { toastError('Não foi possível salvar', friendlyError(err)); }
    });
  });

  root.addEventListener('input', (e) => {
    if (e.target.name === 'phone') e.target.value = maskPhone(e.target.value);
  });

  root.addEventListener('click', async (e) => {
    const th = e.target.closest('[data-set-theme]');
    if (th) { applyTheme(th.dataset.setTheme); render(); return; }

    if (e.target.closest('[data-logout]')) {
      const ok = await confirmDialog({ title: 'Sair da conta?', confirmText: 'Sair' });
      if (!ok) return;
      await signOut().catch(() => {});
      Data.reset();
      location.reload();
      return;
    }
    if (e.target.closest('[data-logout-all]')) {
      const ok = await confirmDialog({
        title: 'Sair de todos os aparelhos?',
        message: 'Use se perdeu o celular ou alguém viu sua senha. Todos os aparelhos (inclusive este) vão pedir login de novo.',
        confirmText: 'Sair de todos', danger: true,
      });
      if (!ok) return;
      try { await signOutEverywhere(); } catch (err) { toastError('Não foi possível', err.message); return; }
      location.reload();
      return;
    }
    if (e.target.closest('[data-password]')) { changePassword(); return; }
    if (e.target.closest('[data-backup]')) { backup(e.target.closest('[data-backup]')); return; }
    if (e.target.closest('[data-csv]')) { exportCSV(Data.orders()); return; }
    if (e.target.closest('[data-csv-items]')) { exportItems(); return; }
    if (e.target.closest('[data-csv-customers]')) { exportCustomers(); return; }
    if (e.target.closest('[data-restore]')) { restore(); return; }
    if (e.target.closest('[data-load-diag]')) {
      try { diag = await Data.listErrors(40); } catch (err) { toastError('Não consegui buscar', friendlyError(err)); diag = null; }
      root.querySelector('[data-diag]').innerHTML = diagHTML();
      return;
    }
    if (e.target.closest('[data-clear-diag]')) {
      try { await Data.clearErrors(); diag = []; root.querySelector('[data-diag]').innerHTML = diagHTML(); } catch (err) { toastError('Falhou', friendlyError(err)); }
    }
  });

  root.addEventListener('change', (e) => {
    if (e.target.matches('[data-toggle-privacy]')) {
      applyPrivacy(e.target.checked);
      toast(e.target.checked ? 'Valores ocultos' : 'Valores visíveis', { duration: 1800 });
    }
  });

  function changePassword() {
    const m = openModal({
      title: 'Trocar senha',
      sheet: true,
      body: `
        <div class="col gap-4">
          <div class="field"><label class="label" for="pw1">Nova senha</label>
            <input class="input" id="pw1" type="password" autocomplete="new-password" minlength="8" data-autofocus>
            <span class="hint">Use pelo menos 8 caracteres, com letras e números.</span></div>
          <div class="field"><label class="label" for="pw2">Repita a nova senha</label>
            <input class="input" id="pw2" type="password" autocomplete="new-password"></div>
        </div>`,
      footer: '<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Salvar senha</button>',
    });
    m.foot.querySelector('[data-ok]').addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      const a = m.panel.querySelector('#pw1').value;
      const b = m.panel.querySelector('#pw2').value;
      if (a.length < 8) { toast('A senha precisa ter ao menos 8 caracteres.', { kind: 'warn' }); return; }
      if (a !== b) { toast('As senhas não conferem.', { kind: 'warn' }); return; }
      await withLoading(btn, async () => {
        try { await updatePassword(a); toast('Senha atualizada'); m.close(); } catch (err) { toastError('Não foi possível trocar a senha', err.message); }
      });
    });
  }

  async function backup(btn) {
    await withLoading(btn, async () => {
      try {
        const payload = await Data.backupSnapshot();
        downloadFile(`backup-i7even-${todayISO()}.json`, JSON.stringify(payload, null, 2), 'application/json');
        toast(`Backup baixado: ${payload.orders.length} pedidos, ${payload.variants.length} variações, ${payload.units.length} aparelhos`);
      } catch (err) { toastError('Não consegui gerar o backup', friendlyError(err)); }
    });
  }

  function restore() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      let data;
      try { data = JSON.parse(await file.text()); } catch { toastError('Arquivo inválido', 'Não parece um backup JSON válido.'); return; }
      const list = Array.isArray(data) ? data : data.orders;
      if (!Array.isArray(list) || !list.length) { toastError('Backup vazio', 'Nenhum pedido encontrado no arquivo.'); return; }
      const ok = await confirmDialog({
        title: `Restaurar ${list.length} pedidos?`,
        message: 'Eles entram como pedidos (os itens como avulsos, sem mexer no estoque de hoje). Pedido que já foi restaurado antes não duplica.',
        confirmText: 'Restaurar',
      });
      if (!ok) return;
      try {
        const n = await Data.importOrders(list);
        toast(`${n} pedidos restaurados`);
        render();
      } catch (err) { toastError('Falhou ao restaurar', friendlyError(err)); }
    });
    input.click();
  }

  const unsub = Data.subscribe((c) => { if (c.has('settings')) render(); });
  render();
  return { refresh: render, destroy: unsub };
}
