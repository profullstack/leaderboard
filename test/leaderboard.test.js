import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLeaderboard, memoryStore, streaks, format } from '../src/index.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 6, 12); // 2026-09-06 noon

function make(extra = {}) {
  let t = T0;
  const clock = { now: () => t, tick: (ms) => { t += ms; } };
  const lb = createLeaderboard({
    siteName: 'Test', siteUrl: 'https://example.test',
    store: memoryStore(), cacheMs: 0, now: clock.now, ladder: true,
    boards: {
      earnings: { label: 'Top earners', metric: 'cents', format: 'usd', unit: 'Earned' },
      sales: { label: 'Most sales', metric: 'sales', tiebreak: 'cents' },
      streaks: { label: 'Streaks', metric: 'streak', min: 1 },
      properties: { label: 'Properties', metric: 'properties' },
    },
    ...extra,
  });
  return { lb, clock };
}

test('record sums counters, ranks by value then tiebreak, formats', async () => {
  const { lb } = make();
  await lb.record({ player: 'a', name: 'Ada', metrics: { cents: 500, sales: 1 } });
  await lb.record({ player: 'b', name: 'Bob', metrics: { cents: 900, sales: 1 } });
  await lb.record({ player: 'a', name: 'Ada', metrics: { cents: 500, sales: 1 } });
  const top = await lb.top({ board: 'earnings' });
  assert.deepEqual(top.rows.map((r) => [r.rank, r.id, r.value, r.display]), [[1, 'a', 1000, '$10.00'], [2, 'b', 900, '$9.00']]);
  const sales = await lb.top({ board: 'sales' });
  assert.deepEqual(sales.rows.map((r) => [r.id, r.value]), [['a', 2], ['b', 1]]);
});

test('ties break on the tiebreak metric, then earliest activity', async () => {
  const { lb, clock } = make();
  await lb.record({ player: 'late', metrics: { sales: 1, cents: 100 } });
  clock.tick(1000);
  await lb.record({ player: 'rich', metrics: { sales: 1, cents: 900 } });
  clock.tick(1000);
  await lb.record({ player: 'early', metrics: { sales: 1, cents: 100 }, at: T0 - 5000 });
  const rows = (await lb.top({ board: 'sales' })).rows.map((r) => r.id);
  assert.deepEqual(rows, ['rich', 'early', 'late']);
});

test('periods window counters; gauges and streaks ignore the window', async () => {
  const { lb, clock } = make();
  await lb.record({ player: 'old', metrics: { cents: 5000 }, at: T0 - 40 * DAY });
  await lb.record({ player: 'new', metrics: { cents: 100 }, at: T0 - 2 * DAY });
  await lb.set({ player: 'old', metrics: { properties: 4 } });
  assert.deepEqual((await lb.top({ board: 'earnings', period: 'all' })).rows.map((r) => r.id), ['old', 'new']);
  assert.deepEqual((await lb.top({ board: 'earnings', period: 'month' })).rows.map((r) => r.id), ['new']);
  assert.deepEqual((await lb.top({ board: 'earnings', period: 'week' })).rows.map((r) => r.id), ['new']);
  assert.deepEqual((await lb.top({ board: 'properties', period: 'week' })).rows.map((r) => [r.id, r.value]), [['old', 4]]);
  clock.tick(0);
});

test('streaks count consecutive UTC days and only stay current through yesterday', () => {
  const today = Math.floor(T0 / DAY);
  assert.deepEqual(streaks(new Set([today - 2, today - 1, today]), T0), { current: 3, best: 3 });
  assert.deepEqual(streaks(new Set([today - 3, today - 2]), T0), { current: 0, best: 2 });
  assert.deepEqual(streaks(new Set([today - 9, today - 8, today - 7, today - 1]), T0), { current: 1, best: 3 });
  assert.deepEqual(streaks(new Set(), T0), { current: 0, best: 0 });
});

test('the streak board, standing, and a player below the minimum', async () => {
  const { lb } = make();
  for (let i = 4; i >= 0; i--) await lb.record({ player: 'daily', name: 'Daily', metrics: { sales: 1 }, at: T0 - i * DAY });
  await lb.record({ player: 'once', name: 'Once', metrics: { sales: 1 }, at: T0 - 10 * DAY });
  const s = await lb.top({ board: 'streaks' });
  assert.deepEqual(s.rows.map((r) => [r.id, r.value, r.bestStreak]), [['daily', 5, 5]]);
  const st = await lb.standing({ player: 'once', board: 'streaks' });
  assert.equal(st.qualified, false);
  assert.equal(st.rank, null);
  const mine = await lb.standing({ player: 'daily', board: 'sales', period: 'week' });
  assert.equal(mine.rank, 1);
  assert.equal(mine.value, 5);
  assert.equal(await lb.standing({ player: 'nobody', board: 'sales' }), null);
});

test('badges award once, stick, and report what was new', async () => {
  const seen = [];
  const { lb } = make({ onBadge: (x) => seen.push(x.badge.id) });
  let fresh = await lb.record({ player: 'a', name: 'Ada', metrics: { sales: 1, cents: 100 } });
  assert.deepEqual(fresh.map((b) => b.id).sort(), ['first-sale', 'number-one', 'top-ten-week']);
  fresh = await lb.record({ player: 'a', metrics: { sales: 1 } });
  assert.deepEqual(fresh, [], 'nothing new the second time');
  // b overtakes a; a keeps number-one forever.
  await lb.record({ player: 'b', name: 'Bob', metrics: { sales: 5, cents: 1 } });
  const a = await lb.profile('a');
  assert.ok(a.badges.some((b) => b.id === 'number-one'));
  assert.equal(a.ranks.sales.all, 2);
  fresh = await lb.set({ player: 'a', metrics: { properties: 6, niches: 6 } });
  assert.deepEqual(fresh.map((b) => b.id).sort(), ['eighty-club', 'five-niches', 'three-properties']);
  assert.equal(a.commission.rate, 20, 'profile snapshots do not mutate');
  assert.equal((await lb.profile('a')).commission.rate, 80);
  assert.deepEqual(seen.slice(0, 3).sort(), ['first-sale', 'number-one', 'top-ten-week']);
});

test('custom badges replace the defaults', async () => {
  const { lb } = make({ badges: [{ id: 'hello', emoji: '👋', label: 'Hello', when: (p) => p.totals.sales >= 1 }] });
  const fresh = await lb.record({ player: 'a', metrics: { sales: 1 } });
  assert.deepEqual(fresh.map((b) => b.id), ['hello']);
  assert.deepEqual(lb.index().badges.map((b) => b.id), ['hello']);
});

test('names: the latest wins, and the id is the fallback', async () => {
  const { lb } = make();
  await lb.record({ player: 'a', metrics: { sales: 1 } });
  assert.equal((await lb.profile('a')).name, 'a');
  await lb.record({ player: 'a', name: 'Ada', metrics: { sales: 1 } });
  await lb.set({ player: 'a', name: 'Ada L.', metrics: { properties: 1 } });
  assert.equal((await lb.profile('a')).name, 'Ada L.');
});

test('limit, offset, limitMax and the cache', async () => {
  const { lb, clock } = make({ limitMax: 3, cacheMs: 60_000 });
  for (let i = 0; i < 10; i++) await lb.record({ player: 'p' + i, metrics: { cents: (i + 1) * 100 } });
  const page = await lb.top({ board: 'earnings', limit: 50, offset: 1 });
  assert.equal(page.total, 10);
  assert.deepEqual(page.rows.map((r) => r.id), ['p8', 'p7', 'p6']);
  // Cached: a store write from elsewhere is invisible until invalidate() or the TTL.
  await lb.record({ player: 'p9', metrics: { cents: 1 } });
  assert.equal((await lb.top({ board: 'earnings' })).rows[0].value, 1001, 'record() drops the cache');
  clock.tick(1);
  assert.equal((await lb.top({ board: 'earnings' })).rows[0].value, 1001);
});

test('format', () => {
  assert.equal(format(123456, 'usd'), '$1,234.56');
  assert.equal(format(42.4, 'percent'), '42%');
  assert.equal(format(1234), '1,234');
  assert.equal(format(3.14159), '3.14');
});

test('validation', async () => {
  const { lb } = make();
  await assert.rejects(() => lb.record({ metrics: { x: 1 } }), /player/);
  await assert.rejects(() => lb.record({ player: 'a', metrics: {} }), /metric/);
  await assert.rejects(() => lb.top({ board: 'nope' }), /unknown board/);
  assert.throws(() => createLeaderboard({ boards: { 'bad id': {} } }), /board id/);
});


test('boards declare a side and are never mixed across sides', async () => {
  const lb = createLeaderboard({
    store: memoryStore(), cacheMs: 0, siteName: 'NicheDB', siteUrl: 'https://nichedb.dev',
    boards: {
      earners: { label: 'Top earners', metric: 'cents', format: 'usd', side: 'sell', actor: 'Publisher' },
      spenders: { label: 'Biggest spenders', metric: 'spent', format: 'usd', side: 'buy', actor: 'Crawler' },
      crawled: { label: 'Most pages crawled', metric: 'pages', side: 'use' },
    },
  });
  const idx = lb.index();
  assert.deepEqual(idx.sides.map((s) => [s.side, s.label, s.boards.map((b) => b.id)]), [
    ['sell', 'Earning', ['earners']],
    ['buy', 'Spending', ['spenders']],
    ['use', 'Usage', ['crawled']],
  ]);
  // The same actor can hold a rank on both sides without the numbers being pooled.
  await lb.record({ player: 'gptbot', name: 'GPTBot', metrics: { spent: 4200, pages: 90000 } });
  await lb.record({ player: 'pub-1', name: 'Dr. Okafor', metrics: { cents: 4200 } });
  const buy = await lb.top({ board: 'spenders' });
  const sell = await lb.top({ board: 'earners' });
  assert.deepEqual(buy.rows.map((r) => r.id), ['gptbot'], 'the buy board holds only buyers');
  assert.deepEqual(sell.rows.map((r) => r.id), ['pub-1'], 'the sell board holds only sellers');
  assert.equal(buy.board.side, 'buy');
  assert.equal(buy.board.actor, 'Crawler');
  assert.equal(buy.rows[0].display, sell.rows[0].display, 'equal money, and still two separate boards');
  // Every response carries the grouping so a widget can segregate without a second fetch.
  assert.deepEqual(buy.sides.map((s) => s.side), ['sell', 'buy', 'use']);
});

test('a bad side is refused, and sell is the default', () => {
  assert.throws(() => createLeaderboard({ boards: { x: { side: 'sideways' } } }), /board side must be one of/);
  const lb = createLeaderboard({ store: memoryStore(), boards: { x: { metric: 'n' } } });
  assert.equal(lb.boards[0].side, 'sell');
});

test('custom side labels', () => {
  const lb = createLeaderboard({ store: memoryStore(), sides: { buy: 'Bots paying us' }, boards: { s: { metric: 'spent', side: 'buy' } } });
  assert.equal(lb.index().sides[0].label, 'Bots paying us');
});


test('a commission rate never appears on a buy or usage board', async () => {
  const lb = createLeaderboard({
    store: memoryStore(), cacheMs: 0, ladder: true,
    boards: {
      earners: { metric: 'cents', side: 'sell' },
      spenders: { metric: 'spent', side: 'buy' },
      crawled: { metric: 'pages', side: 'use' },
    },
  });
  await lb.record({ player: 'gptbot', metrics: { spent: 4200, pages: 900, cents: 10 } });
  await lb.set({ player: 'gptbot', metrics: { properties: 6, niches: 6 } });
  assert.equal((await lb.top({ board: 'earners' })).rows[0].commission, 80);
  assert.equal((await lb.top({ board: 'spenders' })).rows[0].commission, undefined);
  assert.equal((await lb.top({ board: 'crawled' })).rows[0].commission, undefined);
});
