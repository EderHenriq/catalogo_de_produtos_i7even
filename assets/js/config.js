/**
 * Configuração da conexão com o Supabase.
 *
 * ┌─ É SEGURO estas duas linhas ficarem no repositório e no HTML público? ─┐
 * │ SIM. A "anon key" do Supabase é feita para ficar no navegador. Quem    │
 * │ protege os dados é o RLS (Row Level Security) ativado no banco:        │
 * │ sem estar logado, a chave não devolve nenhuma linha.                   │
 * │ O que NUNCA pode aparecer aqui é a `service_role key`.                 │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Preencha abaixo (Supabase → Project Settings → API) ou deixe vazio e o
 * próprio sistema pede os dados na primeira abertura.
 */

const HARDCODED = {
  url: 'https://vsfrnhynhzhpzeymavtx.supabase.co',
  // Chave "publishable" - feita para ficar no navegador. Sozinha ela não lê
  // nada: quem libera as linhas é o login + o RLS da tabela.
  anonKey: 'sb_publishable__GLUx1HnUtWOQSL3H9iGHA_yBneT7Gh',
};

const STORAGE_KEY = 'i7even.config';

function fromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function getConfig() {
  if (HARDCODED.url && HARDCODED.anonKey) return { ...HARDCODED, source: 'arquivo' };

  // Parcialmente preenchido: a URL vem do arquivo, a chave de quem digitou aqui.
  const stored = fromStorage();
  const url = HARDCODED.url || stored?.url;
  const anonKey = stored?.anonKey;
  if (url && anonKey) {
    return { url, anonKey, source: HARDCODED.url ? 'arquivo + navegador' : 'navegador' };
  }
  return null;
}

/** URL já definida no arquivo - a tela de configuração só pede a chave. */
export function presetUrl() {
  return HARDCODED.url || '';
}

export function saveConfig({ url, anonKey }) {
  const clean = { url: String(url).trim().replace(/\/+$/, ''), anonKey: String(anonKey).trim() };
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(clean.url)) {
    throw new Error('A URL deve ser parecida com https://seuprojeto.supabase.co');
  }
  if (clean.anonKey.length < 30) {
    throw new Error('A chave anon parece incompleta.');
  }
  if (/service_role/i.test(clean.anonKey)) {
    throw new Error('Essa é a service_role key - nunca use no navegador. Use a chave "anon / public".');
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  return clean;
}

export function clearConfig() {
  localStorage.removeItem(STORAGE_KEY);
}

/** Configurações de comportamento do app (não são segredos). */
export const APP = {
  name: 'i7even Store',
  subtitle: 'Controle de pedidos',

  /**
   * Atalhos de e-mail na tela de login - poupa digitação no celular.
   * Só o e-mail; senha nunca fica no código.
   * Estes e-mails ficam visíveis no código público do site. Se preferir
   * que não apareçam, troque por uma lista vazia: `contas: []`.
   */
  contas: [
    { email: 'eder.pontes2014@gmail.com', nome: 'Eder' },
    { email: 'juluccas1609@gmail.com', nome: 'Julie' },
  ],
  /** Minutos de inatividade até deslogar automaticamente. 0 = desativado. */
  idleLogoutMinutes: 30,
  /** Quantos pedidos carregar por página na listagem. */
  pageSize: 50,
  /** Dias sem movimentação para marcar um pedido aberto como "parado". */
  staleDays: 5,
  /** Bucket do Supabase Storage para as fotos dos produtos (criado pelo schema.sql). */
  photoBucket: 'produtos',
  /** Versão do app (aparece em Ajustes e nos erros do Diagnóstico). */
  version: '2.0.0',
  /**
   * Versão do banco que este app precisa (whoami().schema_version). Banco
   * mais antigo = tela "rode o supabase/schema.sql" em vez de erro escondido.
   * Subiu no schema.sql? Suba aqui junto.
   */
  schemaVersion: 2,
};
