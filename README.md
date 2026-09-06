# @profullstack/leaderboard

A public leaderboard that drops into any site. Score events in, ranked boards out: all time, week, month, streaks, badges, a commission ladder, RSS, a share card per player and a widget any page can embed with one script tag.

Zero dependencies. The core is a Fetch API handler, so it runs in Node, Bun, Deno and at the edge. Adapters for Hono and Next.js. Stores: in-memory, or any SQL client with `execute({ sql, args })` (libsql/Turso, sqlite, Postgres).

It ranks either side of a transaction. Sellers earning, buyers spending, and plain usage are separate boards that never blend, because a publisher earning $900 and a crawler spending $900 are not the same fact.

Built for marketplaces where people sell through properties and niches and earn a growing cut, but every board, badge and metric is yours to define.

## Install

```sh
npm i @profullstack/leaderboard
```

## Sixty seconds

```js
import { createLeaderboard, sqlStore, commissionLadder } from '@profullstack/leaderboard';
import { leaderboard } from '@profullstack/leaderboard/hono';

const store = sqlStore({ execute: (q) => db.execute(q) });   // @libsql/client shape
await store.migrate();

const lb = createLeaderboard({
  siteName: 'NicheDB',
  siteUrl: 'https://nichedb.dev',
  store,
  boards: {
    earnings: { label: 'Top earners', metric: 'cents', format: 'usd', unit: 'Earned' },
    sales:    { label: 'Most sales',  metric: 'sales', tiebreak: 'cents' },
    streaks:  { label: 'Longest streaks', metric: 'streak', min: 1 },
  },
  ladder: commissionLadder(),   // 20% -> 80%
});

app.use('*', leaderboard(lb));

// When something happens:
await lb.record({ player: user.id, name: user.name, metrics: { cents: 1900, sales: 1 } });
await lb.set({ player: user.id, metrics: { properties: 3, niches: 5 } });
```

That gives the site, under `/leaderboard`:

| Path | What |
| --- | --- |
| `/leaderboard` | A full leaderboard page (`?board=&period=&me=&theme=`) |
| `/leaderboard.json` | Boards, periods, badges and the ladder |
| `/leaderboard/earnings.json?period=week&limit=10&me=u_42` | Ranked rows, plus `me` (my standing, on the board or not) |
| `/leaderboard/earnings.xml?period=week` | RSS of the board |
| `/leaderboard/u/u_42` | A share card with Open Graph tags: ranks, streaks, badges, commission |
| `/leaderboard/u/u_42.json` | The same as data |
| `/leaderboard/embed?board=sales&sticky=bottom-right` | An iframe-able page |
| `/leaderboard/embed.js` | The widget script |

JSON answers carry `Access-Control-Allow-Origin: *`, so the widget works on any domain.

## The widget

On any page, yours or a partner's:

```html
<div data-leaderboard></div>
<script src="https://nichedb.dev/leaderboard/embed.js"
        data-board="earnings" data-period="week" data-limit="10" data-me="u_42"></script>
```

Period tabs, badges next to names, the commission rate, streak flames, a highlighted row for `data-me` (and a "you" row below the cut when they are not in the top N), a share link per row that copies the player's card URL, RSS and full-board links, and a refresh every 60 seconds while the tab is visible.

Sticky mode is the retention feature. Add `data-sticky="bottom-right"` (or `bottom-left`, `top-right`, `top-left`) and the board becomes a corner pill reading "You are #4 this week" that opens the panel on click. It follows the reader around the site.

| Attribute | Default | Meaning |
| --- | --- | --- |
| `data-board` | first board | Board id |
| `data-period` | site default | `all`, `day`, `week`, `month` |
| `data-limit` | `10` | Rows |
| `data-me` | | Player id to highlight and report |
| `data-sticky` | | Corner pill mode |
| `data-theme` | `auto` | `light`, `dark`, `auto` |
| `data-title` | board label | Heading |
| `data-refresh` | `60` | Seconds between refreshes, `0` to disable |
| `data-target` | | CSS selector of the container |
| `data-base` | from `src` | The leaderboard path when the script is served elsewhere |

The widget fires `leaderboard:render` on its container with the JSON as `detail`, for anything you want to do with the numbers.

## Sides of the transaction

Every board declares a `side`:

| `side` | Money | Default label | Example |
| --- | --- | --- | --- |
| `sell` | to the actor | Earning | Publishers by revenue, affiliates by commission |
| `buy` | from the actor | Spending | Crawlers by what they paid for passes |
| `use` | none | Usage | Pages crawled, API calls, bytes served |

```js
boards: {
  earners:  { label: 'Top earners',        metric: 'cents', format: 'usd', side: 'sell', actor: 'Publisher' },
  spenders: { label: 'Biggest spenders',   metric: 'spent', format: 'usd', side: 'buy',  actor: 'Crawler' },
  crawled:  { label: 'Most pages crawled', metric: 'pages', format: 'integer', side: 'use', actor: 'Crawler' },
}
```

The widget puts a tab per side across the top and the boards of that side beneath, so only one side is ever on screen. `actor` names the column, so the same table reads "Publisher" on one side and "Crawler" on the other. The commission rate is shown only on `sell` boards, since a rate against a buyer would state something false.

The same identity can hold a rank on both sides at once. Their totals are never pooled.

Rename the tabs with `sides: { buy: 'Bots paying us' }`.

## Metrics

Three kinds, one vocabulary:

- **Counters** go in through `record()` and are summed. Boards on a counter honour the period.
- **Gauges** go in through `set()` and are the current value (properties owned, niches promoted, followers). Boards on a gauge show the same number in every period.
- **Derived**: `streak` (consecutive UTC days with any `record()`, still current through yesterday) and `bestStreak`.

A board is `{ label, metric, format, unit, min, order, tiebreak, side, actor }`. `format` is `number`, `integer`, `usd` (cents in) or `percent`. Players below `min` do not appear. Ties break on `tiebreak`, then on who got there first.

`record()` and `set()` return the badges newly earned, for a toast.

## Badges

A badge is `{ id, emoji, label, describe, when(profile) }`. It is awarded the first time `when` is true and kept forever, so "top ten this week" stays earned after the week ends. The profile carries `totals`, `gauges`, `streak`, `bestStreak`, `ranks[board][period]` and `commission.rate`.

The default set is for a marketplace: first sale, ten sales, hundred sales, seven and thirty day streaks, three properties, five niches, top ten this week, number one, and the 80% club. Pass `badges: [...]` for your own; `onBadge({ player, name, badge })` fires on every award.

## The commission ladder

```js
const ladder = commissionLadder();          // base 20, cap 80, +5 per property (max 6), +5 per niche (max 6)
ladder.rate({ properties: 2, niches: 4 });  // 50
ladder.next({ properties: 2, niches: 4 });  // { add: 'property', rate: 55, from: 50, gain: 5, toCap: 30 }
ladder.table();                             // every step, for a pricing page
```

Every number is an option (`base`, `cap`, `perProperty`, `perNiche`, `maxProperties`, `maxNiches`, `propertiesMetric`, `nichesMetric`). Pass `ladder: true` for the defaults. The rate appears in every row and on the share card, with the next step spelled out: "Add one niche to reach 55%".

## Stores

```js
import { memoryStore, sqlStore, projectionStore } from '@profullstack/leaderboard';

memoryStore();                                           // one process, tests
sqlStore({ execute, prefix: 'lb_', dialect: 'sqlite' })  // or 'postgres'
projectionStore({ events, gauges, badges })              // rank tables you already have
```

### Ranking data you already record

Most sites that want a leaderboard are already recording the facts it would rank. Copying those into a second set of tables is a dual write, and a dual write means the board and the ledger disagree the first time one of them fails. `projectionStore` reads the source instead:

```js
const store = projectionStore({
  events: async ({ since }) => {
    const rows = await sql`select payer, total_cents, created_at from crawl_sales
                           where created_at >= ${new Date(since)}`;
    return rows.map((r) => ({
      player: r.payer, name: r.payer, metric: 'spent',
      delta: r.total_cents, at: +new Date(r.created_at),
    }));
  },
  badges: sqlStore({ execute }),   // badges are awarded, not derived, so they need a home
});
```

`since` is `0` for an all-time board, so the query has to handle "everything". The store is read-only: `record()` and `set()` throw rather than drop a write the next projection would overwrite.

`sqlStore` needs `execute({ sql, args }) -> { rows }`, which is `@libsql/client` as is. `store.schema` is the DDL for your own migration tool; `store.migrate()` runs it. Three tables: events, gauges, badges.

Anything else implements six methods: `append`, `list({ since })`, `setGauge`, `gauges`, `awardBadge`, `badges`. The core reads all events and aggregates in memory, cached for `cacheMs` (15 s); that is fine into the hundreds of thousands of events. Call `lb.invalidate()` after writing to the store from elsewhere.

## Next.js

```js
// app/leaderboard/[[...path]]/route.js
import { leaderboardRoute } from '@profullstack/leaderboard/next';
export const { GET } = leaderboardRoute(lb);
export const dynamic = 'force-dynamic';
```

## Programmatic

```js
await lb.top({ board: 'earnings', period: 'month', limit: 25, offset: 0 });
await lb.standing({ player: 'u_42', board: 'earnings', period: 'week' });
await lb.profile('u_42');
await lb.rss({ board: 'sales' });
lb.index();
```

## License

MIT
