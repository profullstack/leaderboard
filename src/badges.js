/**
 * Badges are predicates over a player's profile. A badge is awarded once and
 * kept forever, so `when` only has to be true at one moment: the week you were
 * in the top ten counts even after you fall out.
 *
 * The profile handed to `when` carries: `totals` (summed counters, all time),
 * `gauges` (absolute values you `set`), `streak`, `bestStreak`, `ranks`
 * (`{ [boardId]: { [period]: rank } }`) and, when a ladder is configured,
 * `commission.rate`.
 *
 * This is the default set for a marketplace with sellers, properties and
 * niches. Pass your own array to `createLeaderboard({ badges })` for anything
 * else; the shape is the whole contract.
 */
export function defaultBadges(names = {}) {
  const sales = names.sales ?? 'sales';
  const properties = names.properties ?? 'properties';
  const niches = names.niches ?? 'niches';
  const t = (p, k) => Number(p.totals?.[k] ?? 0);
  const g = (p, k) => Number(p.gauges?.[k] ?? 0);
  const bestRank = (p, period) => {
    let best = Infinity;
    for (const board of Object.values(p.ranks ?? {})) {
      const r = board?.[period];
      if (Number.isFinite(r) && r < best) best = r;
    }
    return best;
  };
  return [
    { id: 'first-sale', emoji: '🎉', label: 'First sale', describe: 'Made a first sale', when: (p) => t(p, sales) >= 1 },
    { id: 'ten-sales', emoji: '🔟', label: 'Ten sales', describe: 'Ten sales, all time', when: (p) => t(p, sales) >= 10 },
    { id: 'hundred-sales', emoji: '💯', label: 'Hundred sales', describe: 'One hundred sales, all time', when: (p) => t(p, sales) >= 100 },
    { id: 'streak-7', emoji: '🔥', label: 'Seven day streak', describe: 'Active seven days in a row', when: (p) => (p.bestStreak ?? 0) >= 7 },
    { id: 'streak-30', emoji: '🌋', label: 'Thirty day streak', describe: 'Active thirty days in a row', when: (p) => (p.bestStreak ?? 0) >= 30 },
    { id: 'three-properties', emoji: '🏠', label: 'Three properties', describe: 'Owns three properties', when: (p) => g(p, properties) >= 3 },
    { id: 'five-niches', emoji: '🎯', label: 'Five niches', describe: 'Promotes to five niches', when: (p) => g(p, niches) >= 5 },
    { id: 'top-ten-week', emoji: '🏅', label: 'Top ten this week', describe: 'Ranked in a weekly top ten', when: (p) => bestRank(p, 'week') <= 10 },
    { id: 'number-one', emoji: '👑', label: 'Number one', describe: 'Held first place on any board', when: (p) => bestRank(p, 'all') === 1 || bestRank(p, 'week') === 1 || bestRank(p, 'month') === 1 },
    { id: 'eighty-club', emoji: '💸', label: '80% club', describe: 'Reached the top commission rate', when: (p) => (p.commission?.rate ?? 0) >= 80 },
  ];
}
