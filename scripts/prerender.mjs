// Inject the server-rendered default view into dist/index.html. Run after `vite build` and the SSR build.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';

const { render } = await import('../dist-ssr/entry-server.js');
const file = new URL('../dist/index.html', import.meta.url);
const html = readFileSync(file, 'utf8');
if (!html.includes('<div id="root"></div>')) throw new Error('prerender: #root placeholder not found');
writeFileSync(file, html.replace('<div id="root"></div>', `<div id="root">${render()}</div>`));
rmSync(new URL('../dist-ssr', import.meta.url), { recursive: true });
console.log('prerendered dist/index.html');
