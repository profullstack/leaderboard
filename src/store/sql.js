/**
 * A store over any SQL client with `execute({ sql, args }) -> { rows }`:
 * @libsql/client (Turso), better-sqlite3 behind a shim, node-postgres behind
 * a shim, Bun's SQL. Three tables, created by `migrate()` or by running
 * `schema` in your own migration tool.
 *
 *   import { createClient } from '@libsql/client';
 *   const store = sqlStore({ execute: (q) => createClient({ url }).execute(q) });
 *   await store.migrate();
 *
 * `dialect: 'postgres'` swaps `?` placeholders for `$n` and picks Postgres
 * types; the default is SQLite. Rows come back as objects keyed by column name
 * in both clients.
 */
export function sqlStore({ execute, prefix = 'lb_', dialect = 'sqlite' } = {}) {
  if (typeof execute !== 'function') throw new TypeError('sqlStore needs an execute({ sql, args }) function');
  const T = { events: `${prefix}events`, gauges: `${prefix}gauges`, badges: `${prefix}badges` };
  const pg = dialect === 'postgres';
  const q = (sql) => {
    if (!pg) return sql;
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  };
  const run = (sql, args = []) => execute({ sql: q(sql), args });
  const rows = async (sql, args) => (await run(sql, args))?.rows ?? [];
  const idType = pg ? 'BIGSERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  const schema = [
    `CREATE TABLE IF NOT EXISTS ${T.events} (id ${idType}, player TEXT NOT NULL, name TEXT, metric TEXT NOT NULL, delta DOUBLE PRECISION NOT NULL, at BIGINT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS ${T.events}_at ON ${T.events} (at)`,
    `CREATE INDEX IF NOT EXISTS ${T.events}_player ON ${T.events} (player)`,
    `CREATE TABLE IF NOT EXISTS ${T.gauges} (player TEXT NOT NULL, metric TEXT NOT NULL, value DOUBLE PRECISION NOT NULL, name TEXT, at BIGINT NOT NULL, PRIMARY KEY (player, metric))`,
    `CREATE TABLE IF NOT EXISTS ${T.badges} (player TEXT NOT NULL, badge TEXT NOT NULL, at BIGINT NOT NULL, PRIMARY KEY (player, badge))`,
  ];

  return {
    schema,
    tables: T,
    async migrate() {
      for (const sql of schema) await run(sql);
    },
    async append(ev) {
      await run(`INSERT INTO ${T.events} (player, name, metric, delta, at) VALUES (?, ?, ?, ?, ?)`, [
        ev.player, ev.name ?? null, ev.metric, ev.delta, ev.at,
      ]);
    },
    async list({ since = 0 } = {}) {
      const r = since > 0
        ? await rows(`SELECT player, name, metric, delta, at FROM ${T.events} WHERE at >= ?`, [since])
        : await rows(`SELECT player, name, metric, delta, at FROM ${T.events}`);
      return r.map((x) => ({ player: String(x.player), name: x.name ?? undefined, metric: String(x.metric), delta: Number(x.delta), at: Number(x.at) }));
    },
    async setGauge(player, metric, value, name, at) {
      await run(
        `INSERT INTO ${T.gauges} (player, metric, value, name, at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (player, metric) DO UPDATE SET value = excluded.value, name = COALESCE(excluded.name, ${T.gauges}.name), at = excluded.at`,
        [player, metric, value, name ?? null, at],
      );
    },
    async gauges() {
      const out = {};
      for (const x of await rows(`SELECT player, metric, value, name, at FROM ${T.gauges}`)) {
        const p = String(x.player);
        const row = out[p] ?? (out[p] = { name: undefined, at: 0, values: {} });
        row.values[String(x.metric)] = Number(x.value);
        const at = Number(x.at);
        if (at >= row.at) {
          row.at = at;
          if (x.name) row.name = String(x.name);
        }
      }
      return out;
    },
    async awardBadge(player, badge, at) {
      const before = await rows(`SELECT 1 AS one FROM ${T.badges} WHERE player = ? AND badge = ?`, [player, badge]);
      if (before.length) return false;
      await run(`INSERT INTO ${T.badges} (player, badge, at) VALUES (?, ?, ?) ON CONFLICT (player, badge) DO NOTHING`, [player, badge, at]);
      return true;
    },
    async badges() {
      const out = {};
      for (const x of await rows(`SELECT player, badge, at FROM ${T.badges}`)) {
        const p = String(x.player);
        (out[p] ?? (out[p] = {}))[String(x.badge)] = Number(x.at);
      }
      return out;
    },
  };
}
