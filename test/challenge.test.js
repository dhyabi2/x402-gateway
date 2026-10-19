import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AI_INDEX_AGENTS } from '../src/agents.js';
import { challengeToken } from '../src/challenge.js';
import { createGateway } from '../src/index.js';

const KEY = 'cp_live_0123456789abcdef0123456789abcdef';
const PAY_TO = '0xCC3b072391AE7A8d10cF00DdC5F61DB2cA5541E5';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

const gw = (extra = {}) =>
  createGateway({ siteUrl: 'https://example.test', coinpay: { apiKey: KEY }, payTo: PAY_TO, challenge: { paths: ['/i/'] }, ...extra });
const req = (path, ua = CHROME, headers = {}) =>
  new Request(`https://example.test${path}`, { headers: { 'user-agent': ua, 'sec-fetch-mode': 'navigate', 'x-real-ip': '198.51.100.7', ...headers } });

describe('the script challenge', () => {
  it('asks a browser without the cookie to run a script, with a 402 that names the sales page', async () => {
    const res = await gw().handle(req('/i/63576915'));
    assert.equal(res.status, 402);
    const body = await res.text();
    assert.match(body, /document\.cookie="pf_js=[0-9a-f]{32}; Max-Age=172800/);
    assert.match(body, /location\.reload\(\)/);
    assert.match(body, /https:\/\/example\.test\/crawl/);
  });

  it('lets the same browser through once it carries the token for its address', async () => {
    const token = await challengeToken(KEY, '198.51.100.7');
    assert.equal(await gw().handle(req('/i/63576915', CHROME, { cookie: `a=1; pf_js=${token}` })), null);
  });

  it('a token minted for one address does not open another', async () => {
    const token = await challengeToken(KEY, '198.51.100.8');
    assert.equal((await gw().handle(req('/i/1', CHROME, { cookie: `pf_js=${token}` })))?.status, 402);
  });

  it('accepts yesterday’s token, not older', async () => {
    const day = Math.floor(Date.now() / 86_400_000);
    const y = await challengeToken(KEY, '198.51.100.7', day - 1);
    const old = await challengeToken(KEY, '198.51.100.7', day - 2);
    assert.equal(await gw().handle(req('/i/1', CHROME, { cookie: `pf_js=${y}` })), null);
    assert.equal((await gw().handle(req('/i/1', CHROME, { cookie: `pf_js=${old}` })))?.status, 402);
  });

  it('only on the challenged paths, only GET/HEAD, never a verified search crawler or an exempt session', async () => {
    const g = gw({ exempt: (r) => (r.headers.get('cookie') ?? '').includes('session=') });
    assert.equal(await g.handle(req('/about')), null);
    assert.equal(await g.handle(new Request('https://example.test/i/1', { method: 'POST', headers: { 'user-agent': CHROME, 'sec-fetch-mode': 'navigate', 'x-real-ip': '198.51.100.7' } })), null);
    assert.equal(await g.handle(req('/i/1', GOOGLEBOT, { 'x-real-ip': '66.249.73.129' })), null);
    assert.equal(await g.handle(req('/i/1', CHROME, { cookie: 'session=abc' })), null);
  });

  it('challenges a self-declared unknown bot too, but never a named retrieval crawler', async () => {
    assert.equal((await gw().handle(req('/i/1', 'Mozilla/5.0 (compatible; RandomBot/1.0)')))?.status, 402);
    assert.equal(await gw().handle(req('/i/1', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; OAI-SearchBot/1.3)')), null);
  });

  it('is off unless configured', async () => {
    assert.equal(await gw({ challenge: undefined }).handle(req('/i/1')), null);
  });
});

describe('AI answer-engine indexers', () => {
  it('are charged and named in robots.txt', async () => {
    const g = gw({ challenge: undefined });
    for (const a of AI_INDEX_AGENTS) {
      const res = await g.handle(req('/about', `Mozilla/5.0 (compatible; ${a}/1.0)`));
      assert.equal(res?.status, 402, a);
    }
    assert.match(g.robotsTxt(), /User-agent: meta-webindexer\nDisallow: \/\nAllow: \/crawl/);
  });
});
