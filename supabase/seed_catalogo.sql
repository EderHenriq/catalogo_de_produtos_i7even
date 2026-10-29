-- =====================================================================
--  i7even Store - catálogo inicial (categorias + modelos)
--
--  Rode DEPOIS do schema.sql. Pode rodar de novo sem medo: o que já existe
--  (pelo slug) não é tocado - nada que a loja editou é sobrescrito.
--  Gerado a partir do catálogo da v1 (assets/js/data/catalog.js).
--  Modelos marcados "a confirmar" (needs_review) têm cores/capacidades
--  provisórias: confira no cadastro antes de vender.
-- =====================================================================

insert into public.categories (slug, name, emoji, description, variant_label, color_label, size_label, tracks_serial, bands, sort)
values
  ('iphone', 'iPhone', '📱', 'iPhones lacrados, seminovos e vitrine, com garantia.', 'Armazenamento', 'Cor', 'Tamanho', true, array[]::text[], 10),
  ('watch', 'Apple Watch', '⌚️', 'Apple Watch de todas as gerações.', 'Conectividade', 'Cor', 'Caixa', true, array['Esportiva', 'Loop esportiva', 'Loop solo', 'Milanese', 'Trail', 'Alpina', 'Oceano', 'Sem pulseira extra']::text[], 20),
  ('macbook', 'MacBook', '💻', 'MacBook Air e Pro.', 'RAM / SSD', 'Cor', 'Tamanho', true, array[]::text[], 30),
  ('ipad', 'iPad', '📋', 'iPad, iPad Air, iPad mini e iPad Pro.', 'Armazenamento', 'Cor', 'Tamanho', true, array[]::text[], 40),
  ('airpods', 'AirPods', '🎧', 'AirPods e AirPods Pro originais.', 'Versão', 'Cor', 'Tamanho', false, array[]::text[], 50),
  ('console', 'Consoles', '🎮', 'PlayStation, Xbox e Nintendo.', 'Armazenamento', 'Cor', 'Versão', true, array[]::text[], 60),
  ('perfume', 'Perfumes', '🧴', 'Perfumes importados originais.', 'Tamanho', 'Concentração', 'Tamanho', false, array[]::text[], 70),
  ('acessorio', 'Acessórios', '🔌', 'Carregadores, capas, películas e mais.', 'Tipo', 'Cor', 'Tamanho', false, array[]::text[], 80)
on conflict (slug) do nothing;

insert into public.products (slug, category_id, name, brand, year, storages, colors, sizes, tracks_serial, needs_review)
select x.slug, c.id, x.name, x.brand, x.year, x.storages, x.colors, x.sizes, c.tracks_serial, x.review
from (values
  ('iphone-11', 'iphone', 'iPhone 11', 'Apple', 2019::smallint, array['64GB', '128GB', '256GB']::text[], array['Preto', 'Branco', '(PRODUCT)RED', 'Amarelo', 'Verde', 'Roxo']::text[], array[]::text[], false),
  ('iphone-11-pro', 'iphone', 'iPhone 11 Pro', 'Apple', 2019::smallint, array['64GB', '256GB', '512GB']::text[], array['Cinza-espacial', 'Prateado', 'Dourado', 'Verde meia-noite']::text[], array[]::text[], false),
  ('iphone-11-pro-max', 'iphone', 'iPhone 11 Pro Max', 'Apple', 2019::smallint, array['64GB', '256GB', '512GB']::text[], array['Cinza-espacial', 'Prateado', 'Dourado', 'Verde meia-noite']::text[], array[]::text[], false),
  ('iphone-12-mini', 'iphone', 'iPhone 12 mini', 'Apple', 2020::smallint, array['64GB', '128GB', '256GB']::text[], array['Preto', 'Branco', '(PRODUCT)RED', 'Verde', 'Azul', 'Roxo']::text[], array[]::text[], false),
  ('iphone-12', 'iphone', 'iPhone 12', 'Apple', 2020::smallint, array['64GB', '128GB', '256GB']::text[], array['Preto', 'Branco', '(PRODUCT)RED', 'Verde', 'Azul', 'Roxo']::text[], array[]::text[], false),
  ('iphone-12-pro', 'iphone', 'iPhone 12 Pro', 'Apple', 2020::smallint, array['128GB', '256GB', '512GB']::text[], array['Grafite', 'Prateado', 'Dourado', 'Azul-pacífico']::text[], array[]::text[], false),
  ('iphone-12-pro-max', 'iphone', 'iPhone 12 Pro Max', 'Apple', 2020::smallint, array['128GB', '256GB', '512GB']::text[], array['Grafite', 'Prateado', 'Dourado', 'Azul-pacífico']::text[], array[]::text[], false),
  ('iphone-13-mini', 'iphone', 'iPhone 13 mini', 'Apple', 2021::smallint, array['128GB', '256GB', '512GB']::text[], array['Meia-noite', 'Estelar', '(PRODUCT)RED', 'Rosa', 'Azul', 'Verde']::text[], array[]::text[], false),
  ('iphone-13', 'iphone', 'iPhone 13', 'Apple', 2021::smallint, array['128GB', '256GB', '512GB']::text[], array['Meia-noite', 'Estelar', '(PRODUCT)RED', 'Rosa', 'Azul', 'Verde']::text[], array[]::text[], false),
  ('iphone-13-pro', 'iphone', 'iPhone 13 Pro', 'Apple', 2021::smallint, array['128GB', '256GB', '512GB', '1TB']::text[], array['Grafite', 'Prateado', 'Dourado', 'Azul-sierra', 'Verde-alpino']::text[], array[]::text[], false),
  ('iphone-13-pro-max', 'iphone', 'iPhone 13 Pro Max', 'Apple', 2021::smallint, array['128GB', '256GB', '512GB', '1TB']::text[], array['Grafite', 'Prateado', 'Dourado', 'Azul-sierra', 'Verde-alpino']::text[], array[]::text[], false),
  ('iphone-14', 'iphone', 'iPhone 14', 'Apple', 2022::smallint, array['128GB', '256GB', '512GB']::text[], array['Meia-noite', 'Estelar', '(PRODUCT)RED', 'Azul', 'Roxo', 'Amarelo']::text[], array[]::text[], false),
  ('iphone-14-plus', 'iphone', 'iPhone 14 Plus', 'Apple', 2022::smallint, array['128GB', '256GB', '512GB']::text[], array['Meia-noite', 'Estelar', '(PRODUCT)RED', 'Azul', 'Roxo', 'Amarelo']::text[], array[]::text[], false),
  ('iphone-14-pro', 'iphone', 'iPhone 14 Pro', 'Apple', 2022::smallint, array['128GB', '256GB', '512GB', '1TB']::text[], array['Preto-espacial', 'Prateado', 'Dourado', 'Roxo-profundo']::text[], array[]::text[], false),
  ('iphone-14-pro-max', 'iphone', 'iPhone 14 Pro Max', 'Apple', 2022::smallint, array['128GB', '256GB', '512GB', '1TB']::text[], array['Preto-espacial', 'Prateado', 'Dourado', 'Roxo-profundo']::text[], array[]::text[], false),
  ('iphone-15', 'iphone', 'iPhone 15', 'Apple', 2023::smallint, array['128GB', '256GB', '512GB']::text[], array['Preto', 'Azul', 'Verde', 'Amarelo', 'Rosa']::text[], array[]::text[], false),
  ('iphone-15-plus', 'iphone', 'iPhone 15 Plus', 'Apple', 2023::smallint, array['128GB', '256GB', '512GB']::text[], array['Preto', 'Azul', 'Verde', 'Amarelo', 'Rosa']::text[], array[]::text[], false),
  ('iphone-15-pro', 'iphone', 'iPhone 15 Pro', 'Apple', 2023::smallint, array['128GB', '256GB', '512GB', '1TB']::text[], array['Titânio natural', 'Titânio azul', 'Titânio branco', 'Titânio preto']::text[], array[]::text[], false),
  ('iphone-15-pro-max', 'iphone', 'iPhone 15 Pro Max', 'Apple', 2023::smallint, array['256GB', '512GB', '1TB']::text[], array['Titânio natural', 'Titânio azul', 'Titânio branco', 'Titânio preto']::text[], array[]::text[], false),
  ('iphone-16e', 'iphone', 'iPhone 16e', 'Apple', 2025::smallint, array['128GB', '256GB', '512GB']::text[], array['Preto', 'Branco']::text[], array[]::text[], false),
  ('iphone-16', 'iphone', 'iPhone 16', 'Apple', 2024::smallint, array['128GB', '256GB', '512GB']::text[], array['Preto', 'Branco', 'Rosa', 'Verde-acinzentado', 'Ultramarino']::text[], array[]::text[], false),
  ('iphone-16-plus', 'iphone', 'iPhone 16 Plus', 'Apple', 2024::smallint, array['128GB', '256GB', '512GB']::text[], array['Preto', 'Branco', 'Rosa', 'Verde-acinzentado', 'Ultramarino']::text[], array[]::text[], false),
  ('iphone-16-pro', 'iphone', 'iPhone 16 Pro', 'Apple', 2024::smallint, array['128GB', '256GB', '512GB', '1TB']::text[], array['Titânio natural', 'Titânio deserto', 'Titânio branco', 'Titânio preto']::text[], array[]::text[], false),
  ('iphone-16-pro-max', 'iphone', 'iPhone 16 Pro Max', 'Apple', 2024::smallint, array['256GB', '512GB', '1TB']::text[], array['Titânio natural', 'Titânio deserto', 'Titânio branco', 'Titânio preto']::text[], array[]::text[], false),
  ('iphone-17', 'iphone', 'iPhone 17', 'Apple', 2025::smallint, array['256GB', '512GB']::text[], array['Lavanda', 'Névoa', 'Branco', 'Vapor', 'Preto']::text[], array[]::text[], false),
  ('iphone-air', 'iphone', 'iPhone Air', 'Apple', 2025::smallint, array['256GB', '512GB', '1TB']::text[], array['Branco-nuvem', 'Dourado-claro', 'Azul-celeste', 'Preto-espacial']::text[], array[]::text[], false),
  ('iphone-17-pro', 'iphone', 'iPhone 17 Pro', 'Apple', 2025::smallint, array['256GB', '512GB', '1TB']::text[], array['Laranja-cósmico', 'Azul-profundo', 'Prateado']::text[], array[]::text[], false),
  ('iphone-17-pro-max', 'iphone', 'iPhone 17 Pro Max', 'Apple', 2025::smallint, array['256GB', '512GB', '1TB', '2TB']::text[], array['Laranja-cósmico', 'Azul-profundo', 'Prateado']::text[], array[]::text[], false),
  ('iphone-18', 'iphone', 'iPhone 18', 'Apple', 2026::smallint, array['256GB', '512GB', '1TB']::text[], array['Preto', 'Branco', 'Outra cor']::text[], array[]::text[], true),
  ('iphone-18-air', 'iphone', 'iPhone 18 Air', 'Apple', 2026::smallint, array['256GB', '512GB', '1TB']::text[], array['Preto', 'Branco', 'Outra cor']::text[], array[]::text[], true),
  ('iphone-18-pro', 'iphone', 'iPhone 18 Pro', 'Apple', 2026::smallint, array['256GB', '512GB', '1TB']::text[], array['Preto', 'Branco', 'Outra cor']::text[], array[]::text[], true),
  ('iphone-18-pro-max', 'iphone', 'iPhone 18 Pro Max', 'Apple', 2026::smallint, array['256GB', '512GB', '1TB', '2TB']::text[], array['Preto', 'Branco', 'Outra cor']::text[], array[]::text[], true),
  ('watch-se-2', 'watch', 'Apple Watch SE (2ª ger.)', 'Apple', 2022::smallint, array['GPS', 'GPS + Cellular']::text[], array['Meia-noite', 'Estelar', 'Prateado']::text[], array['40mm', '44mm']::text[], false),
  ('watch-se-3', 'watch', 'Apple Watch SE 3', 'Apple', 2025::smallint, array['GPS', 'GPS + Cellular']::text[], array['Meia-noite', 'Estelar']::text[], array['40mm', '44mm']::text[], false),
  ('watch-s7', 'watch', 'Apple Watch Series 7', 'Apple', 2021::smallint, array['GPS', 'GPS + Cellular']::text[], array['Meia-noite', 'Estelar', 'Verde', 'Azul', '(PRODUCT)RED', 'Prateado', 'Grafite', 'Dourado']::text[], array['41mm', '45mm']::text[], false),
  ('watch-s8', 'watch', 'Apple Watch Series 8', 'Apple', 2022::smallint, array['GPS', 'GPS + Cellular']::text[], array['Meia-noite', 'Estelar', 'Prateado', '(PRODUCT)RED', 'Grafite', 'Dourado']::text[], array['41mm', '45mm']::text[], false),
  ('watch-s9', 'watch', 'Apple Watch Series 9', 'Apple', 2023::smallint, array['GPS', 'GPS + Cellular']::text[], array['Meia-noite', 'Estelar', 'Prateado', 'Rosa', '(PRODUCT)RED', 'Grafite', 'Dourado']::text[], array['41mm', '45mm']::text[], false),
  ('watch-s10', 'watch', 'Apple Watch Series 10', 'Apple', 2024::smallint, array['GPS', 'GPS + Cellular']::text[], array['Preto-azeviche', 'Ouro-rosé', 'Prateado', 'Titânio natural', 'Titânio dourado', 'Titânio ardósia']::text[], array['42mm', '46mm']::text[], false),
  ('watch-s11', 'watch', 'Apple Watch Series 11', 'Apple', 2025::smallint, array['GPS', 'GPS + Cellular']::text[], array['Preto-espacial', 'Ouro-rosé', 'Prateado', 'Titânio natural', 'Titânio dourado', 'Titânio ardósia']::text[], array['42mm', '46mm']::text[], false),
  ('watch-ultra', 'watch', 'Apple Watch Ultra', 'Apple', 2022::smallint, array['GPS + Cellular']::text[], array['Titânio']::text[], array['49mm']::text[], false),
  ('watch-ultra-2', 'watch', 'Apple Watch Ultra 2', 'Apple', 2023::smallint, array['GPS + Cellular']::text[], array['Titânio natural', 'Titânio preto']::text[], array['49mm']::text[], false),
  ('watch-ultra-3', 'watch', 'Apple Watch Ultra 3', 'Apple', 2025::smallint, array['GPS + Cellular']::text[], array['Titânio natural', 'Titânio preto']::text[], array['49mm']::text[], false),
  ('mba-13-m1', 'macbook', 'MacBook Air 13" M1', 'Apple', 2020::smallint, array['8GB / 256GB', '8GB / 512GB', '16GB / 512GB', '16GB / 1TB']::text[], array['Cinza-espacial', 'Prateado', 'Dourado']::text[], array[]::text[], false),
  ('mba-13-m2', 'macbook', 'MacBook Air 13" M2', 'Apple', 2022::smallint, array['8GB / 256GB', '8GB / 512GB', '16GB / 512GB', '16GB / 1TB', '24GB / 1TB']::text[], array['Meia-noite', 'Estelar', 'Cinza-espacial', 'Prateado']::text[], array[]::text[], false),
  ('mba-15-m2', 'macbook', 'MacBook Air 15" M2', 'Apple', 2023::smallint, array['8GB / 256GB', '8GB / 512GB', '16GB / 512GB', '16GB / 1TB', '24GB / 1TB']::text[], array['Meia-noite', 'Estelar', 'Cinza-espacial', 'Prateado']::text[], array[]::text[], false),
  ('mba-13-m3', 'macbook', 'MacBook Air 13" M3', 'Apple', 2024::smallint, array['8GB / 256GB', '8GB / 512GB', '16GB / 512GB', '16GB / 1TB', '24GB / 2TB']::text[], array['Meia-noite', 'Estelar', 'Cinza-espacial', 'Prateado']::text[], array[]::text[], false),
  ('mba-15-m3', 'macbook', 'MacBook Air 15" M3', 'Apple', 2024::smallint, array['8GB / 256GB', '8GB / 512GB', '16GB / 512GB', '16GB / 1TB', '24GB / 2TB']::text[], array['Meia-noite', 'Estelar', 'Cinza-espacial', 'Prateado']::text[], array[]::text[], false),
  ('mba-13-m4', 'macbook', 'MacBook Air 13" M4', 'Apple', 2025::smallint, array['16GB / 256GB', '16GB / 512GB', '24GB / 512GB', '24GB / 1TB', '32GB / 2TB']::text[], array['Azul-céu', 'Prateado', 'Estelar', 'Meia-noite']::text[], array[]::text[], false),
  ('mba-15-m4', 'macbook', 'MacBook Air 15" M4', 'Apple', 2025::smallint, array['16GB / 256GB', '16GB / 512GB', '24GB / 512GB', '24GB / 1TB', '32GB / 2TB']::text[], array['Azul-céu', 'Prateado', 'Estelar', 'Meia-noite']::text[], array[]::text[], false),
  ('mbp-14-m1', 'macbook', 'MacBook Pro 14" M1 Pro/Max', 'Apple', 2021::smallint, array['16GB / 512GB', '16GB / 1TB', '32GB / 1TB', '32GB / 2TB']::text[], array['Cinza-espacial', 'Prateado']::text[], array[]::text[], false),
  ('mbp-16-m1', 'macbook', 'MacBook Pro 16" M1 Pro/Max', 'Apple', 2021::smallint, array['16GB / 512GB', '16GB / 1TB', '32GB / 1TB', '32GB / 2TB']::text[], array['Cinza-espacial', 'Prateado']::text[], array[]::text[], false),
  ('mbp-14-m2', 'macbook', 'MacBook Pro 14" M2 Pro/Max', 'Apple', 2023::smallint, array['16GB / 512GB', '16GB / 1TB', '32GB / 1TB', '32GB / 2TB']::text[], array['Cinza-espacial', 'Prateado']::text[], array[]::text[], false),
  ('mbp-16-m2', 'macbook', 'MacBook Pro 16" M2 Pro/Max', 'Apple', 2023::smallint, array['16GB / 512GB', '16GB / 1TB', '32GB / 1TB', '32GB / 2TB']::text[], array['Cinza-espacial', 'Prateado']::text[], array[]::text[], false),
  ('mbp-14-m3', 'macbook', 'MacBook Pro 14" M3 / Pro / Max', 'Apple', 2023::smallint, array['8GB / 512GB', '16GB / 512GB', '18GB / 1TB', '36GB / 1TB', '36GB / 2TB']::text[], array['Preto-espacial', 'Cinza-espacial', 'Prateado']::text[], array[]::text[], false),
  ('mbp-16-m3', 'macbook', 'MacBook Pro 16" M3 Pro / Max', 'Apple', 2023::smallint, array['18GB / 512GB', '18GB / 1TB', '36GB / 1TB', '48GB / 2TB']::text[], array['Preto-espacial', 'Prateado']::text[], array[]::text[], false),
  ('mbp-14-m4', 'macbook', 'MacBook Pro 14" M4 / Pro / Max', 'Apple', 2024::smallint, array['16GB / 512GB', '16GB / 1TB', '24GB / 1TB', '36GB / 1TB', '48GB / 2TB']::text[], array['Preto-espacial', 'Prateado']::text[], array[]::text[], false),
  ('mbp-16-m4', 'macbook', 'MacBook Pro 16" M4 Pro / Max', 'Apple', 2024::smallint, array['24GB / 512GB', '24GB / 1TB', '36GB / 1TB', '48GB / 2TB', '64GB / 2TB']::text[], array['Preto-espacial', 'Prateado']::text[], array[]::text[], false),
  ('ipad-9', 'ipad', 'iPad (9ª ger.)', 'Apple', 2021::smallint, array['64GB Wi-Fi', '64GB Wi-Fi + Cellular', '256GB Wi-Fi', '256GB Wi-Fi + Cellular']::text[], array['Cinza-espacial', 'Prateado']::text[], array[]::text[], false),
  ('ipad-10', 'ipad', 'iPad (10ª ger.)', 'Apple', 2022::smallint, array['64GB Wi-Fi', '64GB Wi-Fi + Cellular', '256GB Wi-Fi', '256GB Wi-Fi + Cellular']::text[], array['Prateado', 'Azul', 'Rosa', 'Amarelo']::text[], array[]::text[], false),
  ('ipad-11', 'ipad', 'iPad (A16, 11ª ger.)', 'Apple', 2025::smallint, array['128GB Wi-Fi', '256GB Wi-Fi', '512GB Wi-Fi', '128GB Wi-Fi + Cellular', '256GB Wi-Fi + Cellular']::text[], array['Prateado', 'Azul', 'Rosa', 'Amarelo']::text[], array[]::text[], false),
  ('ipad-mini-6', 'ipad', 'iPad mini (6ª ger.)', 'Apple', 2021::smallint, array['64GB Wi-Fi', '256GB Wi-Fi', '64GB Wi-Fi + Cellular', '256GB Wi-Fi + Cellular']::text[], array['Cinza-espacial', 'Estelar', 'Rosa', 'Roxo']::text[], array[]::text[], false),
  ('ipad-mini-7', 'ipad', 'iPad mini (A17 Pro)', 'Apple', 2024::smallint, array['128GB Wi-Fi', '256GB Wi-Fi', '512GB Wi-Fi', '128GB Wi-Fi + Cellular', '256GB Wi-Fi + Cellular']::text[], array['Cinza-espacial', 'Estelar', 'Roxo', 'Azul']::text[], array[]::text[], false),
  ('ipad-air-m1', 'ipad', 'iPad Air M1 (5ª ger.)', 'Apple', 2022::smallint, array['64GB Wi-Fi', '256GB Wi-Fi', '64GB Wi-Fi + Cellular', '256GB Wi-Fi + Cellular']::text[], array['Cinza-espacial', 'Estelar', 'Rosa', 'Roxo', 'Azul']::text[], array[]::text[], false),
  ('ipad-air-m2', 'ipad', 'iPad Air M2 (11" / 13")', 'Apple', 2024::smallint, array['128GB', '256GB', '512GB', '1TB']::text[], array['Cinza-espacial', 'Estelar', 'Roxo', 'Azul']::text[], array[]::text[], false),
  ('ipad-air-m3', 'ipad', 'iPad Air M3 (11" / 13")', 'Apple', 2025::smallint, array['128GB', '256GB', '512GB', '1TB']::text[], array['Cinza-espacial', 'Estelar', 'Roxo', 'Azul']::text[], array[]::text[], false),
  ('ipad-pro-m2', 'ipad', 'iPad Pro M2 (11" / 12,9")', 'Apple', 2022::smallint, array['128GB', '256GB', '512GB', '1TB', '2TB']::text[], array['Cinza-espacial', 'Prateado']::text[], array[]::text[], false),
  ('ipad-pro-m4', 'ipad', 'iPad Pro M4 (11" / 13")', 'Apple', 2024::smallint, array['256GB', '512GB', '1TB', '2TB']::text[], array['Preto-espacial', 'Prateado']::text[], array[]::text[], false),
  ('ipad-pro-m5', 'ipad', 'iPad Pro M5 (11" / 13")', 'Apple', 2025::smallint, array['256GB', '512GB', '1TB', '2TB']::text[], array['Preto-espacial', 'Prateado']::text[], array[]::text[], true),
  ('airpods-2', 'airpods', 'AirPods (2ª ger.)', 'Apple', 2019::smallint, array['Padrão']::text[], array['Branco']::text[], array[]::text[], false),
  ('airpods-3', 'airpods', 'AirPods (3ª ger.)', 'Apple', 2021::smallint, array['Lightning', 'MagSafe USB-C']::text[], array['Branco']::text[], array[]::text[], false),
  ('airpods-4', 'airpods', 'AirPods 4', 'Apple', 2024::smallint, array['Sem cancelamento', 'Com cancelamento de ruído']::text[], array['Branco']::text[], array[]::text[], false),
  ('airpods-pro-2', 'airpods', 'AirPods Pro 2', 'Apple', 2022::smallint, array['Lightning', 'USB-C']::text[], array['Branco']::text[], array[]::text[], false),
  ('airpods-pro-3', 'airpods', 'AirPods Pro 3', 'Apple', 2025::smallint, array['USB-C']::text[], array['Branco']::text[], array[]::text[], false),
  ('airpods-max', 'airpods', 'AirPods Max', 'Apple', 2020::smallint, array['Lightning', 'USB-C']::text[], array['Cinza-espacial', 'Prateado', 'Verde', 'Azul-céu', 'Rosa', 'Meia-noite', 'Estelar', 'Roxo', 'Laranja']::text[], array[]::text[], false),
  ('ps5-slim', 'console', 'PlayStation 5 Slim', null, 2023::smallint, array['1TB', '825GB']::text[], array['Branco']::text[], array['Com leitor de disco', 'Digital (sem leitor)']::text[], false),
  ('ps5-pro', 'console', 'PlayStation 5 Pro', null, 2024::smallint, array['2TB']::text[], array['Branco']::text[], array['Digital (leitor vendido à parte)', 'Com leitor de disco']::text[], false),
  ('ps5-fat', 'console', 'PlayStation 5 (modelo antigo)', null, 2020::smallint, array['825GB']::text[], array['Branco']::text[], array['Com leitor de disco', 'Digital (sem leitor)']::text[], false),
  ('ps-portal', 'console', 'PlayStation Portal', null, 2023::smallint, array['Padrão']::text[], array['Branco']::text[], array[]::text[], false),
  ('dualsense', 'console', 'Controle DualSense', null, 2020::smallint, array['Padrão', 'Edge']::text[], array['Branco', 'Preto', 'Vermelho', 'Azul', 'Roxo', 'Cinza camuflado', 'Outra cor']::text[], array[]::text[], false),
  ('xbox-series-x', 'console', 'Xbox Series X', null, 2020::smallint, array['1TB', '2TB Galaxy Black', 'Digital 1TB']::text[], array['Preto', 'Branco']::text[], array[]::text[], false),
  ('xbox-series-s', 'console', 'Xbox Series S', null, 2020::smallint, array['512GB', '1TB']::text[], array['Branco', 'Preto']::text[], array[]::text[], false),
  ('xbox-controller', 'console', 'Controle Xbox Wireless', null, 2020::smallint, array['Padrão', 'Elite Series 2']::text[], array['Preto', 'Branco', 'Azul', 'Vermelho', 'Outra cor']::text[], array[]::text[], false),
  ('switch-oled', 'console', 'Nintendo Switch OLED', null, 2021::smallint, array['64GB']::text[], array['Branco', 'Neon', 'Edição especial']::text[], array[]::text[], false),
  ('switch-lite', 'console', 'Nintendo Switch Lite', null, 2019::smallint, array['32GB']::text[], array['Turquesa', 'Cinza', 'Coral', 'Amarelo', 'Azul']::text[], array[]::text[], false),
  ('switch-2', 'console', 'Nintendo Switch 2', null, 2025::smallint, array['256GB']::text[], array['Padrão']::text[], array[]::text[], false),
  ('game-avulso', 'console', 'Jogo / mídia física', null, 2020::smallint, array['PS5', 'PS4', 'Xbox', 'Switch', 'Switch 2']::text[], array['-']::text[], array[]::text[], false),
  ('perfume-generico', 'perfume', 'Perfume importado (digitar marca)', null, 2020::smallint, array['30ml', '50ml', '75ml', '100ml', '125ml', '150ml', '200ml', 'Decant 5ml', 'Decant 10ml']::text[], array['EDP', 'EDT', 'Parfum / Extrait', 'Cologne', 'Body Splash']::text[], array[]::text[], false),
  ('perfume-dior-sauvage', 'perfume', 'Dior Sauvage', null, 2015::smallint, array['30ml', '50ml', '75ml', '100ml', '125ml', '150ml', '200ml', 'Decant 5ml', 'Decant 10ml']::text[], array['EDP', 'EDT', 'Parfum / Extrait', 'Cologne', 'Body Splash']::text[], array[]::text[], false),
  ('perfume-bleu-chanel', 'perfume', 'Chanel Bleu de Chanel', null, 2010::smallint, array['30ml', '50ml', '75ml', '100ml', '125ml', '150ml', '200ml', 'Decant 5ml', 'Decant 10ml']::text[], array['EDP', 'EDT', 'Parfum / Extrait', 'Cologne', 'Body Splash']::text[], array[]::text[], false),
  ('perfume-1million', 'perfume', 'Paco Rabanne 1 Million', null, 2008::smallint, array['30ml', '50ml', '75ml', '100ml', '125ml', '150ml', '200ml', 'Decant 5ml', 'Decant 10ml']::text[], array['EDP', 'EDT', 'Parfum / Extrait', 'Cologne', 'Body Splash']::text[], array[]::text[], false),
  ('perfume-invictus', 'perfume', 'Paco Rabanne Invictus', null, 2013::smallint, array['30ml', '50ml', '75ml', '100ml', '125ml', '150ml', '200ml', 'Decant 5ml', 'Decant 10ml']::text[], array['EDP', 'EDT', 'Parfum / Extrait', 'Cologne', 'Body Splash']::text[], array[]::text[], false),
  ('perfume-phantom', 'perfume', 'Paco Rabanne Phantom', null, 2021::smallint, array['30ml', '50ml', '75ml', '100ml', '125ml', '150ml', '200ml', 'Decant 5ml', 'Decant 10ml']::text[], array['EDP', 'EDT', 'Parfum / Extrait', 'Cologne', 'Body Splash']::text[], array[]::text[], false),
  ('perfume-ysl-y', 'perfume', 'Yves Saint Laurent Y', null, 2017::smallint, array['30ml', '50ml', '75ml', '100ml', '125ml', '150ml', '200ml', 'Decant 5ml', 'Decant 10ml']::text[], array['EDP', 'EDT', 'Parfum / Extrait', 'Cologne', 'Body Splash']::text[], array[]::text[], false),
  ('perfume-la-nuit', 'perfume', 'YSL La Nuit de L’Homme', null, 2009::smallint, array['30ml', '50ml', '75ml', '100ml', '125ml', '150ml', '200ml', 'Decant 5ml', 'Decant 10ml']::text[], array['EDP', 'EDT', 'Parfum / Extrait', 'Cologne', 'Body Splash']::text[], array[]::text[], false),
  ('perfume-libre', 'perfume', 'YSL Libre', null, 2019::smallint, array['30ml', '50ml', '75ml', '100ml', '125ml', '150ml', '200ml', 'Decant 5ml', 'Decant 10ml']::text[], array['EDP', 'EDT', 'Parfum / Extrait', 'Cologne', 'Body Splash']::text[], array[]::text[], false),
  ('perfume-good-girl', 'perfume', 'Carolina Herrera Good Girl', null, 2016::smallint, array['30ml', '50ml', '75ml', '100ml', '125ml', '150ml', '200ml', 'Decant 5ml', 'Decant 10ml']::text[], array['EDP', 'EDT', 'Parfum / Extrait', 'Cologne', 'Body Splash']::text[], array[]::text[], false),
  ('perfume-212-vip', 'perfume', 'Carolina Herrera 212 VIP', null, 2010::smallint, array['30ml', '50ml', '75ml', '100ml', '125ml', '150ml', '200ml', 'Decant 5ml', 'Decant 10ml']::text[], array['EDP', 'EDT', 'Parfum / Extrait', 'Cologne', 'Body Splash']::text[], array[]::text[], false),
  ('perfume-scandal', 'perfume', 'Jean Paul Gaultier Scandal', null, 2017::smallint, array['30ml', '50ml', '75ml', '100ml', '125ml', '150ml', '200ml', 'Decant 5ml', 'Decant 10ml']::text[], array['EDP', 'EDT', 'Parfum / Extrait', 'Cologne', 'Body Splash']::text[], array[]::text[], false),
  ('perfume-le-male', 'perfume', 'Jean Paul Gaultier Le Male', null, 1995::smallint, array['30ml', '50ml', '75ml', '100ml', '125ml', '150ml', '200ml', 'Decant 5ml', 'Decant 10ml']::text[], array['EDP', 'EDT', 'Parfum / Extrait', 'Cologne', 'Body Splash']::text[], array[]::text[], false),
  ('perfume-eros', 'perfume', 'Versace Eros', null, 2012::smallint, array['30ml', '50ml', '75ml', '100ml', '125ml', '150ml', '200ml', 'Decant 5ml', 'Decant 10ml']::text[], array['EDP', 'EDT', 'Parfum / Extrait', 'Cologne', 'Body Splash']::text[], array[]::text[], false),
  ('perfume-dylan-blue', 'perfume', 'Versace Dylan Blue', null, 2016::smallint, array['30ml', '50ml', '75ml', '100ml', '125ml', '150ml', '200ml', 'Decant 5ml', 'Decant 10ml']::text[], array['EDP', 'EDT', 'Parfum / Extrait', 'Cologne', 'Body Splash']::text[], array[]::text[], false),
  ('perfume-boss-bottled', 'perfume', 'Hugo Boss Bottled', null, 1998::smallint, array['30ml', '50ml', '75ml', '100ml', '125ml', '150ml', '200ml', 'Decant 5ml', 'Decant 10ml']::text[], array['EDP', 'EDT', 'Parfum / Extrait', 'Cologne', 'Body Splash']::text[], array[]::text[], false),
  ('perfume-acqua-gio', 'perfume', 'Giorgio Armani Acqua di Giò', null, 1996::smallint, array['30ml', '50ml', '75ml', '100ml', '125ml', '150ml', '200ml', 'Decant 5ml', 'Decant 10ml']::text[], array['EDP', 'EDT', 'Parfum / Extrait', 'Cologne', 'Body Splash']::text[], array[]::text[], false),
  ('perfume-stronger', 'perfume', 'Emporio Armani Stronger With You', null, 2017::smallint, array['30ml', '50ml', '75ml', '100ml', '125ml', '150ml', '200ml', 'Decant 5ml', 'Decant 10ml']::text[], array['EDP', 'EDT', 'Parfum / Extrait', 'Cologne', 'Body Splash']::text[], array[]::text[], false),
  ('perfume-lattractive', 'perfume', 'Lattafa Asad / Khamrah / Yara', null, 2022::smallint, array['30ml', '50ml', '75ml', '100ml', '125ml', '150ml', '200ml', 'Decant 5ml', 'Decant 10ml']::text[], array['EDP', 'EDT', 'Parfum / Extrait', 'Cologne', 'Body Splash']::text[], array[]::text[], false),
  ('perfume-baccarat', 'perfume', 'MFK Baccarat Rouge 540', null, 2015::smallint, array['30ml', '50ml', '75ml', '100ml', '125ml', '150ml', '200ml', 'Decant 5ml', 'Decant 10ml']::text[], array['EDP', 'EDT', 'Parfum / Extrait', 'Cologne', 'Body Splash']::text[], array[]::text[], false),
  ('apple-pencil', 'acessorio', 'Apple Pencil', 'Apple', 2022::smallint, array['1ª ger.', '2ª ger.', 'USB-C', 'Pro']::text[], array['Branco']::text[], array[]::text[], false),
  ('magic-keyboard', 'acessorio', 'Magic Keyboard / Smart Folio', null, 2022::smallint, array['11"', '12,9"', '13"']::text[], array['Preto', 'Branco']::text[], array[]::text[], false),
  ('carregador', 'acessorio', 'Carregador / cabo Apple', null, 2021::smallint, array['20W', '30W', '35W', '70W', '96W', 'Cabo USB-C']::text[], array['Branco']::text[], array[]::text[], false),
  ('magsafe', 'acessorio', 'Carregador MagSafe', null, 2020::smallint, array['MagSafe', 'MagSafe Duo', 'Battery Pack']::text[], array['Branco', 'Preto']::text[], array[]::text[], false),
  ('capa', 'acessorio', 'Capa / Case', null, 2021::smallint, array['Silicone', 'Transparente', 'Couro', 'FineWoven', 'Outra']::text[], array['Diversas']::text[], array[]::text[], false),
  ('pelicula', 'acessorio', 'Película', null, 2021::smallint, array['Vidro 3D', 'Privacidade', 'Hidrogel', 'Câmera']::text[], array['-']::text[], array[]::text[], false),
  ('airtag', 'acessorio', 'AirTag', null, 2021::smallint, array['Unidade', 'Pack com 4']::text[], array['Branco']::text[], array[]::text[], false)
) as x(slug, cat_slug, name, brand, year, storages, colors, sizes, review)
join public.categories c on c.slug = x.cat_slug
on conflict (slug) do nothing;

-- v2.1 · PS5: versão (com leitor / digital) separada do armazenamento.
-- Banco que já rodou o seed: corrige só o que ainda não tem venda/estoque cadastrado.
update public.categories set variant_label = 'Armazenamento', size_label = 'Versão'
 where slug = 'console' and variant_label = 'Versão' and size_label = 'Tamanho';
update public.products set sizes = array['Com leitor de disco', 'Digital (sem leitor)']::text[], storages = array['1TB', '825GB']::text[]
 where slug = 'ps5-slim' and storages @> array['Digital (1TB)']::text[]
   and not exists (select 1 from public.product_variants v where v.product_id = products.id);
update public.products set sizes = array['Com leitor de disco', 'Digital (sem leitor)']::text[], storages = array['825GB']::text[]
 where slug = 'ps5-fat' and storages @> array['Digital (825GB)']::text[]
   and not exists (select 1 from public.product_variants v where v.product_id = products.id);
update public.products set sizes = array['Digital (leitor vendido à parte)', 'Com leitor de disco']::text[]
 where slug = 'ps5-pro' and cardinality(sizes) = 0
   and not exists (select 1 from public.product_variants v where v.product_id = products.id);

-- Pedidos antigos passam a apontar para os modelos (relatórios por modelo).
select public._relink_legacy_items() as itens_ligados_ao_cadastro;

-- Conferência: categorias e quantos modelos cada uma tem.
select c.name, count(p.id) as modelos from public.categories c left join public.products p on p.category_id = c.id group by c.name, c.sort order by c.sort;
