import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { sqlStore } from '../src/store/sql.js';
import { createLeaderboard } from '../src/index.js';

function client() {
  const db = new DatabaseSync(':memory:');
  return {
    execute({ sql, args = [] }) {
      const stmt = db.prepare(sql);
      if (/^\s*(select|with)/i.test(sql)) return { rows: stmt.all(...args) };
      stmt.run(...args);
      return { rows: [] };
    },
  };
}

test('the SQL store round-trips against real sqlite', async () => {
  const store = sqlStore(client());
  await store.migrate();
  await store.migrate(); // idempotent
  await store.append({ player: 'a', name: 'Ada', metric: 'cents', delta: 100, at: 1000 });
  await store.append({ player: 'a', metric: 'cents', delta: 50, at: 2000 });
  await store.append({ player: 'b', name: 'Bob', metric: 'sales', delta: 1, at: 3000 });
  assert.equal((await store.list()).length, 3);
  assert.deepEqual((await store.list({ since: 2000 })).map((e) => e.at), [2000, 3000]);
  await store.setGauge('a', 'properties', 2, 'Ada', 4000);
  await store.setGauge('a', 'properties', 3, undefined, 5000);
  await store.setGauge('a', 'niches', 1, 'Ada L.', 6000);
  assert.deepEqual(await store.gauges(), { a: { name: 'Ada L.', at: 6000, values: { properties: 3, niches: 1 } } });
  assert.equal(await store.awardBadge('a', 'first-sale', 7000), true);
  assert.equal(await store.awardBadge('a', 'first-sale', 8000), false);
  assert.deepEqual(await store.badges(), { a: { 'first-sale': 7000 } });
});

test('postgres dialect rewrites placeholders and types', async () => {
  const seen = [];
  const store = sqlStore({ execute: async (q) => { seen.push(q); return { rows: [] }; }, dialect: 'postgres', prefix: 'x_' });
  await store.append({ player: 'a', metric: 'm', delta: 1, at: 1 });
  assert.match(seen[0].sql, /VALUES \(\$1, \$2, \$3, \$4, \$5\)/);
  assert.match(store.schema[0], /BIGSERIAL/);
  assert.match(store.schema[0], /x_events/);
  await store.list({ since: 5 });
  assert.match(seen[1].sql, /at >= \$1/);
});

test('a leaderboard on the SQL store', async () => {
  const store = sqlStore(client());
  await store.migrate();
  const lb = createLeaderboard({ store, cacheMs: 0, boards: { sales: { label: 'Sales', metric: 'sales' } } });
  await lb.record({ player: 'a', name: 'Ada', metrics: { sales: 2 } });
  await lb.record({ player: 'b', name: 'Bob', metrics: { sales: 3 } });
  const fresh = await lb.record({ player: 'b', metrics: { sales: 8 } });
  assert.ok(fresh.some((b) => b.id === 'ten-sales'));
  assert.deepEqual((await lb.top({ board: 'sales' })).rows.map((r) => [r.rank, r.name, r.value]), [[1, 'Bob', 11], [2, 'Ada', 2]]);
});
