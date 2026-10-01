// End-to-end smoke test: drives the built app in Chrome through every interaction a visitor will try.
// Usage: npm run build && npm run e2e   (CHROME_PATH overrides the browser location)
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const PORT = 4399;
const URL = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const downloads = mkdtempSync(join(tmpdir(), 'ring0-e2e-'));
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`);
  if (!ok) failures.push(name);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) {
  for (const end = Date.now() + ms; Date.now() < end; await wait(100)) if (await fn()) return true;
  return false;
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
let browser;
try {
  if (!(await until(() => fetch(URL).then((r) => r.ok, () => false), 20000))) throw new Error('preview server did not start');
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });

  const label = () => page.$eval('.pb-label', (e) => e.textContent);
  const text = (sel) => page.$eval(sel, (e) => e.textContent);
  const blur = () => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  const key = async (k) => { await blur(); await page.keyboard.press(k); await wait(150); };
  const setInput = async (sel, value) => {
    await page.click(sel, { count: 3 });
    await page.keyboard.press('Backspace');
    await page.type(sel, value);
    await wait(150);
  };
  const toast = () => page.$eval('.toast', (e) => e.textContent);

  await page.goto(URL, { waitUntil: 'networkidle0' });

  // ---------------------------------------------------------------- scheduler
  await key(' ');
  await wait(1600);
  await key(' ');
  check('play advances the clock', (await label()) !== 't = 0', await label());
  const gantt = await page.$('.timeline svg');
  const box = await gantt.boundingBox();
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
  await wait(150);
  const clicked = await label();
  check('clicking the Gantt scrubs', clicked !== 't = 0' && clicked !== '', clicked);
  await key('Home');
  check('Home returns to start', (await label()) === 't = 0');
  await page.click('.segmented button::-p-text(SJF)');
  await key('End');
  check('switching algorithm re-runs (SJF)', (await text('.explain-why')).includes('SJF'));
  await page.click('.chips-select button::-p-text(FCFS)');
  check('compare mode shows the head-to-head table', !!(await page.$('table.compare')));
  await setInput('input[aria-label="P1 bursts"]', '5 3');
  check('invalid bursts show a readable error', (await page.$eval('.errors', (e) => e.textContent)).includes('start and end with CPU'));
  await setInput('input[aria-label="P1 bursts"]', '5 3 2');
  check('fixing the input recovers', !(await page.$('.errors')));

  // ---------------------------------------------------------------- share link round trip
  await key('Home');
  await key('ArrowRight'); await key('ArrowRight'); await key('ArrowRight');
  await page.click('button[aria-label="Copy share link"]');
  await wait(300);
  const shared = page.url();
  check('share puts scenario and step in the URL', shared.includes('#s=') && shared.includes('&t=3'), shared);
  const page2 = await browser.newPage();
  await page2.setViewport({ width: 1440, height: 900 });
  await page2.goto(shared, { waitUntil: 'networkidle0' });
  check('shared link reopens at the same step', (await page2.$eval('.pb-label', (e) => e.textContent)) === 't = 3');
  check('shared link keeps compare mode', !!(await page2.$('table.compare')));
  await page2.close();

  // ---------------------------------------------------------------- export / import
  await page.click('button[aria-label="Export JSON"]');
  const json = join(downloads, 'ring0-scheduler.json');
  check('JSON export downloads', await until(() => existsSync(json)));
  const exported = existsSync(json) ? JSON.parse(readFileSync(json, 'utf8')) : {};
  check('JSON export is a v1 scheduler envelope', exported.v === 1 && exported.module === 'scheduler' && exported.params?.algo?.kind === 'sjf');
  await page.click('button[aria-label="Export PNG"]');
  const png = join(downloads, 'ring0-scheduler.png');
  check('PNG export downloads a real PNG', await until(() => existsSync(png) && readFileSync(png).subarray(1, 4).toString() === 'PNG'));
  await key('2');
  const input = await page.$('input[type=file]');
  await input.uploadFile(json);
  await until(async () => (await page.$eval('.tab[aria-current="page"]', (e) => e.dataset.tab)) === 'scheduler');
  check('JSON import restores the scenario', (await page.$eval('.tab[aria-current="page"]', (e) => e.dataset.tab)) === 'scheduler' && (await toast()).startsWith('Loaded'));

  // ---------------------------------------------------------------- memory
  await key('2');
  await page.click("button::-p-text(Belady's anomaly)");
  await key('End');
  check("Belady preset: FIFO, 3 frames, 9 faults", (await text('.stat .stat-value')).startsWith('9/9'));
  await setInput('input[aria-label="Physical frames"]', '4');
  await key('End');
  check("Belady preset: 4 frames, 10 faults", (await text('.stat .stat-value')).startsWith('10/10'));
  check('fault curve flags the anomaly', !!(await page.$('.belady')));

  // ---------------------------------------------------------------- deadlock: graph
  await key('3');
  check('book graph reports deadlock', (await text('.verdict')).includes('DEADLOCK'));
  const p1 = await page.$('g.node[aria-label^="Process P1"]');
  const before = await p1.evaluate((e) => e.getAttribute('transform'));
  const b1 = await p1.boundingBox();
  await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2);
  await page.mouse.down();
  for (let k = 1; k <= 6; k++) await page.mouse.move(b1.x + b1.width / 2 + k * 12, b1.y + b1.height / 2 + k * 6);
  await page.mouse.up();
  await wait(150);
  check('nodes can be dragged', (await p1.evaluate((e) => e.getAttribute('transform'))) !== before);
  const requests = () => page.$$eval('line.edge.request', (es) => es.length);
  const nReq = await requests();
  await page.click('.col-controls button::-p-text(Process)');
  const r4 = await page.$('g.node[aria-label^="Resource R4"]');
  const b4 = await r4.boundingBox();
  await page.mouse.click(b4.x + b4.width / 2, b4.y + b4.height / 2);
  await wait(150);
  check('click process then resource adds a request edge', (await requests()) === nReq + 1);
  // Real click on the midpoint of the new request edge (requests render before assignments).
  const mid = await page.$$eval('.edge-g line.edge-hit', (ls, i) => {
    const l = ls[i];
    const m = l.getScreenCTM();
    const x = (l.x1.baseVal.value + l.x2.baseVal.value) / 2, y = (l.y1.baseVal.value + l.y2.baseVal.value) / 2;
    return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
  }, nReq);
  await page.mouse.click(mid.x, mid.y);
  await wait(150);
  check('clicking an edge removes it', (await requests()) === nReq);
  await page.select('.col-controls select', 'dining-ordered');
  await wait(150);
  check('ordered dining philosophers: no deadlock', (await text('.verdict')).includes('NO DEADLOCK'));

  // ---------------------------------------------------------------- deadlock: banker
  await page.click("button::-p-text(Banker's algorithm)");
  await key('End');
  check('banker: book state is safe', (await text('.explain-summary')).startsWith('Safe'));
  await page.click('.col-controls button::-p-text(Request)');
  await wait(150);
  check('banker: P1 (1,0,2) is granted', (await text('.verdict')).includes('GRANTED'));
  await page.click('button::-p-text(Commit grant)');
  await wait(150);
  const avail = await page.$$eval('tfoot input', (es) => es.map((e) => e.value).join(','));
  check('banker: commit applies the grant', avail === '2,3,0', avail);

  // ---------------------------------------------------------------- sync
  await key('4');
  await page.click('button::-p-text(Find a bad interleaving)');
  await wait(300);
  check('race finder finds a schedule', (await toast()).startsWith('Found one'), await toast());
  await key('End');
  check('the found schedule shows the violation', (await text('.verdict')).includes('VIOLATION'));
  await key('Home');
  await page.click('.segmented button::-p-text(Manual)');
  await page.click('button::-p-text(Run T2)');
  await wait(150);
  check('manual stepping runs the chosen thread', (await label()) === 'step 1 · T2', await label());
  await page.click('.fix .toggle');
  await wait(150);
  await page.click('button::-p-text(Find a bad interleaving)');
  await wait(300);
  check('with the mutex, no bad interleaving exists', (await toast()).includes('safe'), await toast());
  await page.select('.col-controls select', 'buffer');
  await key('End');
  check('switching programs runs cleanly (no stale expectation)', !(await page.$('.errors')));

  // ---------------------------------------------------------------- shell
  await key('?');
  check('? opens the shortcuts dialog', !!(await page.$('dialog[open]')));
  await page.keyboard.press('Escape');
  await wait(150);
  check('Escape closes it', !(await page.$('dialog[open]')));

  // ---------------------------------------------------------------- phone width
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  for (const k of ['1', '2', '3', '4']) {
    await key(k);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`module ${k} fits a 390px screen`, over <= 0, `${over}px overflow`);
  }

  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('e2e run completed', false, e.stack);
} finally {
  await browser?.close();
  server.kill();
}
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
