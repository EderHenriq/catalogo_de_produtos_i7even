/**
 * Leitor da lista de encomenda que o fornecedor manda no WhatsApp.
 *
 * Entra o texto colado; sai uma linha por oferta reconhecida:
 *   { line, product, storage, color, size, condition, price, currency, issues[] }
 * e a lista do que não deu para entender (para a pessoa corrigir ou ignorar).
 *
 * Puro (sem tela, sem banco) e coberto por tests/unit/order-list.test.mjs com
 * mensagens no formato real dos fornecedores. Regras:
 *   - título sem preço ("📱 IPHONE 15 PRO MAX", "*SEMINOVOS*") vale para as
 *     linhas de baixo, até o próximo título;
 *   - modelo na própria linha vence o título; "15 pro max", "15pm", "ip 15
 *     promax" e "iPhone 15 Pro Max" são o mesmo modelo;
 *   - capacidade: "256GB", "256 gb", "256g", "1TB", "1 tera" ou o número solto
 *     (64/128/256/512) quando ele é uma opção do modelo;
 *   - cor: pelas cores do modelo, sem acento, por pedaço ("natural" acha
 *     "Titânio natural", "meia noite" acha "Meia-noite"); várias cores na
 *     mesma linha ("azul/preto") viram uma oferta para cada;
 *   - preço: "R$ 6.200,00", "6.200", "6200", "6,2k", "$ 650" / "650 usd"
 *     (US$); o último valor plausível da linha (≥ 50) é o preço;
 *   - condição: lacrado/novo, seminovo/semi/usado/swap, vitrine, cpo/
 *     recondicionado - na linha ou no título; sem nada, a condição padrão.
 */

export const CONDITION_WORDS = [
  [/\b(semi\s*-?\s*novos?|seminovos?|semi|usados?|swap)\b/, 'Seminovo'],
  [/\bvitrine\b/, 'Vitrine'],
  [/\b(cpo|recondicionados?|refurb\w*)\b/, 'CPO / Recondicionado'],
  [/\b(caixa\s+aberta|open\s*box)\b/, 'Novo (caixa aberta)'],
  [/\b(lacrados?|novos?|zero|lacre)\b/, 'Lacrado'],
];

const STORAGE_NUMS = [16, 32, 64, 128, 256, 512];

/** Minúsculas, sem acento, sem emoji, sem * _ ~ do WhatsApp. */
export function norm(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, ' ')
    .replace(/[*_~`]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/* ------------------------------------------------------------ modelos -- */

const OTHER_APPLE = /\b(ipad|macbook|mac\s*mini|imac|mac\s*studio|watch|airpods|ps5|ps4|playstation|xbox|switch|nintendo|pencil|perfume|capa|case|pelicula|carregador|cabo|fonte|magsafe|airtag)\b/;

/** Chave curta do modelo: "iphone 15 pro max" → "iphone|15|promax". */
function iphoneKey(text) {
  const t = ` ${norm(text)} `.replace(/i\s*phone/g, 'iphone').replace(/\bip\s*(?=\d)/g, 'iphone ');
  // "15pm", "15 promax", "15 pro max", "15 plus", "15+", "16e", "17 air"
  // Outro produto da Apple na linha ("iPad Air 11", "Watch Series 11"): o
  // número é dele, não de um iPhone - a não ser que a palavra iPhone apareça.
  if (OTHER_APPLE.test(t) && !/iphone/.test(t)) return null;
  const m = /(?:iphone\s*)?\b(1[1-9]|[2-9]?\d)\s*(pro\s*max|promax|p\s*max|pm|pro|plus|\+|mini|air|e)?(?=[\s,.\-:/|)]|$)/.exec(t);
  const validNum = m && Number(m[1]) >= 6 && Number(m[1]) <= 30;
  // iPhone Air: o único sem número no nome. "Air" sozinho (ou "17 Air") é ele.
  const air = /\bair\b/.exec(t);
  if (air && (!validNum || m.index > air.index)) {
    return { key: 'iphone|air|', explicit: /iphone/.test(t), index: air.index, length: air[0].length };
  }
  if (!m) return null;
  const n = Number(m[1]);
  if (n < 6 || n > 30) return null;
  const hasWord = /iphone/.test(t);
  let suf = (m[2] || '').replace(/\s+/g, '');
  if (['pm', 'pmax', 'promax'].includes(suf)) suf = 'promax';
  if (suf === '+') suf = 'plus';
  return { key: `iphone|${n}|${suf}`, explicit: hasWord, index: m.index, length: m[0].length };
}

function productKey(p) {
  const n = norm(p.name);
  if (/^iphone\b/.test(n)) {
    const k = iphoneKey(n);
    return k ? k.key : null;
  }
  return null;
}

/** Palavras que identificam um modelo que não é iPhone (ex.: "watch", "series", "10"). */
function tokens(s) {
  return norm(s).replace(/[()ªº°]/g, ' ').split(/[\s/\-,.]+/).filter((w) => w && !['de', 'da', 'do', 'com', 'e', 'apple', 'gen', 'ger'].includes(w));
}

/**
 * Índice dos modelos do cadastro para casar com o texto da lista.
 * @param {{id:string, name:string, storages?:string[], colors?:string[], sizes?:string[], categoryName?:string}[]} products
 */
export function buildIndex(products) {
  const byKey = new Map();
  const others = [];
  for (const p of products) {
    const k = productKey(p);
    if (k) { if (!byKey.has(k)) byKey.set(k, p); } else others.push({ p, toks: tokens(p.name) });
  }
  return { byKey, others, all: products };
}

/** Acha o modelo citado no texto (ou null). */
export function matchProduct(text, index) {
  const ik = iphoneKey(text);
  if (ik) {
    // "17 Air" quando só existe o "iPhone Air" (sem número) no cadastro
    const p = index.byKey.get(ik.key) || (ik.key.endsWith('|air') ? index.byKey.get('iphone|air|') : null);
    // "15 pro max" sem a palavra iPhone só vale se o modelo existir (evita
    // confundir "128" ou o preço com um número de modelo).
    if (p) return { product: p, at: ik.index, len: ik.length };
  }
  const lineToks = new Set(tokens(text));
  let best = null;
  for (const { p, toks } of index.others) {
    if (!toks.length) continue;
    const hit = toks.filter((w) => lineToks.has(w)).length;
    const nums = toks.filter((w) => /\d/.test(w));
    if (nums.some((w) => !lineToks.has(w))) continue;       // número do modelo tem que estar lá
    const score = hit / toks.length;
    if (score >= 0.6 && (!best || score > best.score || (score === best.score && toks.length > best.toks.length))) best = { p, score, toks };
  }
  return best ? { product: best.p, at: -1, len: 0 } : null;
}

/* ------------------------------------------------------ capacidade/cor -- */

function matchStorage(text, product) {
  const t = norm(text);
  const opts = product?.storages || [];
  const pick = (val) => opts.find((o) => norm(o).replace(/\s/g, '') === val) || val.toUpperCase();
  let m = /\b(\d)\s*(tb|tera)\b/.exec(t);
  if (m) return { value: pick(`${m[1]}tb`), raw: m[0] };
  m = /\b(16|32|64|128|256|512)\s*(gb|g|giga)\b/.exec(t);
  if (m) return { value: pick(`${m[1]}gb`), raw: m[0] };
  // número solto que é opção do modelo (fornecedor escreve "15 pro 256 azul 6.200")
  for (const n of STORAGE_NUMS) {
    const re = new RegExp(`(^|[\\s/,(-])${n}(?=[\\s/,)-]|$)`);
    const mm = re.exec(t);
    if (mm && opts.some((o) => norm(o).replace(/\s/g, '') === `${n}gb`)) return { value: pick(`${n}gb`), raw: String(n) };
  }
  // opção escrita por extenso (AirPods "USB-C", PS5 "Digital", Watch "GPS + Cellular")
  const words = (s) => ` ${norm(s).replace(/\(.*?\)/g, ' ').replace(/usb\s*-?\s*c/g, 'usbc').replace(/[^a-z0-9]+/g, ' ').trim()} `;
  const tt = words(text).replace(/ (celular|lte|4g|5g) /g, ' cellular ');
  const textual = opts
    .map((o) => ({ o, w: words(o).trim().split(' ').filter((x) => x && !['com', 'de', 'sem', 'ruido'].includes(x)) }))
    .filter((x) => x.w.length && !/^\d+(gb|tb)$/.test(x.w.join('')))
    .sort((a, b) => b.w.length - a.w.length);
  for (const { o, w } of textual) if (w.every((x) => tt.includes(` ${x} `))) return { value: o, raw: '' };
  return null;
}

/** Tamanho da caixa (Watch "46mm") entre as opções do modelo. */
function matchSize(text, product) {
  const opts = product?.sizes || [];
  if (!opts.length) return '';
  if (opts.length === 1) return opts[0];
  const t = norm(text).replace(/\s+mm\b/g, 'mm');
  return opts.find((o) => t.includes(norm(o).replace(/\s+/g, ''))) || '';
}

/** Linha de outra marca (ou iPhone que o cadastro não tem): não herda o modelo do título. */
const OTHER_BRAND = /\b(galaxy|samsung|xiaomi|redmi|poco|motorola|realme|pixel|huawei|infinix|asus|nokia|oppo|vivo|honor|oneplus)\b/;

/** Palavras de cor que não ajudam a distinguir ("titanio" está em todas as Pro). */
const COLOR_FILLER = new Set(['titanio', 'de', 'da', 'do', 'cor']);
const COLOR_ALIAS = [
  [/\bmidnight\b/, 'meia noite'], [/\bstarlight\b/, 'estelar'], [/\bspace\s*gr[ae]y\b/, 'cinza espacial'],
  [/\bspace\s*black\b/, 'preto espacial'], [/\bgold\b/, 'dourado'], [/\bsilver\b/, 'prateado'], [/\bblack\b/, 'preto'],
  [/\bwhite\b/, 'branco'], [/\bblue\b/, 'azul'], [/\bgreen\b/, 'verde'], [/\bpink\b/, 'rosa'], [/\bpurple\b/, 'roxo'],
  [/\byellow\b/, 'amarelo'], [/\bred\b/, 'red'], [/\bdesert\b/, 'deserto'], [/\borange\b/, 'laranja'], [/\bgraphite\b/, 'grafite'],
];

function colorWords(c) {
  return norm(c).replace(/[()-]/g, ' ').split(/\s+/).filter((w) => w && !COLOR_FILLER.has(w));
}

/** Todas as cores do modelo citadas no texto (mais específica primeiro, sem repetir). */
function matchColors(text, product) {
  let t = ` ${norm(text).replace(/-/g, ' ')} `;
  for (const [re, to] of COLOR_ALIAS) t = t.replace(re, to);
  const opts = [...(product?.colors || [])];
  const found = [];
  const ranked = opts.map((c) => ({ c, w: colorWords(c) })).filter((x) => x.w.length).sort((a, b) => b.w.length - a.w.length);
  let rest = t;
  for (const { c, w } of ranked) {
    const re = new RegExp(`\\b${w.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')}\\b`);
    if (re.test(rest)) { found.push(c); rest = rest.replace(re, ' '); }
  }
  // Segunda passada: só a palavra principal ("laranja" → "Laranja-cósmico",
  // "roxo" → "Roxo-profundo"), quando ela não é de duas cores do modelo.
  const main = new Map();
  for (const { c, w } of ranked) main.set(w[0], main.has(w[0]) ? null : c);
  for (const [word, c] of main) {
    if (!c || found.includes(c)) continue;
    if (new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(rest)) { found.push(c); rest = rest.replace(word, ' '); }
  }
  // na ordem em que aparecem na linha (a pessoa lê assim na prévia)
  const pos = (c) => { const i = t.indexOf(colorWords(c)[0]); return i < 0 ? 999 : i; };
  return found.sort((a, b) => pos(a) - pos(b));
}

function matchCondition(text) {
  const t = norm(text);
  for (const [re, cond] of CONDITION_WORDS) if (re.test(t)) return cond;
  return null;
}

/* -------------------------------------------------------------- preço -- */

/**
 * Valores em dinheiro da linha. Devolve o último plausível (≥ 50) e a moeda.
 * Não confunde com capacidade ("256gb") nem com o número do modelo.
 */
export function matchPrice(text, { skip = [] } = {}) {
  let t = ` ${String(text).toLowerCase()} `;
  for (const s of skip) {
    if (!s) continue;
    // só o número inteiro ("256" não pode comer parte de "1256")
    const esc = s.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(`(^|[^\\d])${esc}(?![\\d])`), '$1 ');
  }
  const usd = /(u\$|us\$|usd|dolar|dólar|\$\s*\d)/.test(t) && !/r\$/.test(t);
  t = t.replace(/(\d)\s*k\b/g, (m, d) => `${d}k`);
  const re = /(?:r\$|u\$|us\$|\$)?\s*(\d{1,3}(?:[.\s]\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(k)?/g;
  const vals = [];
  let m;
  while ((m = re.exec(t))) {
    let raw = m[1];
    let v;
    if (m[2]) {
      v = Number(raw.replace(',', '.')) * 1000;                 // 6,2k / 6.2k / 6k
    } else if (/^\d{1,3}([.\s]\d{3})+(,\d{1,2})?$/.test(raw)) {
      v = Number(raw.replace(/[.\s]/g, '').replace(',', '.'));  // 6.200 / 6.200,00 / 6 200
    } else if (/^\d+,\d{1,2}$/.test(raw)) {
      v = Number(raw.replace(',', '.'));                        // 650,50
    } else if (/^\d+\.\d{1,2}$/.test(raw)) {
      v = Number(raw);                                          // 650.50 (lista em dólar)
    } else {
      v = Number(raw);
    }
    // logo antes de "gb"/"tb"/"mm" é capacidade/tamanho, não preço
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 4);
    if (/^\s*(gb|g\b|tb|tera|mm|%)/.test(after)) continue;
    if (Number.isFinite(v) && v >= 50 && v < 300000) vals.push(v);
  }
  if (!vals.length) return null;
  return { value: Math.round(vals[vals.length - 1] * 100) / 100, currency: usd ? 'USD' : 'BRL' };
}

/* -------------------------------------------------------------- leitor -- */

/**
 * Lê a mensagem colada.
 * @param {string} text
 * @param {{products: object[], defaultCondition?: string}} opts
 * @returns {{ rows: object[], unknown: {line:string, reason:string}[] }}
 */
export function parseOrderList(text, { products = [], defaultCondition = 'Lacrado' } = {}) {
  const index = buildIndex(products);
  const rows = [];
  const unknown = [];
  let ctxProduct = null;
  let ctxCondition = null;
  let ctxStorage = null;

  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const n = norm(line);
    if (!n || /^[-=_.•·\s]+$/.test(n)) continue;

    // telefone/contato no rodapé não é preço
    if (/\(?\b\d{2}\)?\s?9\d{4}[-\s]?\d{4}\b/.test(line) && !matchProduct(line, index)) continue;

    const mp = matchProduct(line, index);
    const cond = matchCondition(line);
    const storagePre = matchStorage(line, mp?.product || ctxProduct);
    const price = matchPrice(line, { skip: [storagePre?.raw] });

    if (!price) {
      // título: muda o contexto das linhas de baixo
      if (mp) { ctxProduct = mp.product; ctxStorage = matchStorage(line, mp.product)?.value || null; }
      if (cond) ctxCondition = cond;
      if (!mp && !cond) {
        const st = matchStorage(line, ctxProduct);
        if (st && ctxProduct) ctxStorage = st.value;
        else if (!/^(bom dia|boa tarde|boa noite|ola|oi|segue|lista|valores|precos|tabela|atualiz|cores?\b|disponiveis|estoque|garantia|pix|frete|envio|chama|chame|whats)/.test(n)) {
          // linha sem preço e sem modelo: anúncio/saudação - só registra se parece produto
          if (/\d/.test(n) && n.length > 3) unknown.push({ line, reason: 'Sem preço e sem modelo reconhecido' });
        }
      }
      continue;
    }

    if (!mp && (OTHER_BRAND.test(n) || /\biphone\b/.test(n))) {
      unknown.push({ line, reason: OTHER_BRAND.test(n) ? 'Outra marca (não está no cadastro)' : 'Modelo de iPhone não encontrado no cadastro' });
      continue;
    }
    const product = mp?.product || ctxProduct;
    if (mp) ctxProduct = mp.product;
    if (!product) { unknown.push({ line, reason: 'Modelo não reconhecido' }); continue; }

    const storage = matchStorage(line, product)?.value || (mp ? null : ctxStorage) || (product.storages?.length === 1 ? product.storages[0] : '');
    let colors = matchColors(line, product);
    const issues = [];
    if (!storage && product.storages?.length > 1) issues.push('capacidade');
    if (!colors.length) {
      if (product.colors?.length === 1) colors = [product.colors[0]];
      else { colors = ['']; if (product.colors?.length) issues.push('cor'); }
    }
    const condition = cond || ctxCondition || defaultCondition;
    for (const color of colors) {
      rows.push({
        line,
        product,
        storage: storage || '',
        color,
        size: matchSize(line, product),
        condition,
        price: price.value,
        currency: price.currency,
        issues: [...issues],
      });
    }
  }
  return { rows, unknown };
}

/* --------------------------------------------------------- preço final -- */

/**
 * Preço de venda a partir do valor da lista.
 *   mode 'venda': a lista já é o preço de venda (só converte a moeda);
 *   mode 'pct':   custo + value% ;   mode 'add': custo + R$ value.
 *   round: 'none' | '10' (sobe para dezena) | '90' (termina em 90) | '50'.
 */
export function salePrice(listValue, { currency = 'BRL', rate = 1, mode = 'venda', value = 0, round = 'none' } = {}) {
  const brl = (Number(listValue) || 0) * (currency === 'USD' ? (Number(rate) || 0) : 1);
  let v = brl;
  if (mode === 'pct') v = brl * (1 + (Number(value) || 0) / 100);
  if (mode === 'add') v = brl + (Number(value) || 0);
  if (v <= 0) return 0;
  if (round === '10') v = Math.ceil(v / 10) * 10;
  if (round === '50') v = Math.ceil(v / 50) * 50;
  if (round === '90') v = Math.ceil((v + 10) / 100) * 100 - 10;
  return Math.round(v * 100) / 100;
}

/** Custo em R$ do valor da lista (para o lucro do pedido de encomenda). */
export function listCost(listValue, { currency = 'BRL', rate = 1, mode = 'venda' } = {}) {
  if (mode === 'venda') return 0;   // a lista era preço de venda: custo desconhecido
  return Math.round((Number(listValue) || 0) * (currency === 'USD' ? (Number(rate) || 0) : 1) * 10000) / 10000;
}
