// Fumaça: o app abre contra o banco real (PGlite) e todas as telas montam
// sem erro de JavaScript, no celular e no computador. O catálogo também.
import { createDb, open, SHOTS, audit } from './harness.mjs';

const ROUTES = ['dashboard', 'pedidos', 'receber', 'clientes', 'produtos', 'entradas', 'catalogo', 'categorias', 'relatorios', 'ajustes'];
let fails = 0;
const ok = (c, m) => { console.log(`${c ? '  ✓' : '  ✗'} ${m}`); if (!c) fails++; };

const env = await createDb();
for (const device of ['iPhone 13', 'Desktop']) {
  console.log(`== ${device}`);
  const { browser, page, errors } = await open(env, { device });
  await page.waitForSelector('.app', { timeout: 15000 }).catch(() => {});
  ok(await page.locator('.app').count() === 1, 'app abriu (login → membro → banco v2)');
  for (const r of ROUTES) {
    await page.evaluate((id) => { location.hash = `#/${id}`; }, r);
    await page.waitForTimeout(350);
    const failed = await page.locator('[data-view] .alert[data-kind="warn"]:has-text("falhou ao abrir")').count();
    ok(!failed, `tela ${r}`);
    await page.screenshot({ path: `${SHOTS}smoke-${device.replace(/\W/g, '')}-${r}.png` });
    const issues = await audit(page, r, { mobile: device !== 'Desktop' });
    if (issues.length) console.log('    ⚠', issues.join('\n    ⚠ '));
  }
  ok(errors.length === 0, `sem erro de JS ${errors.length ? errors.join(' | ') : ''}`);
  await browser.close();
}

// Catálogo público (anon): fechado por padrão → mostra o WhatsApp.
console.log('== catálogo');
{
  const { browser, page, errors } = await open(env, { device: 'iPhone 13', path: 'catalogo.html' });
  await page.waitForTimeout(800);
  ok(await page.locator('.cat-empty-page').count() === 1, 'catálogo fechado mostra só o WhatsApp');
  await page.screenshot({ path: `${SHOTS}smoke-catalogo-fechado.png` });
  ok(errors.length === 0, `sem erro de JS ${errors.join(' | ')}`);
  await browser.close();
}
console.log(fails ? `\n${fails} FALHA(S)` : '\nTUDO OK');
process.exit(fails ? 1 : 0);
