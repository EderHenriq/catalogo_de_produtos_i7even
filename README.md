# i7even Store - Controle de Pedidos

Sistema de controle de pedidos da **i7even Store**: iPhone, Apple Watch, MacBook,
iPad, AirPods, consoles, perfumes e acessórios.

HTML, CSS e JavaScript puros (sem build, sem npm) + **Supabase** para banco de dados
e login. Publica no Netlify em segundos e abre em qualquer aparelho com internet.

---

## Versão 2: como subir (leia primeiro)

A v2 traz: cadastro de modelos com variações e **IMEI**, entradas de mercadoria,
**catálogo online** no estilo vitrine (pronta entrega × sob encomenda, cor por
foto, parcelamento), **lista do fornecedor colada do WhatsApp**, **fiado com
parcelas** (tela *A receber*, cobrança no WhatsApp, avisos de vencimento),
pedido em PDF e **backup diário no GitHub** que também impede o Supabase grátis
de pausar.

**Ordem para subir (uma vez):**

1. **Backup antes de tudo** - no sistema atual, *Ajustes → Backup* (baixa o JSON).
2. **Supabase → SQL Editor**: rode `supabase/schema.sql` inteiro e depois
   `supabase/seed_catalogo.sql`. Os dois podem rodar de novo sem duplicar nada.
   Os pedidos da v1 são migrados com os mesmos totais (testado).
3. **Confira a segurança** (no computador, com Node instalado):
   `cd tests && npm install && npm run test:security` - tudo tem de sair "recusado".
4. **Publique** a branch no Netlify (o `netlify.toml` já tem os cabeçalhos de
   segurança e esconde `/supabase`, `/tests` e `/.github`).
5. **Ligue o backup no GitHub** (opcional, recomendado):
   *GitHub → repositório → Settings → Secrets and variables → Actions → New repository secret*
   - `SUPABASE_DB_URL` - Supabase → **Connect** → *Session pooler* (a connection string com a senha do banco);
   - `BACKUP_PASSPHRASE` - uma senha longa só sua (guarde num cofre de senhas: sem ela o backup não abre).

   Depois: *Actions → "Supabase acordado + backup" → Run workflow*. Ele roda
   sozinho todo dia às 06:23. Sem os secrets, ele só faz o "sinal de vida"
   (que já impede a pausa) e pula o backup.

**Atualização v2.1 (rode de novo `schema.sql` e depois `seed_catalogo.sql`):**
IMEI e bateria opcionais (a venda separa o aparelho do estoque sozinha);
lista do WhatsApp em **pronta entrega** (publica com preço e estoque) ou
encomenda, com cores em linhas separadas, cor nova e "Criar modelo";
**cadastro rápido** (Produtos → + Produto); **fotos por cor** no modelo;
PS5 com **versão** (com leitor / digital) separada do armazenamento;
catálogo com as abas Pronta entrega × Sob encomenda e a logo "i7".

**Restaurar um backup:** baixe o artefato em *Actions*, abra com
`gpg -d i7even-AAAA-MM-DD_HHMM.tar.gz.gpg > b.tar.gz` (pede a passphrase),
`tar -xzf b.tar.gz`, e no SQL Editor rode: `schema.sql` → `2_login.sql` → `1_dados.sql`.
**Cuidado:** o `1_dados.sql` apaga os dados atuais e põe os do backup no lugar.

**Testes (no computador):** `cd tests && npm test` (fórmulas + banco + backup) e
`npm run test:e2e` (telas no iPhone e no desktop; precisa do Chrome e de
`python -m http.server 8765` na pasta do projeto).

---

## Índice

1. [Como colocar no ar (4 passos)](#como-colocar-no-ar)
2. [Usando o sistema](#usando-o-sistema)
3. [No celular](#no-celular)
4. [Identidade visual](#identidade-visual)
5. [Como a segurança funciona](#como-a-segurança-funciona)
6. [Editar o catálogo de produtos](#editar-o-catálogo-de-produtos)
7. [Estrutura dos arquivos](#estrutura-dos-arquivos)
8. [Problemas comuns](#problemas-comuns)

---

## Como colocar no ar

> **Já configurou antes?** O esquema mudou (histórico de pagamentos). Rode o
> `supabase/schema.sql` de novo no SQL Editor - ele é idempotente, não apaga
> nada e só acrescenta o que falta.

### Passo 1 - Criar a tabela no Supabase

1. Abra o painel do seu projeto → menu lateral **SQL Editor** → **New query**.
2. Abra o arquivo [`supabase/schema.sql`](supabase/schema.sql) deste repositório,
   copie **tudo** e cole no editor.
3. Clique em **Run**. Deve aparecer *Success*.

Isso cria a tabela `orders`, os índices, os cálculos automáticos de total/lucro e -
o mais importante - as regras de **RLS** que impedem qualquer pessoa de ler seus
dados sem estar logada na sua conta.

### Passo 2 - Criar os dois usuários e fechar o cadastro

A loja tem dois donos e **uma base de pedidos só**: o que o Eder cadastra a Julie
vê, e vice-versa.

1. **Authentication → Users → Add user**, duas vezes:

   | E-mail | Marque |
   |---|---|
   | `eder.pontes2014@gmail.com` | *Auto Confirm User* |
   | `juluccas1609@gmail.com` | *Auto Confirm User* |

   A senha de cada um você define nessa tela - senha não entra em arquivo nenhum
   deste repositório.

2. Volte ao **SQL Editor** e rode o `schema.sql` de novo (ou só o último bloco
   dele). É o que autoriza os dois e-mails na tabela `store_members`.

   > Só quem está em `store_members` enxerga alguma linha. Criar o usuário no
   > Supabase **não** dá acesso sozinho - precisa desse passo.

3. **Authentication → Sign In / Providers → Email**:
   desligue **"Allow new users to sign up"**.

> O passo 3 é o que impede qualquer outra pessoa de criar conta. E mesmo que
> criasse, não veria nada: sem estar em `store_members`, o banco devolve vazio.

**Para dar acesso a mais alguém depois**, crie o usuário e rode:

```sql
insert into public.store_members (user_id, nome)
select id, 'Nome da pessoa' from auth.users where email = 'email@dela.com'
on conflict (user_id) do nothing;
```

**Para tirar o acesso** (sem apagar os pedidos que a pessoa lançou):

```sql
delete from public.store_members
where user_id = (select id from auth.users where email = 'email@dela.com');
```

### Passo 3 - Colar a chave no projeto

Abra [`assets/js/config.js`](assets/js/config.js) e preencha:

```js
const HARDCODED = {
  url: 'https://vsfrnhynhzhpzeymavtx.supabase.co',   // já preenchido
  anonKey: 'eyJhbGciOi...',                          // ← cole aqui
};
```

A chave está em **Project Settings → API Keys → Publishable key**. Nos projetos mais antigos ela aparece como `anon` `public` na aba *Legacy* - as duas funcionam.

> ⚠️ Use a **publishable** (ou `anon public`). A **secret** / `service_role`
> **nunca** pode aparecer no navegador - ela ignora o RLS por completo.
>
> Se preferir não deixar a chave no repositório, é só deixar `anonKey: ''`: na
> primeira abertura o próprio sistema pede a chave e guarda no navegador. A
> desvantagem é ter que digitar uma vez em cada aparelho.

### Passo 4 - Publicar no Netlify

Como não existe build, é o caminho mais curto possível:

1. Suba os arquivos para o GitHub:

   ```bash
   git add .
   git commit -m "Sistema de pedidos i7even"
   git push
   ```

2. No Netlify: **Add new project → Import an existing project → GitHub** e escolha
   o repositório `catalogo_de_produtos_i7even`.

3. Nas configurações de build, confirme (o `netlify.toml` já define tudo):

   | Campo | Valor |
   |---|---|
   | Build command | *(vazio)* |
   | Publish directory | `.` |

4. **Deploy**. Em menos de um minuto o site está no ar.

Por último, volte ao Supabase em **Authentication → URL Configuration** e adicione
o endereço do Netlify (ex.: `https://i7even-pedidos.netlify.app`) em **Site URL** e
em **Redirect URLs** - é o que faz o "esqueci minha senha" funcionar.

💡 No celular, abra o site e use **Compartilhar → Adicionar à Tela de Início**.
Ele abre em tela cheia, com cara de aplicativo.

---

## Usando o sistema

### Cadastrar um pedido

Botão **Novo pedido** (ou tecla `N`).

O coração da coisa é o **seletor de produtos**: escolha a categoria e toque no
modelo. Abre a **ficha do aparelho** por cima da grade, com tudo num lugar só:
chips de **capacidade**, **cor**, **condição** (e caixa/pulseira no Apple Watch),
quantidade, valor de venda e custo. Toque em **Adicionar** e o item já entra no
pedido; a grade continua aberta para o próximo.

- O mesmo modelo pode entrar várias vezes (ex.: dois iPhone 15 de cores
  diferentes) - cada toque abre uma ficha nova.
- O número no canto do cartão mostra quantos daquele modelo já estão no pedido,
  e o rodapé soma itens e valor.
- No formulário, toque no item (ou no lápis) para reabrir a ficha e trocar
  qualquer coisa, inclusive cor e capacidade. O botão de **duplicar** cria uma
  cópia com o IMEI em branco, para o segundo aparelho igual.

Fora do catálogo? Categoria **Item avulso**: digita o nome e o preço.

Fechar o formulário com dados preenchidos pede confirmação antes de descartar.

### O funil

`Novo → Aguardando pgto. → Pago → Em preparo → Em entrega → Finalizado`
(e `Cancelado` a qualquer momento).

Na lista, a setinha `›` no fim da linha empurra o pedido para a próxima etapa sem
abrir nada. Dentro do pedido, a trilha de etapas também é clicável.

### Atalhos e recursos

| O quê | Onde |
|---|---|
| `N` | Novo pedido |
| `/` | Focar a busca |
| Busca | Nome, telefone, nº do pedido, IMEI, rastreio, observação |
| Seleção múltipla | Marque vários e mude status / exporte / exclua em lote |
| Modo privacidade | Borra todos os valores em R$ - para conferir a tela em público |
| Tema | Claro, escuro ou automático (segue o aparelho) |
| Imprimir | Gera o comprovante do pedido (ou salva em PDF) |
| Exportar | CSV de pedidos, de itens e de clientes - abre direto no Excel |
| Backup | Ajustes → *Baixar backup (JSON)* |

O sistema também marca sozinho os pedidos **parados há 5+ dias** e os
**urgentes**, e junta tudo no bloco "Precisam de atenção" do painel.

### Pagamento parcelado, sinal e complemento

É o caso mais comum da loja: o cliente manda um sinal no PIX, paga o resto em
duas vezes, às vezes completa em dinheiro na entrega.

Cada entrada vira um **lançamento** com valor, data, forma e observação. Abra o
pedido → **Registrar pagamento**. O valor já vem preenchido com o que falta, e
os atalhos *Tudo / Metade / Um terço* resolvem os casos comuns num toque.

O que o sistema calcula sozinho a partir desses lançamentos:

| Campo | Como sai |
|---|---|
| Já recebido | soma de todos os lançamentos |
| Falta receber | total do pedido - já recebido |
| Situação do pagamento | `Pendente` → `Parcial` → `Pago`, automático |

> **Ninguém digita "já recebido".** Esse número é calculado pelo banco, na hora
> de gravar, a partir da lista de lançamentos. Não existe como a tela mostrar um
> valor e o banco guardar outro.

Isso também separa dois números que o parcelamento descola:

- **Faturamento do período** - o que foi vendido, pela data do pedido
- **Entrou no caixa no período** - o que efetivamente pingou, pela data de cada
  pagamento

Os dois aparecem lado a lado em **Relatórios**. Uma venda de setembro parcelada
em 3× conta inteira no faturamento de setembro, mas entra no caixa de setembro,
outubro e novembro.

### Lucro

Se você preencher o **custo** do item, o sistema calcula:

```
lucro = (produtos - desconto) - custo das mercadorias - frete que você pagou
```

Sem o custo, o campo simplesmente não aparece - não atrapalha quem não quer
controlar isso.

---

## No celular

O sistema foi medido e ajustado em **iPhone 13 (390×844)**, **iPhone 15 (393×852)**
e **iPhone 17 Pro Max (440×956)**, com emulação real de viewport e toque. Em todas
as telas: nenhuma rolagem lateral, nenhum alvo de toque abaixo de 44px, nenhum
campo abaixo de 16px e nenhum texto cortado.

O que muda em relação ao desktop:

| No computador | No celular |
|---|---|
| Menu lateral fixo | Gaveta pelo ☰ + barra de abas embaixo |
| Botão "Novo pedido" na lateral | **Botão flutuante ➕** no canto inferior direito, perto do polegar |
| Tabela de pedidos | Cartões, com caixa de seleção para ações em lote |
| Filtros todos na barra | Chips de status deslizando + botão **Filtros** que abre uma folha |
| Tabela de relatório | Lista empilhada, sem rolar de lado |
| Seção de entrega aberta | Começa recolhida - o cadastro rápido fica curto |
| Busca na barra superior | Segunda linha da barra, sempre do tamanho do dedo |

Detalhes que importam no Safari do iPhone:

- **Nenhum campo com menos de 16px.** Abaixo disso o Safari dá zoom sozinho ao
  focar, e a tela fica torta até você fechar o teclado.
- **`env(safe-area-inset-*)` em tudo.** Topo, gaveta, rodapé de modal e barra de
  abas respeitam a Dynamic Island e a barra de gestos.
- **Sem estado de *hover* grudado.** Em tela de toque o botão não fica "aceso"
  depois do toque; no lugar disso, responde na hora ao ser pressionado.
- **Instale na tela de início** (Compartilhar → Adicionar à Tela de Início) para
  abrir em tela cheia, sem a barra do Safari comendo espaço.

---

## Identidade visual

O sistema usa a marca real da loja, não um placeholder:

- **Logo** - `assets/brand/i7even-avatar-7.svg` (o `7` com gradiente) como ícone, e
  o wordmark `I7even` aplicado como máscara CSS, então ele assume a cor do tema
  automaticamente. Arquivos vindos do brandbook, com os metadados removidos.
- **Sora** para textos e títulos; **IBM Plex Mono** para todo número da operação
  (valores, totais, código do pedido, eixos dos gráficos) e para os rótulos em
  caixa alta - exatamente a regra do brandbook.
- **Superfícies da marca**: `#0e0f11` e `#17181a` no escuro, `#f4f4f2` no claro.

**Uma diferença consciente do brandbook:** a marca é monocromática por decisão de
projeto, mas um painel de operação precisa de cor para funcionar - verde de
"finalizado", âmbar de "aguardando pagamento", azul do botão de ação. Sem isso,
conferir status vira leitura de texto. A cor aqui é **função, não decoração**, e
fica restrita a status e ações; todo o resto do sistema é monocromático. Se
preferir a marca pura também na ferramenta, é só me avisar.

---

## Como a segurança funciona

Pedidos guardam nome, telefone e endereço de clientes. O que protege esses dados:

| Camada | O que faz |
|---|---|
| **RLS no banco** | O banco só devolve linhas para quem está na tabela `store_members` (você e a Julie). Para qualquer outro, a consulta volta vazia - a política roda no Postgres, não no navegador. |
| **Cadastro fechado** | Depois do Passo 2, ninguém mais cria conta. E conta nova sem entrada em `store_members` não enxerga nada. |
| **Chave anon** | É pública por natureza e inútil sem login. A `service_role` não existe neste projeto. |
| **CSP restrita** | O navegador só executa scripts nossos e do jsDelivr, e só conversa com o Supabase e o ViaCEP. Bloqueia injeção de script de terceiros. |
| **HSTS + `frame-ancestors 'none'`** | Só HTTPS, e o painel não pode ser embutido em iframe de ninguém (anti-clickjacking). |
| **Escape de HTML** | Todo dado digitado passa por `esc()` antes de virar HTML - nome de cliente não vira código. |
| **Validação no banco** | Tamanhos máximos, status permitidos e totais recalculados por *trigger*: o navegador não dita o valor final do pedido. |
| **Logout automático** | 30 minutos sem uso e a sessão cai (ajustável em `config.js`). |
| **`noindex`** | Fora dos buscadores. |

### O que foi testado na prática

Com a chave que está publicada no site e **sem nenhum login**, foram tentadas
estas operações contra o projeto real:

| Tentativa | Resultado |
|---|---|
| Ler pedidos | `401 permission denied` |
| Ler nomes e telefones de clientes | `401 permission denied` |
| Ler quem tem acesso (`store_members`) | `401 permission denied` |
| Ler as views de itens e pagamentos | `401 permission denied` |
| Inserir um pedido falso | `401 permission denied` |
| Apagar pedidos | `401 permission denied` |
| Criar uma conta nova | `422 signup_disabled` |
| Entrar com senha errada | `400 invalid_credentials` |

O bloqueio acontece **antes do RLS**, no nível de privilégio: o `schema.sql`
revoga tudo do papel anônimo (`revoke all on public.orders from anon`). O RLS é a
segunda barreira, para quando alguém já está logado.

Também foi feita uma varredura no código atrás de interpolação de HTML sem
escape (XSS) e de segredos versionados. Nenhuma ocorrência: todo dado digitado
passa por `esc()` antes de virar HTML, e nenhuma chave secreta existe no
repositório.

Dá para apertar mais depois, se quiser: ativar **MFA** no Supabase e restringir o
acesso por IP.

---

## Editar o catálogo de produtos

Tudo está em [`assets/js/data/catalog.js`](assets/js/data/catalog.js), em listas
simples. Para acrescentar um modelo:

```js
{ id: 'iphone-19', name: 'iPhone 19', year: 2027,
  storages: ['256GB', '512GB', '1TB'],
  colors: ['Preto', 'Branco'] },
```

Regras:

- O `id` é a chave gravada nos pedidos - **não renomeie** um `id` já usado.
- `todo: true` marca o modelo como "a confirmar" e mostra um aviso discreto na
  interface.

**Atenção à linha iPhone 18:** ela já está cadastrada, mas as **cores e capacidades
são provisórias** (marcadas com `todo: true`) - eu não tinha as especificações
oficiais. Assim que a Apple anunciar, ajuste os valores nesse arquivo. Todo o
restante do catálogo (iPhone 11 até 17 Pro Max, Air e 16e) está com as
especificações reais.

---

## Estrutura dos arquivos

```
.
├── index.html                  página única
├── netlify.toml                publicação + cabeçalhos de segurança
├── manifest.webmanifest        para instalar como app no celular
├── supabase/
│   └── schema.sql              tabela, triggers, RLS e view de relatório
└── assets/
    ├── brand/                  logo oficial (avatar e wordmark)
    ├── css/
    │   ├── tokens.css          cores, tipografia, espaçamento (claro + escuro)
    │   ├── base.css            reset e formulários
    │   ├── layout.css          sidebar, topo, responsivo
    │   ├── components.css      botões, cards, tabela, modal, chips…
    │   ├── charts.css          gráficos
    │   └── mobile.css          ← toda a camada de celular/iOS fica aqui
    └── js/
        ├── config.js           URL e chave do Supabase + ajustes do app
        ├── preload-theme.js    aplica o tema antes da primeira pintura
        ├── app.js              inicialização, navegação e estrutura
        ├── core/
        │   ├── supabase.js     cliente e autenticação
        │   ├── store.js        leitura/escrita de pedidos + sincronização
        │   ├── constants.js    status, pagamentos, canais, envio
        │   └── utils.js        formatação, datas e template seguro (anti-XSS)
        ├── data/
        │   └── catalog.js      ← o catálogo de produtos
        └── ui/
            ├── gate.js             configuração inicial e login
            ├── dashboard.js        painel
            ├── orders.js           lista de pedidos
            ├── order-form.js       cadastro/edição
            ├── order-detail.js     ficha do pedido e impressão
            ├── product-picker.js   seletor de modelos (grade por categoria)
            ├── item-editor.js      ficha do item: capacidade, cor, valores
            ├── payments.js         sinal, parcelas e saldo em aberto
            ├── customers.js        clientes
            ├── reports.js          relatórios
            ├── settings.js         ajustes e backup
            ├── charts.js           gráficos em SVG
            ├── kit.js              modais, toasts, menus
            ├── icons.js            ícones
            └── theme.js            tema e modo privacidade
```

Para rodar na sua máquina:

```bash
python -m http.server 8000
# abra http://localhost:8000
```

(Abrir o `index.html` direto com dois cliques **não funciona** - módulos ES exigem
um servidor.)

---

## Problemas comuns

**"Falta criar a tabela"** - o Passo 1 não rodou. Volte ao SQL Editor e execute o
`schema.sql`.

**"E-mail ou senha incorretos"** - confira se o usuário foi criado em
*Authentication → Users* e está confirmado.

**A tela fica no spinner** - abra o console do navegador (F12). Se aparecer erro de
CSP, é porque você adicionou algum recurso externo novo; libere o endereço em
`netlify.toml`, no `Content-Security-Policy`.

**O CEP não preenche o endereço** - o ViaCEP pode estar fora do ar. Digite o
endereço à mão; nada mais é afetado.

**Mudei um arquivo e o site não atualizou** - dê um *hard refresh*
(`Ctrl + Shift + R`). O `netlify.toml` já manda revalidar a cada visita.
