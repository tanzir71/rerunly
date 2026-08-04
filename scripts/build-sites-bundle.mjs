import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const siteOutput = path.resolve('site-dist');
const hostingOutput = path.resolve('dist');
const sourceHtml = await readFile(path.join(siteOutput, 'index.html'), 'utf8');
const stylesheetTag = sourceHtml.match(/<link rel="stylesheet"[^>]+href="([^"]+)"[^>]*>/);

if (!stylesheetTag?.[1]) {
  throw new Error('The landing build did not include a stylesheet asset.');
}

const stylesheetPath = path.join(siteOutput, stylesheetTag[1].replace(/^\//, ''));
const stylesheet = await readFile(stylesheetPath, 'utf8');
const inlineHtml = sourceHtml.replace(stylesheetTag[0], `<style>${stylesheet}</style>`);
const worker = `const HTML = ${JSON.stringify(inlineHtml)};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/robots.txt') {
      return new Response('User-agent: *\\nAllow: /\\n', {
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      });
    }
    return new Response(HTML, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=300',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin'
      }
    });
  }
};
`;

await mkdir(path.join(hostingOutput, 'server'), { recursive: true });
await mkdir(path.join(hostingOutput, 'client'), { recursive: true });
await writeFile(path.join(hostingOutput, 'server', 'index.js'), worker);
await writeFile(path.join(hostingOutput, 'client', 'index.html'), inlineHtml);
