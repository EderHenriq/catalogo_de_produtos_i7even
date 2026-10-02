/** Cliente Supabase + autenticação. */

// Versão fixa: a URL fica em cache por 1 ano no aparelho (a "@2" solta é
// revalidada toda semana) e nenhuma atualização da biblioteca muda o app
// sem aviso. Ao trocar, atualize também os modulepreload do index.html.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
import { getConfig } from '../config.js';

let client = null;

export function getClient() {
  if (client) return client;
  const cfg = getConfig();
  if (!cfg) throw new Error('Supabase não configurado.');
  client = createClient(cfg.url, cfg.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false, // login é só e-mail + senha; nada de token na URL
      storageKey: 'i7even.auth',
      flowType: 'pkce',
    },
    global: {
      headers: { 'x-client-info': 'i7even-pedidos/1.0' },
    },
  });
  return client;
}

export function resetClient() {
  client = null;
}

/* ------------------------------------------------------------- sessão --- */

export async function getSession() {
  const { data, error } = await getClient().auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getUser() {
  const { data } = await getClient().auth.getUser();
  return data?.user ?? null;
}

export function onAuthChange(callback) {
  const { data } = getClient().auth.onAuthStateChange((event, session) => callback(event, session));
  return () => data.subscription.unsubscribe();
}

export async function signIn(email, password) {
  const { data, error } = await getClient().auth.signInWithPassword({
    email: String(email).trim().toLowerCase(),
    password,
  });
  if (error) throw new Error(friendlyAuthError(error));
  return data.session;
}

export async function signOut() {
  await getClient().auth.signOut();
}

export async function sendPasswordReset(email) {
  const { error } = await getClient().auth.resetPasswordForEmail(String(email).trim().toLowerCase(), {
    redirectTo: `${location.origin}${location.pathname}`,
  });
  if (error) throw new Error(friendlyAuthError(error));
}

export async function updatePassword(newPassword) {
  const { error } = await getClient().auth.updateUser({ password: newPassword });
  if (error) throw new Error(friendlyAuthError(error));
}

/** Traduz as mensagens do Supabase, que vêm em inglês. */
export function friendlyAuthError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  if (msg.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (msg.includes('email not confirmed')) return 'Confirme seu e-mail antes de entrar.';
  if (msg.includes('rate limit') || msg.includes('too many')) {
    return 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';
  }
  if (msg.includes('password should be at least')) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (msg.includes('failed to fetch') || msg.includes('networkerror')) {
    return 'Sem conexão com o servidor. Verifique a internet e a URL do projeto.';
  }
  if (msg.includes('signups not allowed')) return 'Cadastro desativado. Crie o usuário pelo painel do Supabase.';
  return error?.message || 'Não foi possível concluir a operação.';
}
