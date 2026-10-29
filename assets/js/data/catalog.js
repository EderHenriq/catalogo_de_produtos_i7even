/**
 * Catálogo de produtos - i7even Store
 *
 * Estrutura de cada produto:
 *   id       slug único (usado como chave em pedidos salvos - NÃO renomear depois)
 *   name     nome comercial exibido
 *   year     ano de lançamento (usado para ordenar)
 *   storages opções de armazenamento / capacidade
 *   colors   cores de fábrica
 *   sizes    (Watch) tamanhos de caixa
 *   todo     true = specs ainda não confirmadas pela Apple (aparece com aviso na UI)
 *
 * Tudo aqui é editável: acrescentar um modelo é só adicionar um objeto na lista.
 */

export const CONDITIONS = [
  'Lacrado',
  'Novo (caixa aberta)',
  'Vitrine',
  'Seminovo',
  'CPO / Recondicionado',
];

export const ORIGINS = ['Nacional', 'Importado (EUA)', 'Importado (Paraguai)', 'Importado (outro)'];

/* ------------------------------------------------------------------ iPhone */

const IPHONES = [
  { id: 'iphone-11', name: 'iPhone 11', year: 2019,
    storages: ['64GB', '128GB', '256GB'],
    colors: ['Preto', 'Branco', '(PRODUCT)RED', 'Amarelo', 'Verde', 'Roxo'] },
  { id: 'iphone-11-pro', name: 'iPhone 11 Pro', year: 2019,
    storages: ['64GB', '256GB', '512GB'],
    colors: ['Cinza-espacial', 'Prateado', 'Dourado', 'Verde meia-noite'] },
  { id: 'iphone-11-pro-max', name: 'iPhone 11 Pro Max', year: 2019,
    storages: ['64GB', '256GB', '512GB'],
    colors: ['Cinza-espacial', 'Prateado', 'Dourado', 'Verde meia-noite'] },

  { id: 'iphone-12-mini', name: 'iPhone 12 mini', year: 2020,
    storages: ['64GB', '128GB', '256GB'],
    colors: ['Preto', 'Branco', '(PRODUCT)RED', 'Verde', 'Azul', 'Roxo'] },
  { id: 'iphone-12', name: 'iPhone 12', year: 2020,
    storages: ['64GB', '128GB', '256GB'],
    colors: ['Preto', 'Branco', '(PRODUCT)RED', 'Verde', 'Azul', 'Roxo'] },
  { id: 'iphone-12-pro', name: 'iPhone 12 Pro', year: 2020,
    storages: ['128GB', '256GB', '512GB'],
    colors: ['Grafite', 'Prateado', 'Dourado', 'Azul-pacífico'] },
  { id: 'iphone-12-pro-max', name: 'iPhone 12 Pro Max', year: 2020,
    storages: ['128GB', '256GB', '512GB'],
    colors: ['Grafite', 'Prateado', 'Dourado', 'Azul-pacífico'] },

  { id: 'iphone-13-mini', name: 'iPhone 13 mini', year: 2021,
    storages: ['128GB', '256GB', '512GB'],
    colors: ['Meia-noite', 'Estelar', '(PRODUCT)RED', 'Rosa', 'Azul', 'Verde'] },
  { id: 'iphone-13', name: 'iPhone 13', year: 2021,
    storages: ['128GB', '256GB', '512GB'],
    colors: ['Meia-noite', 'Estelar', '(PRODUCT)RED', 'Rosa', 'Azul', 'Verde'] },
  { id: 'iphone-13-pro', name: 'iPhone 13 Pro', year: 2021,
    storages: ['128GB', '256GB', '512GB', '1TB'],
    colors: ['Grafite', 'Prateado', 'Dourado', 'Azul-sierra', 'Verde-alpino'] },
  { id: 'iphone-13-pro-max', name: 'iPhone 13 Pro Max', year: 2021,
    storages: ['128GB', '256GB', '512GB', '1TB'],
    colors: ['Grafite', 'Prateado', 'Dourado', 'Azul-sierra', 'Verde-alpino'] },

  { id: 'iphone-14', name: 'iPhone 14', year: 2022,
    storages: ['128GB', '256GB', '512GB'],
    colors: ['Meia-noite', 'Estelar', '(PRODUCT)RED', 'Azul', 'Roxo', 'Amarelo'] },
  { id: 'iphone-14-plus', name: 'iPhone 14 Plus', year: 2022,
    storages: ['128GB', '256GB', '512GB'],
    colors: ['Meia-noite', 'Estelar', '(PRODUCT)RED', 'Azul', 'Roxo', 'Amarelo'] },
  { id: 'iphone-14-pro', name: 'iPhone 14 Pro', year: 2022,
    storages: ['128GB', '256GB', '512GB', '1TB'],
    colors: ['Preto-espacial', 'Prateado', 'Dourado', 'Roxo-profundo'] },
  { id: 'iphone-14-pro-max', name: 'iPhone 14 Pro Max', year: 2022,
    storages: ['128GB', '256GB', '512GB', '1TB'],
    colors: ['Preto-espacial', 'Prateado', 'Dourado', 'Roxo-profundo'] },

  { id: 'iphone-15', name: 'iPhone 15', year: 2023,
    storages: ['128GB', '256GB', '512GB'],
    colors: ['Preto', 'Azul', 'Verde', 'Amarelo', 'Rosa'] },
  { id: 'iphone-15-plus', name: 'iPhone 15 Plus', year: 2023,
    storages: ['128GB', '256GB', '512GB'],
    colors: ['Preto', 'Azul', 'Verde', 'Amarelo', 'Rosa'] },
  { id: 'iphone-15-pro', name: 'iPhone 15 Pro', year: 2023,
    storages: ['128GB', '256GB', '512GB', '1TB'],
    colors: ['Titânio natural', 'Titânio azul', 'Titânio branco', 'Titânio preto'] },
  { id: 'iphone-15-pro-max', name: 'iPhone 15 Pro Max', year: 2023,
    storages: ['256GB', '512GB', '1TB'],
    colors: ['Titânio natural', 'Titânio azul', 'Titânio branco', 'Titânio preto'] },

  { id: 'iphone-16e', name: 'iPhone 16e', year: 2025,
    storages: ['128GB', '256GB', '512GB'],
    colors: ['Preto', 'Branco'] },
  { id: 'iphone-16', name: 'iPhone 16', year: 2024,
    storages: ['128GB', '256GB', '512GB'],
    colors: ['Preto', 'Branco', 'Rosa', 'Verde-acinzentado', 'Ultramarino'] },
  { id: 'iphone-16-plus', name: 'iPhone 16 Plus', year: 2024,
    storages: ['128GB', '256GB', '512GB'],
    colors: ['Preto', 'Branco', 'Rosa', 'Verde-acinzentado', 'Ultramarino'] },
  { id: 'iphone-16-pro', name: 'iPhone 16 Pro', year: 2024,
    storages: ['128GB', '256GB', '512GB', '1TB'],
    colors: ['Titânio natural', 'Titânio deserto', 'Titânio branco', 'Titânio preto'] },
  { id: 'iphone-16-pro-max', name: 'iPhone 16 Pro Max', year: 2024,
    storages: ['256GB', '512GB', '1TB'],
    colors: ['Titânio natural', 'Titânio deserto', 'Titânio branco', 'Titânio preto'] },

  { id: 'iphone-17', name: 'iPhone 17', year: 2025,
    storages: ['256GB', '512GB'],
    colors: ['Lavanda', 'Névoa', 'Branco', 'Vapor', 'Preto'] },
  { id: 'iphone-air', name: 'iPhone Air', year: 2025,
    storages: ['256GB', '512GB', '1TB'],
    colors: ['Branco-nuvem', 'Dourado-claro', 'Azul-celeste', 'Preto-espacial'] },
  { id: 'iphone-17-pro', name: 'iPhone 17 Pro', year: 2025,
    storages: ['256GB', '512GB', '1TB'],
    colors: ['Laranja-cósmico', 'Azul-profundo', 'Prateado'] },
  { id: 'iphone-17-pro-max', name: 'iPhone 17 Pro Max', year: 2025,
    storages: ['256GB', '512GB', '1TB', '2TB'],
    colors: ['Laranja-cósmico', 'Azul-profundo', 'Prateado'] },

  // Linha 18 - confira cores/capacidades no keynote e ajuste aqui.
  { id: 'iphone-18', name: 'iPhone 18', year: 2026, todo: true,
    storages: ['256GB', '512GB', '1TB'],
    colors: ['Preto', 'Branco', 'Outra cor'] },
  { id: 'iphone-18-air', name: 'iPhone 18 Air', year: 2026, todo: true,
    storages: ['256GB', '512GB', '1TB'],
    colors: ['Preto', 'Branco', 'Outra cor'] },
  { id: 'iphone-18-pro', name: 'iPhone 18 Pro', year: 2026, todo: true,
    storages: ['256GB', '512GB', '1TB'],
    colors: ['Preto', 'Branco', 'Outra cor'] },
  { id: 'iphone-18-pro-max', name: 'iPhone 18 Pro Max', year: 2026, todo: true,
    storages: ['256GB', '512GB', '1TB', '2TB'],
    colors: ['Preto', 'Branco', 'Outra cor'] },
];

/* ------------------------------------------------------------- Apple Watch */

const WATCH_BANDS = ['Esportiva', 'Loop esportiva', 'Loop solo', 'Milanese', 'Trail', 'Alpina', 'Oceano', 'Sem pulseira extra'];

const WATCHES = [
  { id: 'watch-se-2', name: 'Apple Watch SE (2ª ger.)', year: 2022,
    sizes: ['40mm', '44mm'], storages: ['GPS', 'GPS + Cellular'],
    colors: ['Meia-noite', 'Estelar', 'Prateado'] },
  { id: 'watch-se-3', name: 'Apple Watch SE 3', year: 2025,
    sizes: ['40mm', '44mm'], storages: ['GPS', 'GPS + Cellular'],
    colors: ['Meia-noite', 'Estelar'] },
  { id: 'watch-s7', name: 'Apple Watch Series 7', year: 2021,
    sizes: ['41mm', '45mm'], storages: ['GPS', 'GPS + Cellular'],
    colors: ['Meia-noite', 'Estelar', 'Verde', 'Azul', '(PRODUCT)RED', 'Prateado', 'Grafite', 'Dourado'] },
  { id: 'watch-s8', name: 'Apple Watch Series 8', year: 2022,
    sizes: ['41mm', '45mm'], storages: ['GPS', 'GPS + Cellular'],
    colors: ['Meia-noite', 'Estelar', 'Prateado', '(PRODUCT)RED', 'Grafite', 'Dourado'] },
  { id: 'watch-s9', name: 'Apple Watch Series 9', year: 2023,
    sizes: ['41mm', '45mm'], storages: ['GPS', 'GPS + Cellular'],
    colors: ['Meia-noite', 'Estelar', 'Prateado', 'Rosa', '(PRODUCT)RED', 'Grafite', 'Dourado'] },
  { id: 'watch-s10', name: 'Apple Watch Series 10', year: 2024,
    sizes: ['42mm', '46mm'], storages: ['GPS', 'GPS + Cellular'],
    colors: ['Preto-azeviche', 'Ouro-rosé', 'Prateado', 'Titânio natural', 'Titânio dourado', 'Titânio ardósia'] },
  { id: 'watch-s11', name: 'Apple Watch Series 11', year: 2025,
    sizes: ['42mm', '46mm'], storages: ['GPS', 'GPS + Cellular'],
    colors: ['Preto-espacial', 'Ouro-rosé', 'Prateado', 'Titânio natural', 'Titânio dourado', 'Titânio ardósia'] },
  { id: 'watch-ultra', name: 'Apple Watch Ultra', year: 2022,
    sizes: ['49mm'], storages: ['GPS + Cellular'], colors: ['Titânio'] },
  { id: 'watch-ultra-2', name: 'Apple Watch Ultra 2', year: 2023,
    sizes: ['49mm'], storages: ['GPS + Cellular'], colors: ['Titânio natural', 'Titânio preto'] },
  { id: 'watch-ultra-3', name: 'Apple Watch Ultra 3', year: 2025,
    sizes: ['49mm'], storages: ['GPS + Cellular'], colors: ['Titânio natural', 'Titânio preto'] },
];

/* ----------------------------------------------------------------- MacBook */

const MACBOOKS = [
  { id: 'mba-13-m1', name: 'MacBook Air 13" M1', year: 2020,
    storages: ['8GB / 256GB', '8GB / 512GB', '16GB / 512GB', '16GB / 1TB'],
    colors: ['Cinza-espacial', 'Prateado', 'Dourado'] },
  { id: 'mba-13-m2', name: 'MacBook Air 13" M2', year: 2022,
    storages: ['8GB / 256GB', '8GB / 512GB', '16GB / 512GB', '16GB / 1TB', '24GB / 1TB'],
    colors: ['Meia-noite', 'Estelar', 'Cinza-espacial', 'Prateado'] },
  { id: 'mba-15-m2', name: 'MacBook Air 15" M2', year: 2023,
    storages: ['8GB / 256GB', '8GB / 512GB', '16GB / 512GB', '16GB / 1TB', '24GB / 1TB'],
    colors: ['Meia-noite', 'Estelar', 'Cinza-espacial', 'Prateado'] },
  { id: 'mba-13-m3', name: 'MacBook Air 13" M3', year: 2024,
    storages: ['8GB / 256GB', '8GB / 512GB', '16GB / 512GB', '16GB / 1TB', '24GB / 2TB'],
    colors: ['Meia-noite', 'Estelar', 'Cinza-espacial', 'Prateado'] },
  { id: 'mba-15-m3', name: 'MacBook Air 15" M3', year: 2024,
    storages: ['8GB / 256GB', '8GB / 512GB', '16GB / 512GB', '16GB / 1TB', '24GB / 2TB'],
    colors: ['Meia-noite', 'Estelar', 'Cinza-espacial', 'Prateado'] },
  { id: 'mba-13-m4', name: 'MacBook Air 13" M4', year: 2025,
    storages: ['16GB / 256GB', '16GB / 512GB', '24GB / 512GB', '24GB / 1TB', '32GB / 2TB'],
    colors: ['Azul-céu', 'Prateado', 'Estelar', 'Meia-noite'] },
  { id: 'mba-15-m4', name: 'MacBook Air 15" M4', year: 2025,
    storages: ['16GB / 256GB', '16GB / 512GB', '24GB / 512GB', '24GB / 1TB', '32GB / 2TB'],
    colors: ['Azul-céu', 'Prateado', 'Estelar', 'Meia-noite'] },

  { id: 'mbp-14-m1', name: 'MacBook Pro 14" M1 Pro/Max', year: 2021,
    storages: ['16GB / 512GB', '16GB / 1TB', '32GB / 1TB', '32GB / 2TB'],
    colors: ['Cinza-espacial', 'Prateado'] },
  { id: 'mbp-16-m1', name: 'MacBook Pro 16" M1 Pro/Max', year: 2021,
    storages: ['16GB / 512GB', '16GB / 1TB', '32GB / 1TB', '32GB / 2TB'],
    colors: ['Cinza-espacial', 'Prateado'] },
  { id: 'mbp-14-m2', name: 'MacBook Pro 14" M2 Pro/Max', year: 2023,
    storages: ['16GB / 512GB', '16GB / 1TB', '32GB / 1TB', '32GB / 2TB'],
    colors: ['Cinza-espacial', 'Prateado'] },
  { id: 'mbp-16-m2', name: 'MacBook Pro 16" M2 Pro/Max', year: 2023,
    storages: ['16GB / 512GB', '16GB / 1TB', '32GB / 1TB', '32GB / 2TB'],
    colors: ['Cinza-espacial', 'Prateado'] },
  { id: 'mbp-14-m3', name: 'MacBook Pro 14" M3 / Pro / Max', year: 2023,
    storages: ['8GB / 512GB', '16GB / 512GB', '18GB / 1TB', '36GB / 1TB', '36GB / 2TB'],
    colors: ['Preto-espacial', 'Cinza-espacial', 'Prateado'] },
  { id: 'mbp-16-m3', name: 'MacBook Pro 16" M3 Pro / Max', year: 2023,
    storages: ['18GB / 512GB', '18GB / 1TB', '36GB / 1TB', '48GB / 2TB'],
    colors: ['Preto-espacial', 'Prateado'] },
  { id: 'mbp-14-m4', name: 'MacBook Pro 14" M4 / Pro / Max', year: 2024,
    storages: ['16GB / 512GB', '16GB / 1TB', '24GB / 1TB', '36GB / 1TB', '48GB / 2TB'],
    colors: ['Preto-espacial', 'Prateado'] },
  { id: 'mbp-16-m4', name: 'MacBook Pro 16" M4 Pro / Max', year: 2024,
    storages: ['24GB / 512GB', '24GB / 1TB', '36GB / 1TB', '48GB / 2TB', '64GB / 2TB'],
    colors: ['Preto-espacial', 'Prateado'] },
];

/* -------------------------------------------------------------------- iPad */

const IPADS = [
  { id: 'ipad-9', name: 'iPad (9ª ger.)', year: 2021,
    storages: ['64GB Wi-Fi', '64GB Wi-Fi + Cellular', '256GB Wi-Fi', '256GB Wi-Fi + Cellular'],
    colors: ['Cinza-espacial', 'Prateado'] },
  { id: 'ipad-10', name: 'iPad (10ª ger.)', year: 2022,
    storages: ['64GB Wi-Fi', '64GB Wi-Fi + Cellular', '256GB Wi-Fi', '256GB Wi-Fi + Cellular'],
    colors: ['Prateado', 'Azul', 'Rosa', 'Amarelo'] },
  { id: 'ipad-11', name: 'iPad (A16, 11ª ger.)', year: 2025,
    storages: ['128GB Wi-Fi', '256GB Wi-Fi', '512GB Wi-Fi', '128GB Wi-Fi + Cellular', '256GB Wi-Fi + Cellular'],
    colors: ['Prateado', 'Azul', 'Rosa', 'Amarelo'] },
  { id: 'ipad-mini-6', name: 'iPad mini (6ª ger.)', year: 2021,
    storages: ['64GB Wi-Fi', '256GB Wi-Fi', '64GB Wi-Fi + Cellular', '256GB Wi-Fi + Cellular'],
    colors: ['Cinza-espacial', 'Estelar', 'Rosa', 'Roxo'] },
  { id: 'ipad-mini-7', name: 'iPad mini (A17 Pro)', year: 2024,
    storages: ['128GB Wi-Fi', '256GB Wi-Fi', '512GB Wi-Fi', '128GB Wi-Fi + Cellular', '256GB Wi-Fi + Cellular'],
    colors: ['Cinza-espacial', 'Estelar', 'Roxo', 'Azul'] },
  { id: 'ipad-air-m1', name: 'iPad Air M1 (5ª ger.)', year: 2022,
    storages: ['64GB Wi-Fi', '256GB Wi-Fi', '64GB Wi-Fi + Cellular', '256GB Wi-Fi + Cellular'],
    colors: ['Cinza-espacial', 'Estelar', 'Rosa', 'Roxo', 'Azul'] },
  { id: 'ipad-air-m2', name: 'iPad Air M2 (11" / 13")', year: 2024,
    storages: ['128GB', '256GB', '512GB', '1TB'],
    colors: ['Cinza-espacial', 'Estelar', 'Roxo', 'Azul'] },
  { id: 'ipad-air-m3', name: 'iPad Air M3 (11" / 13")', year: 2025,
    storages: ['128GB', '256GB', '512GB', '1TB'],
    colors: ['Cinza-espacial', 'Estelar', 'Roxo', 'Azul'] },
  { id: 'ipad-pro-m2', name: 'iPad Pro M2 (11" / 12,9")', year: 2022,
    storages: ['128GB', '256GB', '512GB', '1TB', '2TB'],
    colors: ['Cinza-espacial', 'Prateado'] },
  { id: 'ipad-pro-m4', name: 'iPad Pro M4 (11" / 13")', year: 2024,
    storages: ['256GB', '512GB', '1TB', '2TB'],
    colors: ['Preto-espacial', 'Prateado'] },
  { id: 'ipad-pro-m5', name: 'iPad Pro M5 (11" / 13")', year: 2025, todo: true,
    storages: ['256GB', '512GB', '1TB', '2TB'],
    colors: ['Preto-espacial', 'Prateado'] },
];

/* ----------------------------------------------------------------- AirPods */

const AIRPODS = [
  { id: 'airpods-2', name: 'AirPods (2ª ger.)', year: 2019, storages: ['Padrão'], colors: ['Branco'] },
  { id: 'airpods-3', name: 'AirPods (3ª ger.)', year: 2021, storages: ['Lightning', 'MagSafe USB-C'], colors: ['Branco'] },
  { id: 'airpods-4', name: 'AirPods 4', year: 2024, storages: ['Sem cancelamento', 'Com cancelamento de ruído'], colors: ['Branco'] },
  { id: 'airpods-pro-2', name: 'AirPods Pro 2', year: 2022, storages: ['Lightning', 'USB-C'], colors: ['Branco'] },
  { id: 'airpods-pro-3', name: 'AirPods Pro 3', year: 2025, storages: ['USB-C'], colors: ['Branco'] },
  { id: 'airpods-max', name: 'AirPods Max', year: 2020, storages: ['Lightning', 'USB-C'],
    colors: ['Cinza-espacial', 'Prateado', 'Verde', 'Azul-céu', 'Rosa', 'Meia-noite', 'Estelar', 'Roxo', 'Laranja'] },
];

/* ---------------------------------------------------------------- Consoles */

const CONSOLES = [
  // PS5: VERSÃO (com leitor de disco ou digital) e ARMAZENAMENTO separados
  { id: 'ps5-slim', name: 'PlayStation 5 Slim', year: 2023, sizes: ['Com leitor de disco', 'Digital (sem leitor)'], storages: ['1TB', '825GB'], colors: ['Branco'] },
  { id: 'ps5-pro', name: 'PlayStation 5 Pro', year: 2024, sizes: ['Digital (leitor vendido à parte)', 'Com leitor de disco'], storages: ['2TB'], colors: ['Branco'] },
  { id: 'ps5-fat', name: 'PlayStation 5 (modelo antigo)', year: 2020, sizes: ['Com leitor de disco', 'Digital (sem leitor)'], storages: ['825GB'], colors: ['Branco'] },
  { id: 'ps-portal', name: 'PlayStation Portal', year: 2023, storages: ['Padrão'], colors: ['Branco'] },
  { id: 'dualsense', name: 'Controle DualSense', year: 2020, storages: ['Padrão', 'Edge'],
    colors: ['Branco', 'Preto', 'Vermelho', 'Azul', 'Roxo', 'Cinza camuflado', 'Outra cor'] },
  { id: 'xbox-series-x', name: 'Xbox Series X', year: 2020, storages: ['1TB', '2TB Galaxy Black', 'Digital 1TB'], colors: ['Preto', 'Branco'] },
  { id: 'xbox-series-s', name: 'Xbox Series S', year: 2020, storages: ['512GB', '1TB'], colors: ['Branco', 'Preto'] },
  { id: 'xbox-controller', name: 'Controle Xbox Wireless', year: 2020, storages: ['Padrão', 'Elite Series 2'],
    colors: ['Preto', 'Branco', 'Azul', 'Vermelho', 'Outra cor'] },
  { id: 'switch-oled', name: 'Nintendo Switch OLED', year: 2021, storages: ['64GB'], colors: ['Branco', 'Neon', 'Edição especial'] },
  { id: 'switch-lite', name: 'Nintendo Switch Lite', year: 2019, storages: ['32GB'], colors: ['Turquesa', 'Cinza', 'Coral', 'Amarelo', 'Azul'] },
  { id: 'switch-2', name: 'Nintendo Switch 2', year: 2025, storages: ['256GB'], colors: ['Padrão'] },
  { id: 'game-avulso', name: 'Jogo / mídia física', year: 2020, storages: ['PS5', 'PS4', 'Xbox', 'Switch', 'Switch 2'], colors: ['-'] },
];

/* ---------------------------------------------------------------- Perfumes */

const PERFUME_SIZES = ['30ml', '50ml', '75ml', '100ml', '125ml', '150ml', '200ml', 'Decant 5ml', 'Decant 10ml'];
const PERFUME_TYPES = ['EDP', 'EDT', 'Parfum / Extrait', 'Cologne', 'Body Splash'];

const PERFUMES = [
  { id: 'perfume-generico', name: 'Perfume importado (digitar marca)', year: 2020,
    storages: PERFUME_SIZES, colors: PERFUME_TYPES, freeName: true },
  { id: 'perfume-dior-sauvage', name: 'Dior Sauvage', year: 2015, storages: PERFUME_SIZES, colors: PERFUME_TYPES },
  { id: 'perfume-bleu-chanel', name: 'Chanel Bleu de Chanel', year: 2010, storages: PERFUME_SIZES, colors: PERFUME_TYPES },
  { id: 'perfume-1million', name: 'Paco Rabanne 1 Million', year: 2008, storages: PERFUME_SIZES, colors: PERFUME_TYPES },
  { id: 'perfume-invictus', name: 'Paco Rabanne Invictus', year: 2013, storages: PERFUME_SIZES, colors: PERFUME_TYPES },
  { id: 'perfume-phantom', name: 'Paco Rabanne Phantom', year: 2021, storages: PERFUME_SIZES, colors: PERFUME_TYPES },
  { id: 'perfume-ysl-y', name: 'Yves Saint Laurent Y', year: 2017, storages: PERFUME_SIZES, colors: PERFUME_TYPES },
  { id: 'perfume-la-nuit', name: 'YSL La Nuit de L’Homme', year: 2009, storages: PERFUME_SIZES, colors: PERFUME_TYPES },
  { id: 'perfume-libre', name: 'YSL Libre', year: 2019, storages: PERFUME_SIZES, colors: PERFUME_TYPES },
  { id: 'perfume-good-girl', name: 'Carolina Herrera Good Girl', year: 2016, storages: PERFUME_SIZES, colors: PERFUME_TYPES },
  { id: 'perfume-212-vip', name: 'Carolina Herrera 212 VIP', year: 2010, storages: PERFUME_SIZES, colors: PERFUME_TYPES },
  { id: 'perfume-scandal', name: 'Jean Paul Gaultier Scandal', year: 2017, storages: PERFUME_SIZES, colors: PERFUME_TYPES },
  { id: 'perfume-le-male', name: 'Jean Paul Gaultier Le Male', year: 1995, storages: PERFUME_SIZES, colors: PERFUME_TYPES },
  { id: 'perfume-eros', name: 'Versace Eros', year: 2012, storages: PERFUME_SIZES, colors: PERFUME_TYPES },
  { id: 'perfume-dylan-blue', name: 'Versace Dylan Blue', year: 2016, storages: PERFUME_SIZES, colors: PERFUME_TYPES },
  { id: 'perfume-boss-bottled', name: 'Hugo Boss Bottled', year: 1998, storages: PERFUME_SIZES, colors: PERFUME_TYPES },
  { id: 'perfume-acqua-gio', name: 'Giorgio Armani Acqua di Giò', year: 1996, storages: PERFUME_SIZES, colors: PERFUME_TYPES },
  { id: 'perfume-stronger', name: 'Emporio Armani Stronger With You', year: 2017, storages: PERFUME_SIZES, colors: PERFUME_TYPES },
  { id: 'perfume-lattractive', name: 'Lattafa Asad / Khamrah / Yara', year: 2022, storages: PERFUME_SIZES, colors: PERFUME_TYPES },
  { id: 'perfume-baccarat', name: 'MFK Baccarat Rouge 540', year: 2015, storages: PERFUME_SIZES, colors: PERFUME_TYPES },
];

/* ------------------------------------------------------------- Acessórios  */

const ACESSORIOS = [
  { id: 'apple-pencil', name: 'Apple Pencil', year: 2022, storages: ['1ª ger.', '2ª ger.', 'USB-C', 'Pro'], colors: ['Branco'] },
  { id: 'magic-keyboard', name: 'Magic Keyboard / Smart Folio', year: 2022, storages: ['11"', '12,9"', '13"'], colors: ['Preto', 'Branco'] },
  { id: 'carregador', name: 'Carregador / cabo Apple', year: 2021, storages: ['20W', '30W', '35W', '70W', '96W', 'Cabo USB-C'], colors: ['Branco'] },
  { id: 'magsafe', name: 'Carregador MagSafe', year: 2020, storages: ['MagSafe', 'MagSafe Duo', 'Battery Pack'], colors: ['Branco', 'Preto'] },
  { id: 'capa', name: 'Capa / Case', year: 2021, storages: ['Silicone', 'Transparente', 'Couro', 'FineWoven', 'Outra'], colors: ['Diversas'] },
  { id: 'pelicula', name: 'Película', year: 2021, storages: ['Vidro 3D', 'Privacidade', 'Hidrogel', 'Câmera'], colors: ['-'] },
  { id: 'airtag', name: 'AirTag', year: 2021, storages: ['Unidade', 'Pack com 4'], colors: ['Branco'] },
];

/* ---------------------------------------------------------------- Catálogo */

export const CATALOG = [
  { id: 'iphone',    label: 'iPhone',       emoji: '📱', variantLabel: 'Armazenamento', products: IPHONES },
  { id: 'watch',     label: 'Apple Watch',  emoji: '⌚️', variantLabel: 'Conectividade', sizeLabel: 'Caixa', bands: WATCH_BANDS, products: WATCHES },
  { id: 'macbook',   label: 'MacBook',      emoji: '💻', variantLabel: 'RAM / SSD',     products: MACBOOKS },
  { id: 'ipad',      label: 'iPad',         emoji: '📋', variantLabel: 'Armazenamento', products: IPADS },
  { id: 'airpods',   label: 'AirPods',      emoji: '🎧', variantLabel: 'Versão',        products: AIRPODS },
  { id: 'console',   label: 'Consoles',     emoji: '🎮', variantLabel: 'Armazenamento', sizeLabel: 'Versão', products: CONSOLES },
  { id: 'perfume',   label: 'Perfumes',     emoji: '🧴', variantLabel: 'Tamanho', colorLabel: 'Concentração', products: PERFUMES },
  { id: 'acessorio', label: 'Acessórios',   emoji: '🔌', variantLabel: 'Tipo',          products: ACESSORIOS },
];

/** Categoria "curinga": item digitado na mão, fora do catálogo. */
export const FREE_CATEGORY = { id: 'outro', label: 'Item avulso', emoji: '✏️' };

/* ------------------------------------------------------------------ Helpers */

const INDEX = new Map();
for (const cat of CATALOG) {
  for (const p of cat.products) INDEX.set(p.id, { ...p, categoryId: cat.id, category: cat });
}

export function findProduct(id) {
  return INDEX.get(id) || null;
}

export function findCategory(id) {
  return CATALOG.find((c) => c.id === id) || null;
}

/** Busca simples por nome, sem acento e sem diferenciar maiúscula. */
export function searchProducts(term, categoryId = null) {
  const q = normalize(term);
  let list = [...INDEX.values()];
  if (categoryId) list = list.filter((p) => p.categoryId === categoryId);
  if (!q) return list;
  return list.filter((p) => normalize(p.name).includes(q));
}

export function normalize(str = '') {
  return String(str).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

/** Rótulo curto de um item de pedido: "iPhone 15 Pro · 256GB · Titânio azul". */
export function itemLabel(item) {
  return [item.productName, item.variant, item.color].filter(Boolean).join(' · ');
}
