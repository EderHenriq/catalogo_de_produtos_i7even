/** Telas de entrada: configuração inicial do Supabase e login. */

import { saveConfig, presetUrl, APP } from '../config.js';
import { signIn, sendPasswordReset, resetClient } from '../core/supabase.js';
import { toast, toastError } from './kit.js';
import { icon } from './icons.js';
import { esc } from '../core/utils.js';

function shell(inner, wide = false) {
  return `
    <div class="gate">
      <div class="gate-card${wide ? ' wide' : ''}">
        <div class="gate-brand">
          <div class="brand-mark" role="img" aria-label="${esc(APP.name)}"></div>
          <div>
            <span class="brand-wordmark" role="img" aria-label="${esc(APP.name)}"></span>
            <p>${esc(APP.subtitle)}</p>
          </div>
        </div>
        ${inner}
      </div>
    </div>`;
}

/* ------------------------------------------------------- configuração */

/** Primeira execução: pede URL e chave anon do projeto Supabase. */
export function renderSetup(host, { onDone }) {
  host.innerHTML = shell(`
    <form class="gate-form" data-form novalidate>
      <div class="alert" data-kind="info">
        ${icon('info')}
        <div>Cole os dois dados do seu projeto Supabase: <b>Project Settings → API</b>.
        Use a chave <b>anon / public</b> - nunca a <i>service_role</i>.</div>
      </div>
      <div class="field">
        <label class="label" for="url">URL do projeto</label>
        <input class="input" id="url" name="url" placeholder="https://seuprojeto.supabase.co"
               value="${esc(presetUrl())}" autocomplete="off" spellcheck="false" required>
      </div>
      <div class="field">
        <label class="label" for="key">Chave anon / public</label>
        <textarea class="textarea" id="key" name="key" rows="3" placeholder="eyJhbGciOi..."
                  autocomplete="off" spellcheck="false" required data-autofocus></textarea>
      </div>
      <div class="alert hide" data-error data-kind="error">${icon('alert')}<div data-error-text></div></div>
      <button class="btn btn-primary btn-lg btn-block" type="submit">Conectar</button>
    </form>
    <div class="gate-foot">
      Esses dados ficam salvos só neste navegador. Para não precisar digitar em cada
      aparelho, preencha o arquivo <code>assets/js/config.js</code> antes do deploy.
    </div>`, true);

  const form = host.querySelector('[data-form]');
  const errBox = host.querySelector('[data-error]');
  const errText = host.querySelector('[data-error-text]');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    errBox.classList.add('hide');
    try {
      saveConfig({ url: form.url.value, anonKey: form.key.value });
      resetClient();
      toast('Conectado ao Supabase');
      onDone();
    } catch (err) {
      errText.textContent = err.message;
      errBox.classList.remove('hide');
    }
  });
}

/* --------------------------------------------------------------- login */

export function renderLogin(host, { onDone }) {
  host.innerHTML = shell(`
    <form class="gate-form" data-form novalidate>
      <div class="field">
        <label class="label" for="email">E-mail</label>
        <input class="input" id="email" name="email" type="email" autocomplete="username"
               inputmode="email" autocapitalize="off" spellcheck="false"
               placeholder="voce@email.com" required data-autofocus>
        ${APP.contas?.length ? `
          <div class="chips" style="margin-top:2px">
            ${APP.contas.map((c) => `
              <button type="button" class="chip sm" data-conta="${esc(c.email)}">${esc(c.nome)}</button>`).join('')}
          </div>` : ''}
      </div>
      <div class="field">
        <label class="label" for="password">Senha</label>
        <div style="position:relative">
          <input class="input" id="password" name="password" type="password"
                 autocomplete="current-password" required style="padding-right:42px">
          <button type="button" class="icon-btn sm" data-toggle-pw aria-label="Mostrar senha"
                  style="position:absolute;right:5px;top:50%;transform:translateY(-50%)">${icon('eye')}</button>
        </div>
      </div>
      <div class="alert hide" data-error data-kind="error">${icon('alert')}<div data-error-text></div></div>
      <button class="btn btn-primary btn-lg btn-block" type="submit">Entrar</button>
      <button class="btn btn-ghost btn-sm" type="button" data-forgot>Esqueci minha senha</button>
    </form>`);

  const form = host.querySelector('[data-form]');
  const errBox = host.querySelector('[data-error]');
  const errText = host.querySelector('[data-error-text]');
  const submit = form.querySelector('[type="submit"]');

  // Atalho de conta: preenche o e-mail e manda o foco para a senha.
  host.querySelectorAll('[data-conta]').forEach((btn) => {
    btn.addEventListener('click', () => {
      form.email.value = btn.dataset.conta;
      form.password.focus();
    });
  });

  host.querySelector('[data-toggle-pw]').addEventListener('click', (e) => {
    const input = form.password;
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    e.currentTarget.innerHTML = icon(showing ? 'eye' : 'eyeOff');
    input.focus();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.classList.add('hide');
    const email = form.email.value.trim();
    const password = form.password.value;
    if (!email || !password) {
      errText.textContent = 'Preencha e-mail e senha.';
      errBox.classList.remove('hide');
      return;
    }

    submit.disabled = true;
    submit.classList.add('btn-loading');
    const label = submit.textContent;
    submit.textContent = '';
    try {
      await signIn(email, password);
      onDone();
    } catch (err) {
      errText.textContent = err.message;
      errBox.classList.remove('hide');
      form.password.value = '';
      form.password.focus();
    } finally {
      submit.disabled = false;
      submit.classList.remove('btn-loading');
      submit.textContent = label;
    }
  });

  host.querySelector('[data-forgot]').addEventListener('click', async () => {
    const email = form.email.value.trim();
    if (!email) {
      toast('Digite seu e-mail primeiro.', { kind: 'warn' });
      form.email.focus();
      return;
    }
    try {
      await sendPasswordReset(email);
      toast('Link enviado', { text: 'Confira sua caixa de entrada (e o spam).' });
    } catch (err) {
      toastError('Não foi possível enviar', err.message);
    }
  });
}

/* ---------------------------------------------------------- carregando */

export function renderBoot(host, message = 'Carregando…') {
  host.innerHTML = `
    <div class="boot">
      <div class="col gap-4" style="align-items:center">
        <div class="spinner"></div>
        <p class="small dim">${esc(message)}</p>
      </div>
    </div>`;
}
