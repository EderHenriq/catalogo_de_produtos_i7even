// Importar a pasta de fotos de novo não sobe foto repetida: cópia na mesma
// pasta (outro nome) entra uma vez, foto que já subiu não sobe de novo (só é
// ligada), e foto nova numa cor que já tem fotos é acrescentada.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDb, open } from './harness.mjs';

let fails = 0;
const ok = (c, m) => { console.log(`${c ? '  ✓' : '  ✗'} ${m}`); if (!c) fails++; };
const env = await createDb();
const one = async (sql, p) => (await env.db.query(sql, p)).rows[0];
const { browser, page, errors } = await open(env, { device: 'Desktop' });
await page.waitForSelector('.app');

// três fotos diferentes (cores diferentes) geradas no navegador
const png = async (color) => Buffer.from(await page.evaluate((c) => {
  const cv = document.createElement('canvas'); cv.width = 900; cv.height = 900;
  const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 900, 900); g.fillStyle = c; g.fillRect(300, 150, 300, 600);
  return cv.toDataURL('image/png').split(',')[1];
}, color), 'base64');
const [A, B, C] = [await png('#222'), await png('#2a6'), await png('#c33')];
const DIR = path.join(os.tmpdir(), `i7-repetidas-${Date.now()}`, 'Imagens');
const put = (f, buf) => { fs.mkdirSync(path.dirname(path.join(DIR, f)), { recursive: true }); fs.writeFileSync(path.join(DIR, f), buf); };
const uploads = () => [...env.uploads.keys()].filter((k) => !k.includes('.t.')).length;

async function importar() {
  await page.locator('[data-photo-import]').click();
  await page.locator('input[data-dir]').first().setInputFiles(DIR);
  await page.waitForSelector('.pi-model', { timeout: 30000 });
}
async function enviar() {
  await page.locator('[data-go]').click();
  await page.waitForSelector('.pi-done', { timeout: 60000 });
  const t = await page.locator('.pi-done').innerText();
  await page.locator('.modal-foot [data-close]').click();
  await page.waitForTimeout(300);
  return t;
}

await page.evaluate(() => { location.hash = '#/produtos'; });
await page.waitForTimeout(300);

console.log('1. pasta com uma cópia (outro nome)');
put('01_iPhone/iPhone 12/Azul/a.png', A);
put('01_iPhone/iPhone 12/Azul/b.png', B);
put('01_iPhone/iPhone 12/Azul/a - Copia.png', A);
await importar();
ok((await page.locator('[data-go]').innerText()).includes('Enviar 2 fotos'), 'cópia fica de fora: 2 fotos para enviar');
ok(await page.locator('.pi-summary', { hasText: '1 repetidas na pasta' }).count() === 1, 'prévia avisa "1 repetidas na pasta"');
await enviar();
let r = await one(`select color_photos from public.products where slug = 'iphone-12'`);
ok(r.color_photos.Azul?.length === 2 && uploads() === 2, `Azul com 2 fotos, 2 no Storage (${uploads()})`);
ok(r.color_photos.Azul.every((u) => /\/p\/h-[0-9a-f]{20}\./.test(u)), 'nome do arquivo = código do conteúdo');

console.log('2. importar de novo, igual');
await importar();
ok(await page.locator('[data-go]').isDisabled(), 'nada novo para enviar');
await page.locator('.modal-foot [data-close]').click();
await page.waitForTimeout(300);

console.log('3. baixou mais: 1 foto nova + 1 repetida com outro nome + a mesma foto em outra cor');
put('01_iPhone/iPhone 12/Azul/c.png', C);
put('01_iPhone/iPhone 12/Azul/z-b-de-novo.png', B);
put('01_iPhone/iPhone 12/Verde/a.png', A);
await importar();
ok(await page.locator('.pi-color', { hasText: '+1 novas' }).count() === 1, 'Azul: "+1 novas" (a repetida não conta)');
ok(await page.locator('.pi-summary', { hasText: '1 já no sistema' }).count() === 1, 'prévia: "1 já no sistema"');
const done = await enviar();
r = await one(`select color_photos from public.products where slug = 'iphone-12'`);
ok(r.color_photos.Azul.length === 3, `Azul ficou com 3 fotos (${r.color_photos.Azul.length})`);
ok(new Set(r.color_photos.Azul).size === 3, 'sem foto duplicada na cor');
ok(r.color_photos.Verde?.length === 1 && r.color_photos.Azul.includes(r.color_photos.Verde[0]), 'Verde usa a mesma foto (ligada, sem subir de novo)');
ok(uploads() === 3, `Storage: só 1 arquivo novo (${uploads()} no total)`);
ok(/1 já estava no sistema/.test(done), 'resumo: "1 já estava no sistema"');

ok(errors.length === 0, `sem erro de JS ${errors.join(' | ')}`);
await browser.close();
console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK');
process.exit(fails ? 1 : 0);
