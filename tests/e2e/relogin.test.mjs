// Sair e entrar de novo sem recarregar a página (sessão encerrada por tempo
// sem uso, saiu em outro aparelho): a tela em que estava aparece de novo -
// antes a área do meio ficava vazia (tela preta) depois do login.
import { createDb, open } from './harness.mjs';

let fails = 0;
const ok = (c, m) => { console.log(`${c ? '  ✓' : '  ✗'} ${m}`); if (!c) fails++; };
const env = await createDb();

for (const device of ['Desktop', 'iPhone 13']) {
  console.log(`== ${device}`);
  const { browser, page, errors } = await open(env, { device });
  const touch = device !== 'Desktop';
  const tap = (l) => (touch ? l.first().tap() : l.first().click());
  await page.waitForSelector('.app');
  await page.evaluate(() => { location.hash = '#/estoque'; });
  await page.waitForSelector('[data-view] .view');
  ok((await page.locator('[data-title]').innerText()) === 'Estoque', 'abriu o Estoque');

  for (let round = 1; round <= 2; round++) {
    await page.evaluate(() => window.__emitAuth('SIGNED_OUT'));
    await page.waitForSelector('.gate-form');
    await page.locator('#email').fill('loja@teste.com');
    await page.locator('#password').fill('senha-de-teste');
    await tap(page.locator('.gate-form button[type="submit"]'));
    await page.waitForSelector('.app');
    await page.waitForSelector('[data-view] .view', { timeout: 8000 }).catch(() => {});
    const view = await page.locator('[data-view] .view').count();
    const title = await page.locator('[data-title]').innerText();
    const current = await page.locator('.sidebar [aria-current="page"]').getAttribute('data-route').catch(() => null);
    ok(view === 1 && title === 'Estoque' && current === 'estoque', `entrou de novo (${round}ª vez): a tela aparece (título "${title}", menu em "${current}")`);
  }
  ok(errors.length === 0, `sem erro de JS ${errors.join(' | ')}`);
  await browser.close();
}
console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK');
process.exit(fails ? 1 : 0);
