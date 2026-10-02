/** Ajustes: aparência, conta, backup e todas as exportações de dados. */

import * as Store from '../core/store.js';
import { APP } from '../config.js';
import { signOut, updatePassword, getUser } from '../core/supabase.js';
import { getTheme, applyTheme, isPrivacy, applyPrivacy } from './theme.js';
import { toast, toastError, confirmDialog, openModal, withLoading } from './kit.js';
import { exportCSV } from './orders.js';
import { exportCustomers } from './customers.js';
import { exportItems } from './reports.js';
import { icon } from './icons.js';
import { esc, money, downloadFile, formatDateTime, todayISO } from '../core/utils.js';

export function mount(host) {
  host.innerHTML = '<div class="view" data-root></div>';
  const root = host.querySelector('[data-root]');
  // Busca o usuário uma vez por visita à tela. Antes cada toque (ex.: trocar
  // o tema) esperava uma ida ao servidor antes de redesenhar.
  const userReq = getUser().catch(() => null);

  async function render() {
    const user = await userReq;
    const orders = Store.all();
    const revenue = orders.filter((o) => o.status !== 'cancelado').reduce((a, o) => a + o.total, 0);

    root.innerHTML = `
      <div class="section-head"><h2>Ajustes</h2></div>

      <div class="card">
        <div class="card-head"><h3>Aparência</h3></div>
        <div class="card-body col gap-5">
          <div class="row-between wrap gap-3">
            <div>
              <div class="strong">Tema</div>
              <div class="small dim">“Automático” acompanha o sistema do aparelho.</div>
            </div>
            <div class="segmented" role="group" aria-label="Tema">
              ${[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Escuro']].map(([k, label]) => `
                <button type="button" data-theme="${k}" aria-pressed="${getTheme() === k}">${label}</button>`).join('')}
            </div>
          </div>

          <div class="row-between wrap gap-3">
            <div>
              <div class="strong">Modo privacidade</div>
              <div class="small dim">Borra todos os valores em R$ na tela. Passe o mouse para revelar.</div>
            </div>
            <label class="switch">
              <input type="checkbox" data-privacy ${isPrivacy() ? 'checked' : ''}>
              <span class="track"><span class="thumb"></span></span>
            </label>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Conta</h3></div>
        <div class="card-body col gap-4">
          <div class="row gap-3">
            <span class="avatar">${icon('lock')}</span>
            <div class="grow truncate">
              <div class="strong truncate">${esc(user?.email || '-')}</div>
              <div class="small dim">Entrou em ${esc(user?.last_sign_in_at ? formatDateTime(user.last_sign_in_at) : '-')}</div>
            </div>
          </div>
          <div class="row gap-2 wrap">
            <button class="btn" data-password>${icon('lock')} Trocar senha</button>
            <button class="btn btn-danger" data-logout>${icon('logout')} Sair</button>
          </div>
          ${APP.idleLogoutMinutes
            ? `<p class="hint">O sistema desconecta sozinho depois de ${APP.idleLogoutMinutes} minutos sem uso.</p>`
            : ''}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Seus dados</h3></div>
        <div class="card-body col gap-4">
          <div class="grid grid-3">
            <div><div class="small dim">Pedidos</div><div class="kpi-value sm">${orders.length}</div></div>
            <div><div class="small dim">Clientes</div><div class="kpi-value sm">${Store.customers().length}</div></div>
            <div><div class="small dim">Faturamento total</div>
                 <div class="kpi-value sm money-sensitive">${esc(money(revenue))}</div></div>
          </div>
          <div>
            <div class="strong">Exportar planilhas (CSV)</div>
            <div class="small dim">Abre no Excel ou no Google Planilhas.</div>
          </div>
          <div class="row gap-2 wrap">
            <button class="btn" data-csv>${icon('download')} Pedidos</button>
            <button class="btn" data-csv-items>${icon('download')} Itens vendidos</button>
            <button class="btn" data-csv-customers>${icon('download')} Clientes</button>
          </div>

          <div>
            <div class="strong">Backup completo</div>
            <div class="small dim">O backup JSON guarda tudo, inclusive os itens de cada pedido. Guarde uma cópia
              fora do computador de vez em quando - é o seu seguro contra qualquer imprevisto.</div>
          </div>
          <div class="row gap-2 wrap">
            <button class="btn" data-backup>${icon('download')} Baixar backup (JSON)</button>
            <button class="btn btn-outline" data-restore>${icon('upload')} Restaurar backup</button>
          </div>
        </div>
      </div>`;
  }

  /* ------------------------------------------------------------ ações */

  root.addEventListener('click', async (e) => {
    const th = e.target.closest('[data-theme]');
    if (th) { applyTheme(th.dataset.theme); render(); return; }

    if (e.target.closest('[data-logout]')) {
      const ok = await confirmDialog({ title: 'Sair da conta?', confirmText: 'Sair' });
      if (!ok) return;
      await signOut();
      Store.reset();
      location.reload();
      return;
    }

    if (e.target.closest('[data-password]')) { changePassword(); return; }
    if (e.target.closest('[data-backup]')) { backup(); return; }
    if (e.target.closest('[data-csv]')) { exportCSV(Store.all()); return; }
    if (e.target.closest('[data-csv-items]')) { exportItems(); return; }
    if (e.target.closest('[data-csv-customers]')) { exportCustomers(); return; }
    if (e.target.closest('[data-restore]')) { restore(); return; }
  });

  root.addEventListener('change', (e) => {
    if (e.target.matches('[data-privacy]')) {
      applyPrivacy(e.target.checked);
      toast(e.target.checked ? 'Valores ocultos' : 'Valores visíveis', { duration: 1800 });
    }
  });

  /* ---------------------------------------------------------- senha -- */

  function changePassword() {
    const m = openModal({
      title: 'Trocar senha',
      body: `
        <div class="col gap-4">
          <div class="field">
            <label class="label" for="pw1">Nova senha</label>
            <input class="input" id="pw1" type="password" autocomplete="new-password" minlength="8" data-autofocus>
            <span class="hint">Use pelo menos 8 caracteres, com letras e números.</span>
          </div>
          <div class="field">
            <label class="label" for="pw2">Repita a nova senha</label>
            <input class="input" id="pw2" type="password" autocomplete="new-password">
          </div>
        </div>`,
      footer: `<button class="btn" data-close>Cancelar</button>
               <button class="btn btn-primary" data-ok>Salvar senha</button>`,
    });
    m.foot.querySelector('[data-ok]').addEventListener('click', async (ev) => {
      const a = m.panel.querySelector('#pw1').value;
      const b = m.panel.querySelector('#pw2').value;
      if (a.length < 8) { toast('A senha precisa ter ao menos 8 caracteres.', { kind: 'warn' }); return; }
      if (a !== b) { toast('As senhas não conferem.', { kind: 'warn' }); return; }
      await withLoading(ev.currentTarget, async () => {
        try {
          await updatePassword(a);
          toast('Senha atualizada');
          m.close();
        } catch (err) { toastError('Não foi possível trocar a senha', err.message); }
      });
    });
  }

  /* --------------------------------------------------------- backup -- */

  function backup() {
    const payload = {
      app: 'i7even-pedidos',
      version: 1,
      exportedAt: new Date().toISOString(),
      orders: Store.all(),
    };
    downloadFile(
      `backup-i7even-${todayISO()}.json`,
      JSON.stringify(payload, null, 2),
      'application/json',
    );
    toast(`Backup com ${payload.orders.length} pedidos baixado`);
  }

  function restore() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch {
        toastError('Arquivo inválido', 'Não parece um backup JSON válido.');
        return;
      }
      const list = Array.isArray(data) ? data : data.orders;
      if (!Array.isArray(list) || !list.length) {
        toastError('Backup vazio', 'Nenhum pedido encontrado no arquivo.');
        return;
      }
      const mode = await confirmDialog({
        title: `Restaurar ${list.length} pedidos?`,
        message: 'Eles serão ADICIONADOS aos pedidos que já existem. Se quiser substituir tudo, apague os atuais antes.',
        confirmText: 'Adicionar ao banco',
      });
      if (!mode) return;
      try {
        const n = await Store.importOrders(list);
        toast(`${n} pedidos restaurados`);
        render();
      } catch (err) {
        toastError('Falhou ao restaurar', err.message);
      }
    });
    input.click();
  }

  render();
  return { refresh: render, destroy() {} };
}
