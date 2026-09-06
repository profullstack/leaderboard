import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createLeaderboard, projectionStore, sqlStore } from '../src/index.js';

test('a board built from rows that were never written to it', async () => {
  // A pre-existing sales table, of the shape a site already has.
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE crawl_sales (payer TEXT, total_cents INT, created_at INT)');
  const insert = (p, c, at) => db.prepare('INSERT INTO crawl_sales VALUES (?, ?, ?)').run(p, c, at);
  const now = Date.UTC(2026, 8, 6);
  insert('GPTBot', 4200, now - 1000);
  insert('GPTBot', 800, now - 500);
  insert('meta-externalagent', 20900, now - 200);

  const seen = [];
  const store = projectionStore({
    events: ({ since }) => {
      seen.push(since);
      return db.prepare('SELECT payer, total_cents, created_at FROM crawl_sales WHERE created_at >= ?').all(since)
        .map((r) => ({ player: r.payer, name: r.payer, metric: 'spent', delta: r.total_cents, at: r.created_at }));
    },
  });
  const lb = createLeaderboard({ store, cacheMs: 0, boards: { spenders: { label: 'Biggest spenders', metric: 'spent', format: 'usd', side: 'buy', actor: 'Crawler' } } });

  const top = await lb.top({ board: 'spenders' });
  assert.deepEqual(top.rows.map((r) => [r.rank, r.name, r.display]), [[1, 'meta-externalagent', '$209.00'], [2, 'GPTBot', '$50.00']]);
  assert.deepEqual(seen, [0], 'an all-time board asks for everything');

  // A row written to the source table shows up with no leaderboard write at all.
  insert('ClaudeBot', 999999, now - 100);
  assert.equal((await lb.top({ board: 'spenders' })).rows[0].name, 'ClaudeBot');
});

test('a projection refuses writes instead of dropping them', async () => {
  const lb = createLeaderboard({ store: projectionStore({ events: () => [] }), cacheMs: 0 });
  await assert.rejects(() => lb.record({ player: 'a', metrics: { score: 1 } }), /not available on a projection store/);
  await assert.rejects(() => lb.set({ player: 'a', metrics: { score: 1 } }), /not available on a projection store/);
  assert.throws(() => projectionStore({}), /needs an events/);
});

test('badges persist in a real store while the rows stay projected', async () => {
  const db = new DatabaseSync(':memory:');
  const client = { execute({ sql, args = [] }) { const st = db.prepare(sql); return /^\s*(select|with)/i.test(sql) ? { rows: st.all(...args) } : (st.run(...args), { rows: [] }); } };
  const badges = sqlStore(client);
  await badges.migrate();
  const rows = [{ player: 'a', name: 'Ada', metric: 'sales', delta: 12, at: Date.now() }];
  const mk = () => createLeaderboard({ store: projectionStore({ events: () => rows, badges }), cacheMs: 0, boards: { s: { metric: 'sales' } } });
  const fresh = await mk().award('a');
  assert.ok(fresh.some((b) => b.id === 'ten-sales'));
  // A new process, same badge table: still earned, and not re-awarded.
  assert.deepEqual(await mk().award('a'), []);
  assert.ok((await mk().profile('a')).badges.some((b) => b.id === 'ten-sales'));
});
