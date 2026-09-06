import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLeaderboard, memoryStore } from '../src/index.js';
import { leaderboard } from '../src/hono.js';
import { leaderboardRoute } from '../src/next.js';

async function seeded() {
  const lb = createLeaderboard({
    siteName: 'NicheDB', siteUrl: 'https://nichedb.dev', store: memoryStore(), cacheMs: 0, ladder: true,
    boards: { earnings: { label: 'Top earners', metric: 'cents', format: 'usd' }, sales: { label: 'Most sales', metric: 'sales' } },
  });
  await lb.record({ player: 'doc-1', name: 'Dr. Okafor', metrics: { cents: 1900, sales: 1 } });
  await lb.record({ player: 'doc-2', name: 'Dr. <Lee>', metrics: { cents: 400, sales: 3 } });
  await lb.set({ player: 'doc-1', metrics: { properties: 2, niches: 1 } });
  return lb;
}

const get = (lb, path, headers) => lb.handle(new Request('https://nichedb.dev' + path, { headers }));

test('ignores everything outside the base path and non-GET', async () => {
  const lb = await seeded();
  assert.equal(await get(lb, '/'), null);
  assert.equal(await get(lb, '/leaderboards'), null);
  assert.equal(await get(lb, '/api/leaderboard.json'), null);
  assert.equal(await lb.handle(new Request('https://nichedb.dev/leaderboard/earnings.json', { method: 'POST' })), null);
});

test('index, board JSON with me, and a 404 for an unknown board', async () => {
  const lb = await seeded();
  const idx = await (await get(lb, '/leaderboard.json')).json();
  assert.deepEqual(idx.boards.map((b) => b.id), ['earnings', 'sales']);
  assert.equal(idx.ladder.cap, 80);
  const r = await get(lb, '/leaderboard/earnings.json?period=week&limit=1&me=doc-2');
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  const body = await r.json();
  assert.equal(body.rows.length, 1);
  assert.equal(body.rows[0].display, '$19.00');
  assert.equal(body.rows[0].commission, 35);
  assert.equal(body.me.rank, 2);
  assert.equal(body.me.qualified, true);
  assert.equal((await get(lb, '/leaderboard/nope.json')).status, 404);
  assert.equal((await get(lb, '/leaderboard/earnings.json?period=bogus')).status, 200, 'bad period falls back');
});

test('RSS escapes and links to the share page', async () => {
  const lb = await seeded();
  const r = await get(lb, '/leaderboard/sales.xml');
  assert.match(r.headers.get('content-type'), /rss\+xml/);
  const xml = await r.text();
  assert.match(xml, /<title>#1 Dr\. &lt;Lee&gt;: 3<\/title>/);
  assert.match(xml, /<link>https:\/\/nichedb\.dev\/leaderboard\/u\/doc-2<\/link>/);
  assert.doesNotMatch(xml, /<Lee>/);
});

test('share page and profile JSON', async () => {
  const lb = await seeded();
  const page = await (await get(lb, '/leaderboard/u/doc-1')).text();
  assert.match(page, /og:title" content="Dr\. Okafor: #1 on NicheDB"/);
  assert.match(page, /35%/);
  assert.match(page, /Add one property to reach 40%/);
  const p = await (await get(lb, '/leaderboard/u/doc-2.json')).json();
  assert.equal(p.name, 'Dr. <Lee>');
  assert.equal(p.ranks.sales.all, 1);
  assert.equal(p.shareUrl, 'https://nichedb.dev/leaderboard/u/doc-2');
  assert.equal((await get(lb, '/leaderboard/u/ghost')).status, 404);
  assert.equal((await get(lb, '/leaderboard/u/ghost.json')).status, 404);
});

test('embed page, full page, and the widget script', async () => {
  const lb = await seeded();
  const embed = await (await get(lb, '/leaderboard/embed?board=sales&period=month&sticky=bottom-right&me=doc-1')).text();
  assert.match(embed, /<script src="\/leaderboard\/embed\.js" data-board="sales" data-period="month" data-limit="25" data-sticky="bottom-right" data-me="doc-1" data-base="\/leaderboard">/);
  const full = await (await get(lb, '/leaderboard')).text();
  assert.match(full, /max-width:760px/);
  const js = await get(lb, '/leaderboard/embed.js');
  assert.match(js.headers.get('content-type'), /javascript/);
  const src = await js.text();
  assert.match(src, /document\.currentScript/);
  assert.match(src, /pflb-pill/);
  // The widget must at least parse.
  new Function(src);
});

test('basePath is configurable and the widget uses it', async () => {
  const lb = createLeaderboard({ basePath: '/api/v1/board/', store: memoryStore() });
  assert.equal(lb.basePath, '/api/v1/board');
  assert.equal((await get(lb, '/api/v1/board.json')).status, 200);
  assert.equal(await get(lb, '/leaderboard.json'), null);
  const embed = await (await get(lb, '/api/v1/board/embed')).text();
  assert.match(embed, /src="\/api\/v1\/board\/embed\.js"/);
});

test('hono and next adapters', async () => {
  const lb = await seeded();
  const mw = leaderboard(lb);
  let nexted = false;
  const answered = await mw({ req: { raw: new Request('https://nichedb.dev/leaderboard/earnings.json') } }, async () => { nexted = true; });
  assert.equal(answered.status, 200);
  assert.equal(nexted, false);
  await mw({ req: { raw: new Request('https://nichedb.dev/other') } }, async () => { nexted = true; });
  assert.equal(nexted, true);
  const { GET } = leaderboardRoute(lb);
  assert.equal((await GET(new Request('https://nichedb.dev/leaderboard/sales.xml'))).status, 200);
  assert.equal((await GET(new Request('https://nichedb.dev/leaderboard/zzz/yyy'))).status, 404);
  assert.equal(typeof leaderboardRoute({ store: memoryStore() }).GET, 'function', 'options also accepted');
});
