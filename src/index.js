import { memoryStore } from './store/memory.js';
import { commissionLadder } from './ladder.js';
import { defaultBadges } from './badges.js';
import { widgetSource } from './embed.js';

export { commissionLadder } from './ladder.js';
export { defaultBadges } from './badges.js';
export { memoryStore } from './store/memory.js';
export { sqlStore } from './store/sql.js';
export { projectionStore } from './store/projection.js';

const DAY = 86_400_000;
const PERIODS = { all: 0, day: DAY, week: 7 * DAY, month: 30 * DAY };

/**
 * Build a leaderboard.
 *
 *   const lb = createLeaderboard({
 *     siteName: 'NicheDB', siteUrl: 'https://nichedb.dev',
 *     store: sqlStore({ execute }),
 *     boards: {
 *       earnings: { label: 'Top earners', metric: 'cents', format: 'usd' },
 *       sales:    { label: 'Most sales',  metric: 'sales' },
 *       streaks:  { label: 'Longest streaks', metric: 'streak' },
 *     },
 *     ladder: commissionLadder(),
 *   });
 *   await lb.record({ player: 'u_42', name: 'Dr. Okafor', metrics: { cents: 1900, sales: 1 } });
 *   await lb.set({ player: 'u_42', metrics: { properties: 2, niches: 4 } });
 *
 * Counters go in through `record` and are summed per period; gauges go in
 * through `set` and are the current value. `streak` and `bestStreak` are
 * derived from the days a player recorded anything. Every board ranks one
 * metric of any of those three kinds.
 */
export function createLeaderboard(options = {}) {
  const store = options.store ?? memoryStore();
  const basePath = trimSlash(options.basePath ?? '/leaderboard');
  const siteName = options.siteName ?? 'Leaderboard';
  const siteUrl = options.siteUrl ? trimSlash(options.siteUrl) : '';
  const periods = (options.periods ?? ['all', 'week', 'month']).filter((p) => p in PERIODS);
  const defaultPeriod = periods.includes(options.defaultPeriod) ? options.defaultPeriod : periods[0];
  const sides = { ...DEFAULT_SIDES, ...(options.sides ?? {}) };
  const boards = normaliseBoards(options.boards);
  const defaultBoard = boards[0].id;
  const ladder = options.ladder === undefined ? null : options.ladder === true ? commissionLadder() : options.ladder;
  const badges = options.badges ?? (ladder ? defaultBadges({ properties: ladder.propertiesMetric, niches: ladder.nichesMetric }) : defaultBadges());
  const cacheMs = Math.max(0, Number(options.cacheMs ?? 15_000));
  const limitMax = Math.max(1, Number(options.limitMax ?? 100));
  const profileUrl = options.profileUrl ?? ((id) => `${basePath}/u/${encodeURIComponent(id)}`);
  const now = options.now ?? (() => Date.now());
  const onBadge = options.onBadge ?? null;

  let cache = null; // { at, all: Map<player, profile>, ordered }

  async function record({ player, name, metrics, at } = {}) {
    if (!player) throw new TypeError('record needs a player');
    const when = at ?? now();
    const entries = Object.entries(metrics ?? {}).filter(([, v]) => Number.isFinite(Number(v)));
    if (!entries.length) throw new TypeError('record needs at least one numeric metric');
    for (const [metric, delta] of entries) await store.append({ player: String(player), name, metric, delta: Number(delta), at: when });
    cache = null;
    return award(String(player));
  }

  async function set({ player, name, metrics, at } = {}) {
    if (!player) throw new TypeError('set needs a player');
    const when = at ?? now();
    for (const [metric, value] of Object.entries(metrics ?? {})) await store.setGauge(String(player), metric, Number(value), name, when);
    cache = null;
    return award(String(player));
  }

  /** Re-check every badge for one player; returns the badges newly awarded. */
  async function award(player) {
    const profiles = await computeAll();
    const p = profiles.get(player);
    if (!p) return [];
    const fresh = [];
    for (const b of badges) {
      if (p.badges.some((x) => x.id === b.id)) continue;
      let hit = false;
      try { hit = Boolean(b.when(p)); } catch { hit = false; }
      if (!hit) continue;
      const at = now();
      if (await store.awardBadge(player, b.id, at)) {
        const earned = { id: b.id, emoji: b.emoji ?? '', label: b.label ?? b.id, describe: b.describe ?? '', at };
        p.badges.push(earned);
        fresh.push(earned);
        if (onBadge) { try { await onBadge({ player, name: p.name, badge: earned }); } catch {} }
      }
    }
    return fresh;
  }

  /** Every player's all-time profile, cached for `cacheMs`. */
  async function computeAll() {
    if (cache && now() - cache.at < cacheMs) return cache.all;
    const t = now();
    const [events, gauges, awarded] = await Promise.all([store.list({ since: 0 }), store.gauges(), store.badges()]);
    const all = new Map();
    const profile = (id) => all.get(id) ?? (all.set(id, blank(id)), all.get(id));
    for (const e of events) {
      const p = profile(e.player);
      p.totals[e.metric] = (p.totals[e.metric] ?? 0) + e.delta;
      if (e.name && e.at >= p.nameAt) { p.name = e.name; p.nameAt = e.at; }
      if (e.at > p.lastAt) p.lastAt = e.at;
      if (e.at < p.firstAt) p.firstAt = e.at;
      p.days.add(dayOf(e.at));
    }
    for (const [id, row] of Object.entries(gauges)) {
      const p = profile(id);
      p.gauges = { ...row.values };
      if (row.name && row.at >= p.nameAt) { p.name = row.name; p.nameAt = row.at; }
    }
    for (const p of all.values()) {
      const s = streaks(p.days, t);
      p.streak = s.current;
      p.bestStreak = s.best;
      if (ladder) p.commission = { rate: ladder.rate(p.gauges), next: ladder.next(p.gauges) };
      delete p.days;
    }
    // Windows and ranks: each board, each period.
    const byPeriod = {};
    for (const period of periods) byPeriod[period] = windowTotals(events, all, period, t);
    for (const b of boards) {
      for (const period of periods) {
        const ranked = rank(b, all, byPeriod[period]);
        ranked.forEach((r, i) => {
          const p = all.get(r.id);
          (p.ranks[b.id] ??= {})[period] = i + 1;
          (p.values[b.id] ??= {})[period] = r.value;
        });
      }
    }
    for (const p of all.values()) {
      const mine = awarded[p.id] ?? {};
      p.badges = badges.filter((b) => mine[b.id]).map((b) => ({ id: b.id, emoji: b.emoji ?? '', label: b.label ?? b.id, describe: b.describe ?? '', at: mine[b.id] }));
    }
    cache = { at: t, all };
    return all;
  }

  function windowTotals(events, all, period, t) {
    if (period === 'all') return null;
    const since = t - PERIODS[period];
    const totals = new Map();
    for (const e of events) {
      if (e.at < since) continue;
      const row = totals.get(e.player) ?? {};
      row[e.metric] = (row[e.metric] ?? 0) + e.delta;
      totals.set(e.player, row);
    }
    return totals;
  }

  function valueOf(board, p, window) {
    const m = board.metric;
    if (m === 'streak') return p.streak;
    if (m === 'bestStreak') return p.bestStreak;
    if (m in p.gauges) return p.gauges[m];
    if (window) return window.get(p.id)?.[m] ?? 0;
    return p.totals[m] ?? 0;
  }

  function rank(board, all, window) {
    const rows = [];
    for (const p of all.values()) {
      const value = valueOf(board, p, window);
      if (value < board.min) continue;
      if (window && !window.has(p.id) && !(board.metric in p.gauges) && board.metric !== 'streak' && board.metric !== 'bestStreak') continue;
      rows.push({ id: p.id, value, tie: board.tiebreak ? valueOf({ metric: board.tiebreak, min: -Infinity }, p, window) : 0, lastAt: p.lastAt, name: p.name });
    }
    const dir = board.order === 'asc' ? 1 : -1;
    rows.sort((a, b) => (a.value - b.value) * dir || (b.tie - a.tie) || (a.lastAt - b.lastAt) || a.name.localeCompare(b.name));
    return rows;
  }

  function boardOf(id) {
    return boards.find((b) => b.id === id) ?? null;
  }

  function periodOf(p) {
    return periods.includes(p) ? p : defaultPeriod;
  }

  async function top({ board = defaultBoard, period = defaultPeriod, limit = 25, offset = 0 } = {}) {
    const b = boardOf(board);
    if (!b) throw new RangeError(`unknown board: ${board}`);
    period = periodOf(period);
    const all = await computeAll();
    const rows = [];
    for (const p of all.values()) {
      const r = p.ranks[b.id]?.[period];
      if (r) rows.push(row(p, b, period, r));
    }
    rows.sort((a, c) => a.rank - c.rank);
    const n = Math.min(limitMax, Math.max(1, Number(limit) || 25));
    return { board: pub(b), sides: boardsIndex().sides, period, periods, generatedAt: new Date(now()).toISOString(), total: rows.length, rows: rows.slice(Number(offset) || 0, (Number(offset) || 0) + n) };
  }

  async function standing({ player, board = defaultBoard, period = defaultPeriod } = {}) {
    const b = boardOf(board);
    if (!b || !player) return null;
    period = periodOf(period);
    const all = await computeAll();
    const p = all.get(String(player));
    if (!p) return null;
    const r = p.ranks[b.id]?.[period] ?? null;
    return { ...row(p, b, period, r), qualified: r !== null, min: b.min };
  }

  async function profile(player) {
    const all = await computeAll();
    const p = all.get(String(player));
    if (!p) return null;
    const { nameAt, ...rest } = p;
    return { ...rest, url: profileUrl(p.id), shareUrl: `${siteUrl}${basePath}/u/${encodeURIComponent(p.id)}` };
  }

  function row(p, b, period, r) {
    const value = p.values[b.id]?.[period] ?? 0;
    return {
      rank: r, id: p.id, name: p.name, value, display: format(value, b.format),
      streak: p.streak, bestStreak: p.bestStreak,
      badges: p.badges.map(({ id, emoji, label }) => ({ id, emoji, label })),
      // A commission rate is a property of earning. Showing one against a buyer
      // or a usage count states something false about the number next to it.
      commission: b.side === 'sell' && p.commission ? p.commission.rate : undefined,
      url: profileUrl(p.id),
    };
  }

  function boardsIndex() {
    const grouped = SIDES.filter((side) => boards.some((b) => b.side === side))
      .map((side) => ({ side, label: sides[side], boards: boards.filter((b) => b.side === side).map(pub) }));
    return { site: siteName, siteUrl, basePath, periods, defaultPeriod, sides: grouped, boards: boards.map(pub), ladder: ladder ? { base: ladder.base, cap: ladder.cap, describe: ladder.describe() } : null, badges: badges.map(({ id, emoji, label, describe }) => ({ id, emoji, label, describe })) };
  }

  /** Fetch-API handler: answers under basePath, null for anything else. */
  async function handle(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return null;
    const url = new URL(request.url);
    const path = trimSlash(url.pathname);
    if (path !== basePath && !path.startsWith(basePath + '/') && path !== basePath + '.json') return null;
    const rest = path === basePath ? '' : path.slice(basePath.length);
    const q = url.searchParams;
    const period = periodOf(q.get('period'));
    const limit = q.get('limit') ?? 25;

    if (rest === '.json' || rest === '/index.json') return json(boardsIndex());
    if (rest === '/embed.js') return new Response(widgetSource(), { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
    if (rest === '' || rest === '/embed' || rest === '/index.html') {
      const b = boardOf(q.get('board') ?? defaultBoard) ?? boards[0];
      return html(embedPage({ board: b, period, limit, sticky: q.get('sticky'), theme: q.get('theme'), me: q.get('me'), full: rest !== '/embed' }));
    }
    let m;
    if ((m = rest.match(/^\/u\/([^/]+)\.json$/))) {
      const p = await profile(decodeURIComponent(m[1]));
      return p ? json(p) : json({ error: 'unknown player' }, 404);
    }
    if ((m = rest.match(/^\/u\/([^/]+)$/))) {
      const p = await profile(decodeURIComponent(m[1]));
      return p ? html(sharePage(p)) : html(notFoundPage(), 404);
    }
    if ((m = rest.match(/^\/([a-z0-9_-]+)\.(json|xml|rss)$/i))) {
      const b = boardOf(m[1]);
      if (!b) return json({ error: 'unknown board' }, 404);
      const result = await top({ board: b.id, period, limit, offset: q.get('offset') ?? 0 });
      if (m[2] === 'json') {
        const me = q.get('me');
        if (me) result.me = await standing({ player: me, board: b.id, period });
        return json(result);
      }
      return new Response(rss(result), { headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=300' } });
    }
    return null;
  }

  function rss(result) {
    const title = `${siteName}: ${result.board.label}, ${sides[result.board.side]} (${periodLabel(result.period)})`;
    const link = `${siteUrl}${basePath}?board=${result.board.id}&period=${result.period}`;
    const items = result.rows.map((r) => {
      const badgeText = r.badges.map((b) => `${b.emoji} ${b.label}`).join(', ');
      return `    <item>
      <title>${esc(`#${r.rank} ${r.name}: ${r.display}`)}</title>
      <link>${esc(absolute(r.url))}</link>
      <guid isPermaLink="false">${esc(`${result.board.id}:${result.period}:${r.id}:${r.value}`)}</guid>
      <description>${esc(`${r.name} is #${r.rank} on ${result.board.label} with ${r.display}. Streak ${r.streak} (best ${r.bestStreak}).${badgeText ? ' Badges: ' + badgeText + '.' : ''}`)}</description>
    </item>`;
    });
    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${esc(title)}</title>
    <link>${esc(link)}</link>
    <description>${esc(`Top ${result.rows.length} on ${result.board.label}, ${periodLabel(result.period)}.`)}</description>
    <lastBuildDate>${new Date(result.generatedAt).toUTCString()}</lastBuildDate>
${items.join('\n')}
  </channel>
</rss>
`;
  }

  function embedPage({ board, period, limit, sticky, theme, me, full }) {
    const attrs = [
      `data-board="${esc(board.id)}"`, `data-period="${esc(period)}"`, `data-limit="${esc(String(limit))}"`,
      sticky ? `data-sticky="${esc(sticky)}"` : '', theme ? `data-theme="${esc(theme)}"` : '', me ? `data-me="${esc(me)}"` : '', `data-side="${esc(board.side)}"`,
      `data-base="${esc(basePath)}"`,
    ].filter(Boolean).join(' ');
    const title = `${board.label}: ${siteName}`;
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(`Live ${periodLabel(period)} ranking on ${siteName}.`)}">
<link rel="alternate" type="application/rss+xml" title="${esc(title)}" href="${esc(`${basePath}/${board.id}.xml?period=${period}`)}">
<style>body{margin:0;background:transparent;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}${full ? 'main{max-width:760px;margin:0 auto;padding:24px 16px}' : 'main{padding:8px}'}</style>
</head><body><main><div data-leaderboard></div>
<script src="${esc(basePath)}/embed.js" ${attrs}></script>
</main></body></html>`;
  }

  function sharePage(p) {
    const lines = SIDES.filter((side) => boards.some((b) => b.side === side)).map((side) => {
      const items = boards.filter((b) => b.side === side).map((b) => {
        const r = p.ranks[b.id]?.[defaultPeriod];
        const v = p.values[b.id]?.[defaultPeriod];
        return r ? `<li><strong>#${r}</strong> on ${esc(b.label)} <span class="muted">(${esc(periodLabel(defaultPeriod))}, ${esc(format(v, b.format))})</span></li>` : '';
      }).filter(Boolean).join('');
      return items ? `<h3 class="side">${esc(sides[side])}</h3><ul>${items}</ul>` : '';
    }).filter(Boolean).join('');
    const bestRank = Math.min(...boards.map((b) => p.ranks[b.id]?.[defaultPeriod] ?? Infinity));
    const headline = Number.isFinite(bestRank) ? `#${bestRank} on ${siteName}` : `${p.name} on ${siteName}`;
    const desc = `${p.name}: streak ${p.streak} (best ${p.bestStreak}), ${p.badges.length} badge${p.badges.length === 1 ? '' : 's'}${p.commission ? `, ${p.commission.rate}% commission` : ''}.`;
    const badgeHtml = p.badges.map((b) => `<li title="${esc(b.describe)}"><span class="e">${esc(b.emoji)}</span> ${esc(b.label)}</li>`).join('') || '<li class="muted">No badges yet.</li>';
    const ladderHtml = p.commission ? `<section><h2>Commission</h2><p class="big">${p.commission.rate}%</p><p class="muted">${p.commission.next ? esc(`Add one ${p.commission.next.add} to reach ${p.commission.next.rate}%.`) : esc(`At the cap. ${ladder.describe()}`)}</p></section>` : '';
    const boardUrl = `${siteUrl}${basePath}`;
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(`${p.name}: ${headline}`)}</title>
<meta property="og:type" content="profile"><meta property="og:title" content="${esc(`${p.name}: ${headline}`)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(p.shareUrl)}">
<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(`${p.name}: ${headline}`)}"><meta name="twitter:description" content="${esc(desc)}">
<link rel="alternate" type="application/json" href="${esc(`${basePath}/u/${encodeURIComponent(p.id)}.json`)}">
<style>
:root{color-scheme:light dark}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0b0d12;color:#e8eaf0}
main{max-width:640px;margin:0 auto;padding:40px 20px}h1{font-size:28px;margin:0 0 4px}h2{font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#8b93a7;margin:24px 0 8px}
.big{font-size:40px;font-weight:800;margin:0}.muted{color:#8b93a7}ul{list-style:none;padding:0;margin:0}li{padding:8px 0;border-bottom:1px solid #1f2430}.e{font-size:20px;margin-right:6px}
a{color:#7cc4ff}.stats{display:flex;gap:24px;flex-wrap:wrap}.stats div b{display:block;font-size:22px}
h3.side{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#8b93a7;margin:16px 0 4px;font-weight:600}
</style></head><body><main>
<p class="muted"><a href="${esc(boardUrl)}">${esc(siteName)} leaderboard</a></p>
<h1>${esc(p.name)}</h1><p class="muted">${esc(headline)}</p>
<div class="stats"><div><b>${p.streak}</b><span class="muted">day streak</span></div><div><b>${p.bestStreak}</b><span class="muted">best streak</span></div><div><b>${p.badges.length}</b><span class="muted">badges</span></div></div>
<section><h2>Boards</h2>${lines || '<p class="muted">Not on a board yet.</p>'}</section>
<section><h2>Badges</h2><ul>${badgeHtml}</ul></section>
${ladderHtml}
<p class="muted" style="margin-top:32px"><a href="${esc(p.shareUrl)}">Share this page</a></p>
</main></body></html>`;
  }

  function notFoundPage() {
    return `<!doctype html><meta charset="utf-8"><title>Not found</title><p>No such player.</p>`;
  }

  function absolute(u) {
    return /^https?:/.test(u) ? u : `${siteUrl}${u}`;
  }

  return {
    record, set, top, standing, profile, handle, award,
    boards: boards.map(pub), periods, basePath, ladder, badges,
    index: boardsIndex,
    rss: async (opts) => rss(await top(opts)),
    widget: widgetSource,
    /** Drop the cache, e.g. after writing to the store from elsewhere. */
    invalidate() { cache = null; },
  };
}

/**
 * Which side of the transaction a board ranks. Money flowing to someone is
 * `sell`, money flowing from them is `buy`, and volume with no money attached
 * is `use`. Boards are never mixed across sides: a seller earning $900 and a
 * crawler spending $900 are not comparable, and showing them in one list is a
 * lie about what the number means.
 */
export const SIDES = ['sell', 'buy', 'use'];
const DEFAULT_SIDES = { sell: 'Earning', buy: 'Spending', use: 'Usage' };

function normaliseBoards(input) {
  const src = input && Object.keys(input).length ? input : { top: { label: 'Top', metric: 'score' } };
  const list = Array.isArray(src) ? src : Object.entries(src).map(([id, b]) => ({ id, ...b }));
  return list.map((b) => {
    if (!b.id || !/^[a-z0-9_-]+$/i.test(b.id)) throw new TypeError(`board id must be [a-z0-9_-]: ${b.id}`);
    const side = b.side ?? 'sell';
    if (!SIDES.includes(side)) throw new TypeError(`board side must be one of ${SIDES.join(', ')}: ${side}`);
    return { id: b.id, label: b.label ?? b.id, metric: b.metric ?? 'score', format: b.format ?? 'number', min: Number.isFinite(b.min) ? b.min : Number.MIN_VALUE, order: b.order === 'asc' ? 'asc' : 'desc', tiebreak: b.tiebreak ?? null, unit: b.unit ?? '', side, actor: b.actor ?? null };
  });
}

function pub(b) {
  return { id: b.id, label: b.label, metric: b.metric, format: b.format, unit: b.unit, side: b.side, actor: b.actor };
}

function blank(id) {
  return { id, name: id, nameAt: 0, totals: {}, gauges: {}, days: new Set(), streak: 0, bestStreak: 0, firstAt: Infinity, lastAt: 0, ranks: {}, values: {}, badges: [], commission: undefined };
}

function dayOf(at) {
  return Math.floor(at / DAY);
}

/** Current = consecutive days ending today or yesterday; best = longest run ever. */
export function streaks(days, now = Date.now()) {
  const sorted = [...days].sort((a, b) => a - b);
  let best = 0, run = 0, prev = null;
  for (const d of sorted) {
    run = prev !== null && d === prev + 1 ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }
  const today = dayOf(now);
  const last = sorted[sorted.length - 1];
  const current = last === today || last === today - 1 ? run : 0;
  return { current, best };
}

export function format(value, kind = 'number', locale = 'en-US') {
  const n = Number(value) || 0;
  if (kind === 'usd') return (n / 100).toLocaleString(locale, { style: 'currency', currency: 'USD' });
  if (kind === 'percent') return `${Math.round(n)}%`;
  if (kind === 'integer') return Math.round(n).toLocaleString(locale);
  return Number.isInteger(n) ? n.toLocaleString(locale) : n.toLocaleString(locale, { maximumFractionDigits: 2 });
}

export function periodLabel(p) {
  return { all: 'all time', day: 'today', week: 'this week', month: 'this month' }[p] ?? p;
}

function trimSlash(s) {
  return String(s).replace(/\/+$/, '') || '/';
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=15', 'access-control-allow-origin': '*' } });
}

function html(body, status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' } });
}
