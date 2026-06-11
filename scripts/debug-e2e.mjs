// Debug integral de Pisos Pacific con Playwright: recorre todas las páginas,
// captura errores de consola, page errors y requests fallidos; screenshots.
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'http://localhost:4173';
const PAGES = ['/dashboard', '/cotizaciones', '/ventas', '/agenda', '/inventario', '/cashflow', '/cajas', '/clientes', '/proveedores', '/leads', '/mensajes', '/reportes', '/movimientos', '/configuracion'];
const out = { pages: {}, global: [] };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

let current = '(boot)';
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') {
    (out.pages[current] ??= []).push(`console.${msg.type()}: ${msg.text().slice(0, 300)}`);
  }
});
page.on('pageerror', (err) => (out.pages[current] ??= []).push(`pageerror: ${String(err).slice(0, 300)}`));
page.on('response', (r) => {
  if (r.status() >= 400 && !r.url().includes('favicon')) {
    (out.pages[current] ??= []).push(`HTTP ${r.status()}: ${r.request().method()} ${r.url().replace(BASE, '')}`);
  }
});

// Login
current = '/login';
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.fill('input[type="email"]', 'info@pisospacific.com');
await page.fill('input[type="password"]', 'admin123');
await page.click('button[type="submit"]');
await page.waitForURL('**/dashboard', { timeout: 15000 }).catch(() => out.global.push('LOGIN: no llegó a /dashboard'));
await page.waitForLoadState('networkidle');
await page.screenshot({ path: '/tmp/shot-login-result.png' });

// Recorrer páginas
for (const p of PAGES) {
  current = p;
  try {
    await page.goto(BASE + p, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `/tmp/shot${p.replace(/\//g, '-')}.png`, fullPage: false });
    // texto visible de error en pantalla
    const errText = await page.locator('text=/error|Error \\d|falló|failed/i').count().catch(() => 0);
    if (errText > 0) {
      const texts = await page.locator('text=/error|falló|failed/i').allTextContents().catch(() => []);
      (out.pages[current] ??= []).push(`UI-error-text: ${texts.slice(0, 3).join(' | ').slice(0, 200)}`);
    }
  } catch (e) {
    (out.pages[current] ??= []).push(`NAV-FAIL: ${String(e).slice(0, 200)}`);
  }
}

// Interacciones clave (read-only)
current = '/cashflow:import-dialog';
await page.goto(BASE + '/cashflow', { waitUntil: 'networkidle' });
const importBtn = page.locator('button:has-text("Importar extracto")');
if (await importBtn.count()) {
  await importBtn.click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: '/tmp/shot-import-dialog.png' });
  await page.keyboard.press('Escape');
} else out.pages[current] = ['no se encontró el botón Importar extracto'];

current = '/cotizaciones:nueva';
await page.goto(BASE + '/cotizaciones', { waitUntil: 'networkidle' });
const newQ = page.locator('button:has-text("Nueva cotización"), button:has-text("Nueva Cotización")').first();
if (await newQ.count()) {
  await newQ.click();
  await page.waitForTimeout(700);
  const obs = await page.locator('text=Observaciones').count();
  const fp = await page.locator('text=Forma de pago').count();
  (out.pages[current] ??= []).push(`campos nuevos visibles → Observaciones:${obs > 0 ? 'SÍ' : 'NO'} FormaDePago:${fp > 0 ? 'SÍ' : 'NO'}`);
  await page.screenshot({ path: '/tmp/shot-quote-form.png', fullPage: true });
  await page.keyboard.press('Escape');
}

await browser.close();
fs.writeFileSync('/tmp/pp-debug-report.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
