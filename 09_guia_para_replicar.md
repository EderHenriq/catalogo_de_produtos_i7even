# 09 - Guia para replicar o padrão Suasesh em outros sistemas

*Criado em 28/10/2026, ao fim da v1.4.1. Para o Eder e para quem (pessoa ou
IA) for levar este padrão para outro sistema - o próximo é o da **i7even**.*

Este arquivo é o **mapa**: o que existe no sistema da Suasesh, como funciona,
por que foi feito assim e em que ordem levar para outro projeto. Os detalhes
estão nos outros arquivos de `contextos/` e no próprio código (cada módulo
começa com um comentário explicando o porquê).

---

## Índice

1. [O que é o padrão em uma página](#1-o-que-é-o-padrão-em-uma-página)
2. [Arquitetura e pastas](#2-arquitetura-e-pastas)
3. [Banco de dados: as regras que não se negociam](#3-banco-de-dados-as-regras-que-não-se-negociam)
4. [Funcionalidades, uma por uma](#4-funcionalidades-uma-por-uma)
5. [Robustez: os padrões que evitam perder dado](#5-robustez-os-padrões-que-evitam-perder-dado)
6. [Sem internet no balcão](#6-sem-internet-no-balcão)
7. [Catálogo online + pedido pelo WhatsApp](#7-catálogo-online--pedido-pelo-whatsapp)
8. [Backup e "o Supabase grátis nunca pausa"](#8-backup-e-o-supabase-grátis-nunca-pausa)
9. [Segurança](#9-segurança)
10. [Testes: como validamos tudo](#10-testes-como-validamos-tudo)
11. [Bugs que já pegamos (não repita)](#11-bugs-que-já-pegamos-não-repita)
12. [Regras de interface (iPhone e computador)](#12-regras-de-interface-iphone-e-computador)
13. [Como publicar uma versão sem perder dado do cliente](#13-como-publicar-uma-versão-sem-perder-dado-do-cliente)
14. [Roteiro: levar tudo para a i7even](#14-roteiro-levar-tudo-para-a-i7even)
15. [Checklist final de um sistema "no padrão"](#15-checklist-final-de-um-sistema-no-padrão)

---

## 1. O que é o padrão em uma página

| Item | Como é |
|---|---|
| **Stack** | HTML + CSS + JavaScript puros (módulos ES, **sem build, sem npm no app**) + Supabase (Postgres, login, Storage, Realtime) + Netlify |
| **Quem usa** | Um login de dono (Suasesh) ou poucos membros (i7even: Eder e Julie). Ninguém mais enxerga nenhuma linha |
| **Onde roda** | Computador e celular; no iPhone vira "app" (Adicionar à Tela de Início) com ícone, tela de abertura e área segura |
| **Regra de ouro dos dados** | Tudo o que mexe em dinheiro ou estoque passa por **função no banco (RPC)**, numa transação, com trava de linha. O navegador nunca grava saldo direto |
| **Banco versionado** | Tudo nasce de `supabase/schema.sql` **idempotente** (roda quantas vezes quiser, nunca apaga). `whoami().schema_version` + `APP.schemaVersion` avisam quando o banco está atrás do app |
| **Funciona sem internet** | Service worker + cópia dos dados no IndexedDB + fila de vendas novas com código único (reenviar nunca duplica) |
| **Catálogo público** | `catalogo.html` lê só por 2 funções; preço vem do banco; pedido abre o WhatsApp da loja e cai no sistema |
| **Grátis de verdade** | Supabase free + Netlify free + GitHub Actions (sinal de vida diário + backup criptografado) |
| **Testado** | Banco num Postgres real (PGlite), fórmulas, backup+restauração, ataque sem login no banco real, e roteiros no Chrome (152-168 telas, 6 tamanhos, 2 temas) |
| **Documentado** | `contextos/` = memória do projeto (estado, decisões datadas, pendências) |

Versões da Suasesh (todas em 23-28/10/2026): v1.0 (base) → v1.1 (catálogo,
offline, caixa, contas fixas…) → v1.2 (robustez: backup, reenvio seguro…) →
v1.2.1 (contagem de estoque) → v1.3 (Categorias e Catálogo com páginas
próprias) → v1.4 (reajuste em lote, maquininha, código de barras…) → v1.4.1
(menu). Decisões numeradas D-001…D-049 em `07_log_de_decisoes.md`.

---

## 2. Arquitetura e pastas

```
Sistema_Fer/
├─ index.html              app (modulepreload de TODOS os módulos - teste confere)
├─ catalogo.html           catálogo público (sem login)
├─ sw.js                   service worker (PRECACHE de todo arquivo do app - teste confere)
├─ manifest.webmanifest    app no celular
├─ netlify.toml            CSP, HSTS, Permissions-Policy, pastas internas escondidas (404)
├─ assets/
│  ├─ css/  tokens.css (cores/temas) · base · layout · components · app · mobile · catalog
│  ├─ brand/  logo, ícones, splash do iPhone, og-catalogo.jpg (prévia do link)
│  └─ js/
│     ├─ app.js           entrada: login → "sem acesso" → "banco antigo" → app; rotas; menu
│     ├─ config.js        URL + publishable key (pública), APP.version, APP.schemaVersion
│     ├─ catalog.js       catálogo público (fetch simples, sem supabase-js)
│     ├─ core/            data.js (repositório) · calc.js (fórmulas) · supabase.js
│     │                   offline.js (IndexedDB) · telemetry.js · utils.js · errors.js · constants.js
│     ├─ docs/            order-doc.js · pdf.js (jsPDF) · whatsapp.js (mensagem formatada)
│     └─ ui/              uma tela por arquivo + kit.js (modal, toast, menu) + common.js
├─ supabase/  schema.sql (idempotente) · seed_catalogo.sql · backup_prelude.sql
├─ tests/     unit/ (node --test) · db/ (PGlite) · security/ (banco real)
├─ .github/workflows/backup.yml
└─ contextos/ 00…09 (este arquivo)
```

**Padrões de código que valem para todo projeto:**

- **`core/data.js` é o único lugar que fala com o Supabase.** Mantém uma cópia
  em memória (`state`) → busca, filtros e relatórios instantâneos no 4G. Banco
  em `snake_case`, app em `camelCase`, conversão só ali (`xFromRow`/`xToRow`).
- **Fórmula no banco tem espelho em `core/calc.js`** com o mesmo resultado e
  teste dos dois lados (custo médio, rateio de frete, totais, taxa da maquininha…).
- **Cada tela exporta `mount(host, ctx)` e devolve `{ destroy }`**; o container
  é recriado a cada rota (ouvintes ficam no `host`, nada vaza entre telas).
- **Telas grandes e raras são carregadas sob demanda** (`import('./x.js')`), mas
  todas entram no `PRECACHE` e no `modulepreload`.
- **Ícones em SVG inline** (`ui/icons.js`), sem biblioteca. Fontes do Google
  (Fredoka títulos, Inter texto). Bibliotecas externas só do **jsDelivr com
  versão fixa** (supabase-js 2.117.2, jsPDF 4.2.1, qrcode-generator 1.4.4,
  @zxing/browser 0.1.5) e carregadas só quando a tela precisa.
- **Comentário no topo de cada arquivo diz o PORQUÊ**, em português simples.

---

## 3. Banco de dados: as regras que não se negociam

1. **`schema.sql` idempotente**: `create table if not exists`, `alter table …
   add column if not exists`, `create or replace function`, `drop policy if
   exists` + `create policy`, constraints com `drop constraint if exists` antes.
   O teste roda o arquivo **duas vezes** seguidas.
2. **Cliente já usando = só acrescentar.** Nunca `drop table`, nunca apagar
   dado. Mudou algo de que o app depende? Sobe `schema_version` no `whoami()` e
   `APP.schemaVersion` juntos (o app mostra "rode o schema.sql" em vez de falhar).
3. **RLS em toda tabela, uma política "só o dono"**: `using ((select
   public.is_owner()))`. `is_owner()` é `security definer` e lê `app_owner`
   (Suasesh) - na i7even o equivalente é `store_members`/`eh_membro()`. Um
   login criado por engano no painel **não enxerga nada**.
4. **Permissões por coluna**: em `products` o navegador pode alterar nome,
   preço etc., mas **não** `stock`. Excluir produto só pela função
   (`delete_product`), que recusa se houver histórico.
5. **Tudo que mexe em estoque/dinheiro é RPC** (`save_order`, `set_order_status`,
   `cancel_order`, `post_purchase`, `redo_purchase`, `cancel_purchase`,
   `adjust_stock`, `count_stock`, `save_kit_items`, `set_prices`,
   `merge_customers`, `delete_category`, `reorder_categories`…):
   - `perform public.require_owner()` na primeira linha;
   - trava as linhas **em ordem de id** (`order by id for update`) - duas vendas
     simultâneas nunca se bloqueiam em cruz;
   - mensagens de erro em português (`raise exception 'Estoque insuficiente: …'`)
     que a tela mostra direto (código P0001);
   - `revoke all … from public, anon` + `grant execute … to authenticated`.
6. **Movimentos de estoque** (`stock_movements`) guardam o efeito ATUAL de cada
   venda/entrada (editar a venda refaz os movimentos dela). Entrada guarda
   `prev_cost`/`new_cost` para o custo médio voltar ao cancelar/corrigir.
7. **Valores calculados pelo banco**: `orders.balance` é coluna gerada;
   `paid_amount` é a soma dos pagamentos (gatilho). O app nunca confia num
   total vindo do navegador.
8. **Datas**: o banco está em UTC - o app sempre manda a data local
   (`todayISO()`), nunca depende de `current_date` para "hoje".

Modelo completo da Suasesh: `03_modelo_de_dados.md`.

---

## 4. Funcionalidades, uma por uma

| Área | O que faz | Onde |
|---|---|---|
| **Login** | Um e-mail fixo; "esqueci a senha" com PKCE; "sair de todos os aparelhos"; cadastro público desligado no Supabase | `ui/gate.js`, `core/supabase.js` |
| **Painel** | Vendas de hoje/mês (vs mês anterior), a receber, estoque baixo, "precisa de atenção" (pedidos do catálogo, vendas na fila, contas vencendo, aniversários da semana), mais vendidos, atalhos | `ui/dashboard.js` |
| **Venda / orçamento** | Seletor de produtos (mais vendidos primeiro, grade/lista, busca por nome/código/código do fornecedor/**código de barras pela câmera**), kit montado e kit personalizado, desconto em R$ ou %, frete, fiado com entrada (pergunta a forma da entrada), rascunho que sobrevive a fechar a tela, aviso de falta de estoque ("salvar como orçamento?") | `ui/order-form.js`, `ui/product-picker.js` |
| **Pedido em PDF e WhatsApp** | Documento com logo, itens, totais, Pix; mensagem formatada (`*negrito*`), cobrança de fiado | `docs/*`, `ui/doc-preview.js` |
| **Ficha da venda** | Situações (orçamento → a entregar → concluída → cancelada) mexendo no estoque; pagamentos (parcelas); **cancelar venda paga pergunta "devolveu o dinheiro?"** (estorno por forma, na data de hoje) | `ui/order-detail.js` |
| **Vendas** | Filtros, períodos, KPIs, lista em páginas (60 + "Mostrar mais"), pedidos do catálogo no topo ("Criar venda" com 1 toque), exportar CSV | `ui/orders.js` |
| **Estoque** | Lista com nível (ok/baixo/zerado), filtros (sem custo, inativos…), ficha com histórico de movimentos, ajuste com motivo, **contar estoque** (lista inteira, rascunho no aparelho, só grava o que mudou), **reajustar preços em lote** (%, margem, arredondamento ,50/,90), **lista de compras** por fornecedor pronta para o WhatsApp, foto do produto (câmera/galeria, comprime no aparelho, miniatura), excluir só sem histórico (senão desativa) | `ui/products.js`, `ui/stock-count.js`, `ui/price-adjust.js`, `ui/restock.js` |
| **Entradas** | Nota do fornecedor como ela é ("2 cx c/25 a R$ 59"), frete rateado no custo real, custo médio ponderado, preço de venda sugerido pela margem, aprende fornecedor e código do fornecedor, **corrigir entrada** mesmo com parte vendida | `ui/purchases.js` |
| **Clientes / Fornecedores** | Cadastro, histórico, quanto deve, mandar catálogo, **juntar duplicados** | `ui/customers.js`, `ui/suppliers.js` |
| **Financeiro** | Resumo do mês (faturamento, custo, lucro bruto, despesas, **taxa da maquininha**, lucro líquido), **caixa do dia** (por forma, conferência da gaveta, fechamento, resumo no WhatsApp), despesas e **contas fixas** com aviso, a receber | `ui/finance.js`, `ui/cash.js` |
| **Relatórios** | Por período: vendido, lucro (% sem frete), ticket, por dia, mais vendidos, mais lucro, por categoria, parados há 60 dias | `ui/reports.js` |
| **Categorias** | Ordem por setas, foto ou emoji com prévia, descrição no catálogo, esconder do catálogo, produtos da categoria (mostrar/mover/trazer), excluir perguntando o destino | `ui/categories.js` |
| **Catálogo (gestão)** | Aberto/fechado, números, link, **QR code para imprimir**, mensagens prontas, link por categoria, "antes de divulgar", produtos à mostra com filtros e ação em lote | `ui/catalog-admin.js` |
| **Ajustes** | Dados da loja, margem padrão, estoque mínimo, troco, taxas da maquininha, vender sem estoque, tema, conta, backup JSON, diagnóstico de erros | `ui/settings.js` |
| **Sem internet** | Abre sem rede, vende, fila sobe sozinha | `sw.js`, `core/offline.js`, `core/data.js` |
| **Diagnóstico** | Erros do aparelho (e do celular do cliente no catálogo) gravados no banco por 90 dias | `core/telemetry.js`, `client_errors`, `log_client_error` |

---

## 5. Robustez: os padrões que evitam perder dado

Copie estes padrões **como estão** - cada um nasceu de um problema real.

| Padrão | Problema que resolve | Como |
|---|---|---|
| **Código do aparelho em toda venda nova** (`client_ref`) | Internet cai DEPOIS de o banco gravar → o app reenvia → venda e baixa de estoque em dobro | UUID gerado no aparelho; índice único; `save_order` devolve a venda existente se o código já foi gravado |
| **Id nascido no aparelho** para pagamento e cliente novo | Tocar "Salvar" de novo depois de erro de rede lança duas vezes | `upsert … ignoreDuplicates` com o id gerado ao abrir o formulário |
| **Tempo limite nas chamadas** (20 s; 90 s em foto) | 4G "conectado sem dados" deixa o botão girando para sempre | `fetchWithTimeout` passado ao supabase-js; vira erro de rede → venda vai para a fila (seguro por causa do `client_ref`) |
| **Fila de vendas nunca é apagada sozinha** | Sessão expirada / "sair de todos os aparelhos" apagava vendas feitas offline | Sair apaga só a cópia dos dados; a fila sobe no próximo login |
| **Transação única** para operações compostas | Kit ficava vazio se a internet caísse entre "apagar componentes" e "gravar componentes" | `save_kit_items`, `redo_purchase`, `delete_category`, `count_stock`, `set_prices` |
| **Versão do banco** | App novo com banco velho falhava escondido numa venda | `whoami().schema_version` vs `APP.schemaVersion` → tela "rode o schema.sql" |
| **Eco do realtime ignorado** | Cada venda salva recarregava a lista duas vezes | `mute()` por coleção + comparação de `updated_at`; venda alterada é buscada sozinha (`refreshOrder`) |
| **Janela de 12 meses** | Abrir o app baixava a história inteira | Carrega 12 meses + tudo com saldo; o resto sob demanda (`ensureOrdersFrom`) |
| **Estorno em vez de apagar pagamento** | Cancelar venda paga deixava o dinheiro "recebido" no caixa | Pagamento negativo por forma, na data da devolução |
| **Excluir só sem histórico** | Excluir produto vendido apagava histórico e relatórios | `delete_product` recusa → tela oferece desativar |
| **Erro de regra em português** | Mensagem técnica do banco na cara do cliente | `raise exception` em PT + `core/errors.js` (`friendlyError`) traduz o resto |
| **Telemetria** | Erro no iPhone só aparecia se alguém contasse | `capture()` → fila no aparelho → `client_errors`; filtra ruído (rede, regra de negócio) |

---

## 6. Sem internet no balcão

- **`sw.js`**: arquivos do app = rede primeiro, cópia se cair, **e cópia
  depois de 4 s** se a rede estiver lenta; bibliotecas do jsDelivr e fontes =
  cache primeiro; fotos do Storage = mostra a guardada e atualiza por trás.
  Todo arquivo de `assets/` entra no `PRECACHE` e o `VERSION` sobe a cada
  versão (o teste `tests/unit/sw.test.mjs` falha se esquecer).
- **`core/offline.js`**: IndexedDB com a última cópia dos dados ("snapshot") e
  a fila de vendas.
- **Só VENDAS NOVAS funcionam offline.** Cadastros, entradas e edições pedem
  internet (evita conflito difícil de resolver depois). Cliente novo digitado
  na venda nasce junto com a venda quando ela sobe.
- Faixa no topo avisa "Sem internet · N vendas na fila"; botão "Enviar agora".

---

## 7. Catálogo online + pedido pelo WhatsApp

Tudo em **`08_catalogo_whatsapp.md`** (modelo reutilizável, com o roteiro de
portar). Resumo das regras:

- `catalogo.html` **nunca lê tabela**: só `public_catalog()` e
  `catalog_request()` (funções `security definer` liberadas para `anon`).
- Nunca saem custo, saldo exato, código do fornecedor, clientes ou vendas.
- **Preço do pedido vem do banco**; item que esgotou com a página aberta
  entra marcado "⚠️ esgotou agora - confirmar".
- Freio anti-robô por aparelho (hash do IP) e por telefone (8/hora), mais o da
  loja toda (120/10 min, 1000/dia).
- Categoria escondida esconde os produtos dela; catálogo fechado ainda mostra
  o WhatsApp da loja.
- Celular: chips de categoria rolando; computador: coluna de categorias fixa,
  4-6 colunas, ficha do produto em 2 colunas. **Foto sempre quadrada e
  cortada** (ver bug 11.6).
- No sistema: tela "Catálogo" com QR code, mensagens prontas, link por
  categoria e "antes de divulgar".

---

## 8. Backup e "o Supabase grátis nunca pausa"

`.github/workflows/backup.yml`, todo dia às 06:17:

| Job | Precisa configurar? | O que faz |
|---|---|---|
| `keepalive` | Não | Chama `keepalive()` com a publishable key → o projeto grátis não pausa |
| `backup` | **Sim: secrets `SUPABASE_DB_URL` (Session pooler) e `BACKUP_PASSPHRASE`** | `1_dados.sql` (dados, `INSERT` com nome de colunas, começa por `backup_prelude.sql`), `2_login.sql` (auth.users + identities), `0_estrutura.sql` → tar.gz → GPG AES-256 → artefato 30 dias. **Falha (vermelho) se faltar tabela essencial** |
| `repo-activity` | Não | Repositório público: commit vazio a cada ~50 dias (o GitHub desliga agendamento parado) |

- **Nunca junte `--schema` e `--table` no mesmo `pg_dump`** (ver bug 11.1).
- `tests/db/backup.test.mjs` gera o backup **com os parâmetros lidos do
  próprio workflow**, restaura num banco novo e compara tabela por tabela.
- Restauração passo a passo: `05_deploy_e_backup.md` §4.
- No app: Ajustes → Backup baixa um JSON completo na hora.

> Situação da Suasesh em 28/10/2026: o `keepalive` roda todo dia, mas o
> backup **nunca guardou uma cópia** (secrets não cadastrados). Em cada sistema
> novo, cadastre os secrets **no primeiro dia** e confira no log a lista de tabelas.

---

## 9. Segurança

- Só a **publishable key** no código (é pública por desenho); quem protege é o
  RLS. **Nunca** `service_role`/secret key em arquivo.
- `netlify.toml`: CSP (`script-src 'self' https://cdn.jsdelivr.net`, `img-src`
  com `*.supabase.co`, `frame-ancestors 'none'`), HSTS, `Permissions-Policy`
  (câmera **só para o próprio site**, microfone/localização bloqueados) e as
  pastas `supabase/`, `contextos/`, `tests/`, `.github/`, `CLAUDE.md` com 404.
- Supabase: cadastro público desligado; Site URL / Redirect URLs = endereço do
  Netlify; bucket de fotos público para leitura, escrita só do dono.
- Planilha exportada protegida contra fórmula (`=`, `+`, `-`, `@` viram texto).
- `tests/security/live.test.mjs`: ataque **sem login** contra o banco real
  (lê, grava, chama cada função) + cabeçalhos do site publicado. Rodar a cada
  mudança de banco: `cd tests && SITE_URL=https://… npm run test:security`.
- Dados do cliente (planilhas, backups, CSV) **nunca** entram no git.

---

## 10. Testes: como validamos tudo

| Suíte | Comando | O que prova |
|---|---|---|
| Unidade | `npm run test:unit` (28) | Fórmulas (`calc.js`), PDF/WhatsApp, WhatsApp com DDD 55, CSV seguro, UUID, arredondamentos, taxa da maquininha, `sw.js` com todo arquivo |
| Banco | `npm run test:db` → `db/schema.test.mjs` (156) | O `schema.sql` inteiro num **Postgres de verdade (PGlite 0.5 = PG 17)**, simulando os papéis do Supabase: anon/intruso não veem nada, cada RPC (estoque, custo médio, kits, estorno, reenvio, correção de entrada, catálogo, freios…) |
| Backup | `db/backup.test.mjs` (18) | Gera, restaura num banco novo, compara, e o sistema volta a funcionar com o mesmo login |
| Segurança ao vivo | `npm run test:security` | Banco real e site publicado |
| Navegador | roteiros com `puppeteer-core` + Chrome, **Supabase simulado** (dados fictícios) | Auditoria de 168 telas (6 tamanhos × 2 temas: rolagem lateral, campo < 16 px, toque < 40-44 px, erros de JS); roteiros de cada versão: offline, reenvio com resposta perdida, sair com fila, contagem, "Lançar mesmo assim", catálogo (7 larguras, foto em pé), categorias, catálogo de gestão, reajuste, maquininha, **código de barras com câmera falsa filmando um EAN-13** |

> Os roteiros de navegador ficaram fora do repositório (pasta temporária da
> sessão). Para o próximo sistema, recrie a mesma ideia: servidor local
> (`python -m http.server 8765`), Chrome headless interceptando
> `*.supabase.co` e respondendo com dados fictícios, e um teste por tela/fluxo.
> Para câmera: `--use-fake-device-for-media-stream
> --use-file-for-fake-video-capture=codigo.mjpeg`.

**Regra:** antes de entregar, `cd tests && npm test` + auditoria visual; se
mexeu no banco, `npm run test:security`. Ao corrigir um bug, primeiro
reproduza no teste (ele tem que FALHAR na versão antiga).

---

## 11. Bugs que já pegamos (não repita)

| # | Bug | Causa | Regra |
|---|---|---|---|
| 11.1 | Backup "verde" com **só o login** | `pg_dump --schema=public --table=auth.users`: com `--table`, o `--schema` é ignorado | Dados e login em `pg_dump` separados + teste de restauração |
| 11.2 | Cliques em Ajustes não faziam nada | `closest('[data-theme]')` casava com o `<html data-theme>` | Nunca usar como gatilho um atributo que exista no `<html>`/`<body>` |
| 11.3 | "Lançar mesmo assim" não lançava | `e.currentTarget` vira `null` depois de um `await` (o aviso) | Em ouvinte `async`: `const btn = e.currentTarget` **antes** do primeiro `await`; `withLoading(null)` só roda a tarefa |
| 11.4 | Venda em dobro com internet ruim | Reenvio sem identificador | `client_ref` (seção 5) |
| 11.5 | Venda offline com cliente novo dava erro | Cadastro de cliente exigia internet | Cliente nasce junto com a venda na fila |
| 11.6 | Catálogo desalinhado no computador | Caixa com `aspect-ratio` **cresce** para caber uma foto em pé; a grade estica a linha | Moldura de foto: `overflow:hidden` + imagem `position:absolute; inset:0` |
| 11.7 | "3,49" sumia no iPhone | `type="number"` pode descartar decimal com vírgula | Campo decimal: `type="text" inputmode="decimal"` + trocar vírgula por ponto |
| 11.8 | Leitor de código de barras ia falhar só no site publicado | `Permissions-Policy: camera=()` no Netlify (servidor local não aplica) | Conferir cabeçalhos no site publicado (`test:security` com `SITE_URL`) |
| 11.9 | Fiado com entrada gravado sempre como "Pix" | Forma fixa no código | Perguntar a forma da entrada |
| 11.10 | `[hidden]` não escondia | `display:flex` do componente vencia | `[hidden] { display:none !important }` no base.css |
| 11.11 | Link de WhatsApp errado para DDD 55 | "começa com 55 = já tem o país" | `waNumber()` decide pelo tamanho (10-11 dígitos = sem país) |
| 11.12 | "Vendido nos últimos dias" errava depois das 21 h | `toISOString()` é UTC | Data local sempre (`todayISO`) |
| 11.13 | Foto do iPhone salva como .webp sendo JPEG | Safari não gera WebP no canvas | Extensão e tipo seguem o que foi gerado de verdade |
| 11.14 | Apagar foto do Storage não funcionava | Remover exige política de `select` também | Política `produtos_owner_select` |
| 11.15 | Ouvintes vazando entre telas | Container reaproveitado | Container recriado a cada rota |

---

## 12. Regras de interface (iPhone e computador)

- Campos com **16 px** (o Safari dá zoom em menos); alvos de toque **≥ 44 px**
  (40 no mínimo em listas densas); `env(safe-area-inset-*)` no topo/rodapé.
- Toda tela conferida em **375 / 390 / 440 px, iPad e computador**, nos **dois
  temas** (claro/escuro com cores do logo e contraste medido - `04`).
- Celular: barra de baixo (Painel, Vendas, +, Estoque, Mais); folha que sobe de
  baixo (`sheet`) em vez de janela; foto pela **Câmera** ou **Galeria**.
- Computador: menu lateral (Loja · Cadastros · Gestão, **Ajustes por último**),
  e o menu inteiro cabe em tela de 768 px de altura.
- Listas longas em páginas ("Mostrar mais"); nada redesenha enquanto a pessoa
  digita (o subscribe confere o foco).
- Texto da interface para o **dono da loja**, sem jargão: "Lançar", "Fiado",
  "Caixa do dia", "Avise-me".

---

## 13. Como publicar uma versão sem perder dado do cliente

1. **Ajustes → Backup**: baixar a cópia JSON (enquanto o backup automático não
   estiver ligado, essa é a única).
2. Supabase → SQL Editor: rodar o `schema.sql` inteiro (só acrescenta).
3. Commit + push (o Netlify publica sozinho).
4. `cd tests && SITE_URL=https://… npm run test:security`.
5. Abrir no celular: o service worker troca de versão sozinho (`VERSION`
   novo apaga o cache antigo).
6. Atualizar `00_onde_paramos.md`, `06` e `07`.

Se publicar o app antes do SQL, ele mostra "o banco está na versão X, rode o
schema.sql" - nada quebra escondido.

---

## 14. Roteiro: levar tudo para a i7even

### 14.1 Como a i7even está hoje (28/10/2026)

`..\sistema de pedidos Ju\catalogo_de_produtos_i7even`:

| Ponto | i7even hoje | Padrão Suasesh |
|---|---|---|
| Usuários | **2 donos** (Eder e Julie) em `store_members` / `eh_membro()` | 1 dono (`app_owner`) - **manter o modelo de membros da i7even** |
| Dados | Uma tabela `orders` (totais por gatilho), `core/store.js` | Tabelas separadas + RPCs + `core/data.js` com cópia em memória |
| Produtos | **Catálogo fixo no código** (`data/catalog.js`: modelos Apple com armazenamento, cores, tamanhos, condição, origem) | Produtos no banco, com estoque, custo e foto |
| Estoque | Não tem | Movimentos, custo médio, entradas, contagem |
| Offline / backup / testes / catálogo público | Não tem | Tem |

### 14.2 Decisões para tomar ANTES de começar (perguntar ao Eder)

1. **Produto Apple = modelo + variação.** Cadastrar cada combinação vendável
   (ex.: "iPhone 15 Pro · 256GB · Titânio natural · Lacrado") como produto, ou
   produto = modelo e variação escolhida na venda (como hoje)?
2. **Estoque por unidade (IMEI/série)?** Aparelho caro costuma precisar do
   número de série de cada unidade (garantia, troca). Se sim, a entrada lança
   unidades com IMEI e a venda escolhe qual unidade sai - é uma tabela a mais
   (`units`) em vez de só `stock`.
3. **Entrada de mercadoria**: compra de fornecedor/importação com câmbio, frete
   e taxas? (o rateio de custo da Suasesh serve, com campo de câmbio).
4. **Aparelho na troca** (cliente dá o usado como parte do pagamento): entra
   como forma de pagamento + entrada de estoque do usado?
5. **Catálogo público** para a i7even faz sentido (preço de iPhone muda toda
   semana)? Se sim, com "consulte o preço" opcional por produto.
6. Garantia/prazo por condição (Lacrado, Seminovo…) no documento do pedido.

### 14.3 Ordem de trabalho (cada fase termina publicável)

| Fase | O que levar | Observação |
|---|---|---|
| **0. Base e segurança** | `contextos/` (00…09), `CLAUDE.md`, `tests/` (unit + db PGlite + security), `netlify.toml` do padrão (CSP, Permissions-Policy, 404), `whoami()` com `schema_version`, `core/errors.js`, `telemetry.js` + `client_errors` | Sem mudar tela nenhuma. Começa pelo inventário do que existe (como a Suasesh começou pelo `01_cliente_e_dores`) |
| **1. Backup** | `backup.yml` + `backup_prelude.sql` + `backup.test.mjs` adaptados (`store_members` no lugar de `app_owner`) | **Cadastrar os secrets no mesmo dia** e conferir um *Run workflow* |
| **2. Dados no padrão** | `core/data.js` (cópia em memória, `readAll`, realtime com eco ignorado, janela de 12 meses), RPC `save_order` com `client_ref`, pagamentos em tabela própria com gatilho, estorno, `fetchWithTimeout` | Migrar os pedidos existentes da tabela atual para o modelo novo **num script testado no PGlite com uma cópia dos dados** antes de rodar no real |
| **3. Produtos e estoque** | Produtos no banco (a partir do `data/catalog.js`), categorias (iPhone, Watch, Mac, iPad, AirPods, consoles, perfumes, acessórios), estoque (ou unidades com IMEI - decisão 14.2.2), entradas com custo real, contagem, reajuste em lote, código de barras pela câmera, excluir só sem histórico | Maior fase. As telas da Suasesh (`products.js`, `purchases.js`, `stock-count.js`, `price-adjust.js`, `barcode.js`, `categories.js`) servem de base |
| **4. Venda completa** | Seletor rápido, rascunho, PDF/WhatsApp no padrão novo, ficha com situações, cancelar venda paga, fiado/parcelas, clientes com "juntar duplicados" | A i7even já tem PDF/WhatsApp (foi a referência da Suasesh) - unir o melhor dos dois |
| **5. Financeiro** | Caixa do dia, despesas e contas fixas, taxa da maquininha (crédito parcelado pesa muito em aparelho caro), relatórios com margem sem frete | |
| **6. Sem internet** | `sw.js` + `offline.js` + fila | Só depois que a fase 2 estiver estável |
| **7. Catálogo online** | `catalogo.html` + `catalog-admin.js` + `08_catalogo_whatsapp.md` | Se a decisão 14.2.5 for sim |
| **8. Polimento** | Menu igual (Ajustes por último), painel com "precisa de atenção", identidade visual da i7even (cores do logo, contraste medido) | |

### 14.4 Cuidados específicos da i7even

- **Já tem dados reais**: toda mudança de banco só acrescenta; migração de
  dados com script idempotente, testado no PGlite com uma cópia antes.
- **Dois donos**: as funções usam `require_member()` (equivalente ao
  `require_owner()`); o realtime já sincroniza os dois aparelhos.
- **Valores altos**: centavos importam - manter `numeric(12,2)` e `round2` dos
  dois lados; desconto e parcelamento com teste.
- **Nada de dado de cliente no git** (IMEI também é dado sensível).

---

## 15. Checklist final de um sistema "no padrão"

- [ ] `schema.sql` idempotente, roda 2× no teste; `schema_version` = `APP.schemaVersion`
- [ ] RLS em toda tabela; ataque sem login recusado (`test:security`)
- [ ] Estoque/dinheiro só por RPC com `require_owner/member`, trava em ordem de id, erro em PT
- [ ] `client_ref` em venda nova; tempo limite nas chamadas; fila offline que nunca some sozinha
- [ ] Backup diário com secrets cadastrados **e** restauração testada; keepalive verde
- [ ] `sw.js` com todo arquivo no PRECACHE; `VERSION` sobe a cada versão
- [ ] Catálogo público só por RPC, preço do banco, freio anti-robô
- [ ] Telemetria ligada; Diagnóstico em Ajustes
- [ ] 375/390/440/iPad/computador × claro/escuro: sem rolagem lateral, campos 16 px, toques ≥ 44 px
- [ ] `contextos/00` atualizado, decisões datadas no `07`, pendências no `06`
- [ ] Repositório **privado**; nenhuma chave secreta nem dado de cliente no git
