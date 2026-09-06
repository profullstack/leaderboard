/**
 * The commission ladder: a seller's cut climbs with the number of properties
 * they own and the number of niches they can promote to. The defaults are the
 * program as announced: start at 20%, top out at 80%, five points per property
 * and five per niche, six of each to reach the cap.
 *
 *   const ladder = commissionLadder();
 *   ladder.rate({ properties: 1, niches: 0 });   // 25
 *   ladder.next({ properties: 1, niches: 0 });   // { add: 'property', rate: 30, ... }
 *
 * Every number is an option, so a program with a different shape passes its
 * own. `rate()` returns whole percent as an integer.
 */
export function commissionLadder(options = {}) {
  const base = num(options.base, 20);
  const cap = num(options.cap, 80);
  const perProperty = num(options.perProperty, 5);
  const perNiche = num(options.perNiche, 5);
  const maxProperties = num(options.maxProperties, 6);
  const maxNiches = num(options.maxNiches, 6);
  const propertiesMetric = options.propertiesMetric ?? 'properties';
  const nichesMetric = options.nichesMetric ?? 'niches';

  function counts(state = {}) {
    const properties = Math.max(0, Math.floor(num(state[propertiesMetric] ?? state.properties, 0)));
    const niches = Math.max(0, Math.floor(num(state[nichesMetric] ?? state.niches, 0)));
    return { properties, niches };
  }

  function rate(state) {
    const { properties, niches } = counts(state);
    const raw = base + perProperty * Math.min(properties, maxProperties) + perNiche * Math.min(niches, maxNiches);
    return Math.min(cap, Math.max(0, Math.round(raw)));
  }

  /** The single cheapest step up from here, or null at the cap. */
  function next(state) {
    const c = counts(state);
    const here = rate(c);
    if (here >= cap) return null;
    const candidates = [];
    if (c.properties < maxProperties) {
      candidates.push({ add: 'property', rate: rate({ properties: c.properties + 1, niches: c.niches }) });
    }
    if (c.niches < maxNiches) {
      candidates.push({ add: 'niche', rate: rate({ properties: c.properties, niches: c.niches + 1 }) });
    }
    const better = candidates.filter((x) => x.rate > here).sort((a, b) => b.rate - a.rate);
    const pick = better[0];
    if (!pick) return null;
    return { ...pick, from: here, gain: pick.rate - here, toCap: cap - here };
  }

  /** Every step on the ladder, for a docs table or a pricing page. */
  function table() {
    const rows = [];
    for (let p = 0; p <= maxProperties; p++) {
      for (let n = 0; n <= maxNiches; n++) rows.push({ properties: p, niches: n, rate: rate({ properties: p, niches: n }) });
    }
    return rows;
  }

  function describe() {
    return `Start at ${base}%. Each property adds ${perProperty} points (up to ${maxProperties}), each niche adds ${perNiche} (up to ${maxNiches}). Cap ${cap}%.`;
  }

  return {
    base, cap, perProperty, perNiche, maxProperties, maxNiches, propertiesMetric, nichesMetric,
    rate, next, table, describe,
  };
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
