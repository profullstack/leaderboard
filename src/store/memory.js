/**
 * The in-memory store: the reference implementation of the store contract,
 * and enough for a single process, tests, or a leaderboard that is rebuilt
 * from somewhere else on boot.
 *
 * The contract every store meets:
 *   append(event)            -> void          event: { player, name, metric, delta, at }
 *   list({ since })          -> event[]       at >= since, any order
 *   setGauge(player, metric, value, name, at) -> void
 *   gauges()                 -> { [player]: { name, at, values: { [metric]: number } } }
 *   awardBadge(player, badge, at) -> boolean  true when newly awarded
 *   badges()                 -> { [player]: { [badge]: at } }
 */
export function memoryStore() {
  const events = [];
  const gauges = new Map();
  const badges = new Map();
  return {
    async append(ev) {
      events.push({ ...ev });
    },
    async list({ since = 0 } = {}) {
      return since > 0 ? events.filter((e) => e.at >= since) : events.slice();
    },
    async setGauge(player, metric, value, name, at) {
      const row = gauges.get(player) ?? { name, at, values: {} };
      row.values[metric] = value;
      if (name) row.name = name;
      row.at = at;
      gauges.set(player, row);
    },
    async gauges() {
      const out = {};
      for (const [player, row] of gauges) out[player] = { name: row.name, at: row.at, values: { ...row.values } };
      return out;
    },
    async awardBadge(player, badge, at) {
      const row = badges.get(player) ?? {};
      if (row[badge]) return false;
      row[badge] = at;
      badges.set(player, row);
      return true;
    },
    async badges() {
      const out = {};
      for (const [player, row] of badges) out[player] = { ...row };
      return out;
    },
    /** Test helper: everything, for assertions. */
    _dump() {
      return { events: events.slice(), gauges: Object.fromEntries(gauges), badges: Object.fromEntries(badges) };
    },
  };
}
