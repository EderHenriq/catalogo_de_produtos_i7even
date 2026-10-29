/**
 * Pasta de fotos → plano de importação (puro: sem tela, sem banco - coberto
 * por tests/unit/photo-folder.test.mjs com a estrutura real da loja).
 *
 * A pasta segue Categoria / Modelo / Cor / fotos (a ordem: a melhor de
 * vitrine primeiro - photoScore; arquivo "00..."/"capa..." vem antes):
 *
 *   Imagens/01_iPhone/categoria.webp                   → foto da CATEGORIA
 *   Imagens/01_iPhone/iPhone 11/capa.webp               → capa do MODELO
 *   Imagens/01_iPhone/iPhone 11/Preto/foto1.webp        → fotos da COR
 *
 * "categoria*" ou "capa*" dentro da pasta do modelo também vira a capa dele.
 * O número na frente da categoria ("01_") é só para ordenar. Os nomes não
 * precisam ser idênticos ao cadastro: "Apple Watch SE (2a ger)" acha
 * "Apple Watch SE (2ª ger.)", "MacBook Pro 14 M1 Pro-Max" acha
 * 'MacBook Pro 14" M1 Pro/Max', "Azul" acha "Titânio azul".
 */

const IMG = /\.(webp|jpe?g|png|avif)$/i;
const COVER = /^(categoria|capa|cover)\b/i;
const STOP = new Set(['de', 'da', 'do', 'e', 'apple', 'ger', 'geracao', 'modelo', 'antigo', 'com', 'the']);

/** minúsculas, sem acento, "2ª" → "2a", só letras e números */
export function normName(s) {
  return String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[ªº]/g, 'a').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function tokensOf(s) {
  return [...new Set(normName(s).split(' ').filter((w) => w && !STOP.has(w)))];
}

const stripOrder = (folder) => String(folder).replace(/^\s*\d+\s*[_\-.\s]\s*/, '');

/** Pasta de categoria ("01_iPhone", "08_Acessorios") → categoria do cadastro. */
export function matchCategory(folder, categories) {
  const f = normName(stripOrder(folder));
  if (!f) return null;
  return categories.find((c) => normName(c.name) === f || normName(c.slug) === f)
    || categories.find((c) => { const n = normName(c.name); return n && (n.startsWith(f) || f.startsWith(n)); })
    || null;
}

/** Pasta do modelo → modelo do cadastro (mesmos números; ≥ 75% das palavras). */
export function matchModel(folder, products) {
  const ft = tokensOf(folder);
  if (!ft.length) return null;
  const nums = (ts) => ts.filter((t) => /\d/.test(t)).sort().join('|');
  let best = null;
  for (const p of products) {
    const pt = tokensOf(p.name);
    if (!pt.length || nums(pt) !== nums(ft)) continue;
    const inter = ft.filter((t) => pt.includes(t)).length;
    const score = inter / Math.max(ft.length, pt.length);
    if (score >= 0.75 && (!best || score > best.score || (score === best.score && p.name.length < best.p.name.length))) best = { p, score };
  }
  return best?.p || null;
}

/** Pasta da cor → cor do modelo; sem par, a cor é nova (nome da pasta). */
export function matchColor(folder, colors = []) {
  const f = normName(folder);
  const list = colors.filter(Boolean);
  const exact = list.find((c) => normName(c) === f);
  if (exact) return { color: exact, isNew: false };
  const words = (c) => normName(c).split(' ').filter((w) => w !== 'titanio');
  const part = list.find((c) => words(c).join(' ') === f) || list.find((c) => words(c).includes(f))
    || list.find((c) => f.split(' ').includes(words(c)[0]) && words(c).length === 1);
  if (part) return { color: part, isNew: false };
  // modelo de uma cor só e a pasta chama "Padrão"/"Único": é a cor dele
  if (list.length === 1 && /^(padrao|unico|unica|default|normal)$/.test(f)) return { color: list[0], isNew: false };
  const pretty = String(folder).trim();
  return { color: pretty.charAt(0).toUpperCase() + pretty.slice(1), isNew: true };
}

/**
 * @param {{path: string, file?: any, size?: number}[]} files  caminhos relativos ("Imagens/01_iPhone/...")
 * @param {{categories: object[], products: object[]}} db
 * @returns {{categories: object[], models: object[], skipped: {path:string, reason:string}[]}}
 */
export function planFolder(files, { categories = [], products = [] } = {}) {
  const cats = new Map();     // catFolder → { folder, category, cover }
  const models = new Map();   // catFolder|modelFolder → plano do modelo
  const skipped = [];
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path, 'pt-BR', { numeric: true }));

  for (const f of sorted) {
    const parts = f.path.split(/[\\/]/).filter(Boolean);
    const name = parts[parts.length - 1] || '';
    if (name.startsWith('.') || /\.txt$/i.test(name) || /^(thumbs\.db|desktop\.ini)$/i.test(name)) continue;
    if (!IMG.test(name)) { skipped.push({ path: f.path, reason: 'não é imagem (use webp, jpg ou png)' }); continue; }
    // a pasta da categoria pode estar em qualquer nível (escolheu "Imagens" ou só "01_iPhone")
    const ci = parts.findIndex((seg, i) => i < parts.length - 1 && matchCategory(seg, categories));
    if (ci < 0) { skipped.push({ path: f.path, reason: 'pasta de categoria não reconhecida' }); continue; }
    const catFolder = parts[ci];
    const category = matchCategory(catFolder, categories);
    if (!cats.has(catFolder)) cats.set(catFolder, { folder: catFolder, category, cover: null });
    const rel = parts.slice(ci + 1);   // [arquivo] | [modelo, arquivo] | [modelo, cor, arquivo]
    if (rel.length === 1) {
      if (COVER.test(name)) { cats.get(catFolder).cover ||= f; continue; }
      skipped.push({ path: f.path, reason: 'foto solta na categoria (chame de "categoria" para virar a foto da categoria)' });
      continue;
    }
    if (rel.length > 3) { skipped.push({ path: f.path, reason: 'pasta dentro da pasta da cor' }); continue; }
    const modelFolder = rel[0];
    const key = `${catFolder}|${modelFolder}`;
    if (!models.has(key)) {
      const pool = products.filter((p) => !category || p.categoryId === category.id);
      const product = matchModel(modelFolder, pool) || matchModel(modelFolder, products);
      models.set(key, { catFolder, category, folder: modelFolder, product, cover: null, colors: new Map() });
    }
    const m = models.get(key);
    if (rel.length === 2) { m.cover ||= f; continue; }   // foto direto na pasta do modelo = capa
    const colorFolder = rel[1];
    if (!m.colors.has(colorFolder)) {
      const known = [...(m.product?.colors || [])];
      m.colors.set(colorFolder, { folder: colorFolder, ...matchColor(colorFolder, known), files: [] });
    }
    m.colors.get(colorFolder).files.push(f);
  }
  return {
    categories: [...cats.values()],
    models: [...models.values()].map((m) => ({ ...m, colors: [...m.colors.values()] })),
    skipped,
  };
}

/* ------------------------------------------- fotos repetidas (conteúdo) -- */

/**
 * "Impressão digital" da foto: SHA-256 do conteúdo do arquivo. A mesma foto
 * dá o mesmo código com qualquer nome ("foto.webp", "foto (1).webp").
 */
export async function fileHash(file) {
  const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(buf).slice(0, 10)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Nome das fotos que a importação envia: "h2-<código do conteúdo>". O "2" é
 * a versão do tratamento (fundo branco + recorte da vitrine): foto enviada
 * com um tratamento antigo conta como "de antes" e pode ser trocada.
 */
export const PHOTO_PREFIX = 'h2-';

/** Código da foto que a importação enviou (".../p/h2-<código>.webp"); foto de antes: ''. */
export function photoHash(url) {
  return /\/p\/h2-([0-9a-f]{20})\.[a-z]+(?:\?|$)/.exec(String(url || ''))?.[1] || '';
}

/** Tira da lista as fotos de conteúdo repetido (fica a primeira). */
export function uniqueByHash(files, hashOf) {
  const seen = new Set();
  return files.filter((f) => {
    const h = hashOf(f);
    if (!h) return true;
    if (seen.has(h)) return false;
    seen.add(h);
    return true;
  });
}

/* ---------------------------------------- ordem das fotos (vitrine) -- */

const isBg = (r, g, b) => Math.min(r, g, b) > 228 && Math.max(r, g, b) - Math.min(r, g, b) < 16;

/**
 * Medidas de uma foto reduzida (RGBA, ~96 px de largura): onde está o
 * produto (fundo branco em volta), se encosta nas bordas (foto cortada),
 * quanto do quadro ocupa e a proporção do recorte.
 */
export function photoMetrics(data, w, h) {
  // fundo = o quase branco LIGADO à borda (preenchido a partir dela): o
  // prateado/branco do próprio aparelho não conta como fundo
  const bgPx = (k) => { const i = k * 4; return data[i + 3] < 20 || isBg(data[i], data[i + 1], data[i + 2]); };
  const bg = new Uint8Array(w * h);
  const stack = [];
  const push = (k) => { if (!bg[k] && bgPx(k)) { bg[k] = 1; stack.push(k); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const k = stack.pop();
    const x = k % w;
    if (x > 0) push(k - 1);
    if (x < w - 1) push(k + 1);
    if (k >= w) push(k - w);
    if (k < w * (h - 1)) push(k + w);
  }
  let minX = w; let minY = h; let maxX = -1; let maxY = -1; let n = 0;
  let edge = 0; let edgeBg = 0;
  const bandX = Math.max(1, Math.round(w * 0.04));
  const bandY = Math.max(1, Math.round(h * 0.04));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      if (x < bandX || x >= w - bandX || y < bandY || y >= h - bandY) { edge++; if (bg[k]) edgeBg++; }
      if (bg[k]) continue;
      n++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (!n) return { bg: 1, touch: 0, fill: 0, aspect: 1, dense: 0, cut: 0 };
  const bw = maxX - minX + 1; const bh = maxY - minY + 1;
  const m = [minX / w, (w - 1 - maxX) / w, minY / h, (h - 1 - maxY) / h];
  // lado reto e cheio = produto cortado por uma linha (close, recorte):
  // aparelho inteiro tem canto arredondado e não enche a linha da borda
  const rowFill = (y) => { let c = 0; for (let x = minX; x <= maxX; x++) c += 1 - bg[y * w + x]; return c / bw; };
  const colFill = (x) => { let c = 0; for (let y = minY; y <= maxY; y++) c += 1 - bg[y * w + x]; return c / bh; };
  const sides = [rowFill(minY), rowFill(maxY), colFill(minX), colFill(maxX)];
  return {
    cut: sides.filter((f) => f >= 0.93).length, // lados cortados em linha reta
    sides: sides.map((f) => Math.round(f * 100) / 100).join('/'),
    bg: edgeBg / edge,                         // borda branca (foto de estúdio ≈ 1)
    touch: m.filter((v) => v < 0.015).length,  // lados em que o produto encosta (cortado)
    fill: (bw * bh) / (w * h),                 // quanto do quadro o produto ocupa
    aspect: bw / bh,                           // largura ÷ altura do produto
    dense: n / (bw * bh),                      // recorte cheio (close/retângulo) ≈ 1
  };
}

/**
 * Nota de vitrine (maior = primeiro). Vai para o fim: produto cortado
 * (close), fundo que não é branco (foto de ambiente), produto encostado na
 * borda, vista de lado (fininho) ou miúdo demais no quadro. `pair` (iPhone):
 * a foto de frente + verso lado a lado (largura ≈ 0,6-0,9 da altura) vem
 * primeiro; depois a de um aparelho só.
 */
export function photoScore(m, { pair = false } = {}) {
  if (!m) return -999;
  let s = 100;
  s -= Math.min(m.cut, 3) * 30;
  if (m.bg < 0.9) s -= 45;
  s -= m.touch * 20;
  if (m.aspect < 0.3) s -= 35;
  if (m.fill < 0.12) s -= 25;
  if (pair) {
    if (m.aspect >= 0.6 && m.aspect <= 0.92) s += 25;
    else if (m.aspect >= 0.4 && m.aspect < 0.6) s += 10;
    else if (m.aspect > 0.95) s -= 15;
  }
  return s;
}

/** Arquivo marcado à mão como a primeira foto: "00...", "capa...", "principal...". */
export const isPinned = (path) => /^(00|capa|principal)/i.test(String(path || '').split(/[\\/]/).pop());

/** A foto de vitrine primeiro; a marcada à mão vence; a ordem do arquivo desempata. */
export function orderByScore(files, scoreOf) {
  return files.map((f, i) => ({ f, i, s: (isPinned(f.path) ? 1000 : 0) + scoreOf(f) }))
    .sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.f);
}
