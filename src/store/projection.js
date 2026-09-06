import { memoryStore } from './memory.js';

/**
 * A read-through store over tables you already have.
 *
 * Most sites that could show a leaderboard are already recording the facts it
 * would rank: sales, payments, referral commissions, requests served. Copying
 * those into a second set of tables means a dual write, and a dual write means
 * the board and the ledger disagree the first time one of them fails. So
 * project instead: hand back events built from the rows you already trust.
 *
 *   projectionStore({
 *     events: async ({ since }) => {
 *       const rows = await sql`select payer, total_cents, created_at from crawl_sales
 *                              where created_at >= ${new Date(since)}`;
 *       return rows.map((r) => ({
 *         player: r.payer, name: r.payer, metric: 'spent',
 *         delta: r.total_cents, at: +new Date(r.created_at),
 *       }));
 *     },
 *   })
 *
 * `since` is 0 for an all-time board, so the query must handle "everything".
 * Badges still need somewhere durable to live, since they are awarded rather
 * than derived: pass `badges` (a `sqlStore`, or any object with `awardBadge`
 * and `badges`). The default keeps them in memory, which is fine for a board
 * with no badges and wrong for one with them.
 *
 * The store is read-only. `record()` and `set()` on a leaderboard backed by a
 * projection throw, rather than silently dropping a write that the projection
 * would overwrite on the next read anyway.
 */
export function projectionStore({ events, gauges, badges } = {}) {
  if (typeof events !== 'function') throw new TypeError('projectionStore needs an events({ since }) function');
  const badgeStore = badges ?? memoryStore();
  const readOnly = (method) => () => {
    throw new Error(`${method}() is not available on a projection store: write to the source table instead, the board reads it back`);
  };
  return {
    async list({ since = 0 } = {}) {
      const rows = (await events({ since })) ?? [];
      return rows.map((e) => ({
        player: String(e.player),
        name: e.name == null ? undefined : String(e.name),
        metric: String(e.metric),
        delta: Number(e.delta) || 0,
        at: Number(e.at) || 0,
      }));
    },
    async gauges() {
      return (typeof gauges === 'function' ? await gauges() : null) ?? {};
    },
    append: readOnly('record'),
    setGauge: readOnly('set'),
    awardBadge: (...a) => badgeStore.awardBadge(...a),
    badges: () => badgeStore.badges(),
  };
}
