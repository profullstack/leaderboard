export type Period = 'all' | 'day' | 'week' | 'month';
export type Format = 'number' | 'integer' | 'usd' | 'percent';
/** Which side of the transaction a board ranks. Boards are never mixed across sides. */
export type Side = 'sell' | 'buy' | 'use';
export const SIDES: Side[];

export interface Event { player: string; name?: string; metric: string; delta: number; at: number }

export interface Store {
  append(event: Event): Promise<void>;
  list(opts?: { since?: number }): Promise<Event[]>;
  setGauge(player: string, metric: string, value: number, name: string | undefined, at: number): Promise<void>;
  gauges(): Promise<Record<string, { name?: string; at: number; values: Record<string, number> }>>;
  awardBadge(player: string, badge: string, at: number): Promise<boolean>;
  badges(): Promise<Record<string, Record<string, number>>>;
}

export interface MemoryStore extends Store { _dump(): unknown }
export function memoryStore(): MemoryStore;

export interface SqlStoreOptions {
  execute: (q: { sql: string; args: unknown[] }) => Promise<{ rows: Record<string, unknown>[] }> | { rows: Record<string, unknown>[] };
  prefix?: string;
  dialect?: 'sqlite' | 'postgres';
}
export interface SqlStore extends Store { schema: string[]; tables: { events: string; gauges: string; badges: string }; migrate(): Promise<void> }
export function sqlStore(options: SqlStoreOptions): SqlStore;

export interface LadderOptions {
  base?: number; cap?: number; perProperty?: number; perNiche?: number; maxProperties?: number; maxNiches?: number;
  propertiesMetric?: string; nichesMetric?: string;
}
export interface LadderState { properties?: number; niches?: number; [metric: string]: number | undefined }
export interface LadderStep { add: 'property' | 'niche'; rate: number; from: number; gain: number; toCap: number }
export interface Ladder extends Required<LadderOptions> {
  rate(state?: LadderState): number;
  next(state?: LadderState): LadderStep | null;
  table(): Array<{ properties: number; niches: number; rate: number }>;
  describe(): string;
}
export function commissionLadder(options?: LadderOptions): Ladder;

export interface Badge { id: string; emoji?: string; label?: string; describe?: string; when(profile: Profile): boolean }
export interface EarnedBadge { id: string; emoji: string; label: string; describe: string; at: number }
export function defaultBadges(names?: { sales?: string; properties?: string; niches?: string }): Badge[];

export interface BoardOptions {
  label?: string; metric?: string; format?: Format; unit?: string; min?: number;
  order?: 'asc' | 'desc'; tiebreak?: string;
  /** Money to this actor is `sell`, money from them is `buy`, volume with no money is `use`. Default `sell`. */
  side?: Side;
  /** What one row is, e.g. "Publisher" or "Crawler". Names the column and appears beside the title. */
  actor?: string;
}
export interface Board { id: string; label: string; metric: string; format: Format; unit: string; side: Side; actor: string | null }
export interface SideGroup { side: Side; label: string; boards: Board[] }

export interface Profile {
  id: string; name: string;
  totals: Record<string, number>;
  gauges: Record<string, number>;
  streak: number; bestStreak: number;
  firstAt: number; lastAt: number;
  ranks: Record<string, Partial<Record<Period, number>>>;
  values: Record<string, Partial<Record<Period, number>>>;
  badges: EarnedBadge[];
  commission?: { rate: number; next: LadderStep | null };
  url: string; shareUrl: string;
}

export interface Row {
  rank: number | null; id: string; name: string; value: number; display: string;
  streak: number; bestStreak: number; badges: Array<{ id: string; emoji: string; label: string }>;
  /** Set only on `sell` boards: a commission rate is a property of earning. */
  commission?: number; url: string;
}
export interface Standing extends Row { qualified: boolean; min: number }
export interface Top { board: Board; sides: SideGroup[]; period: Period; periods: Period[]; generatedAt: string; total: number; rows: Row[]; me?: Standing | null }

export interface LeaderboardOptions {
  store?: Store;
  basePath?: string;
  siteName?: string;
  siteUrl?: string;
  boards?: Record<string, BoardOptions> | Array<BoardOptions & { id: string }>;
  periods?: Period[];
  defaultPeriod?: Period;
  /** Display names per side. Defaults: sell "Earning", buy "Spending", use "Usage". */
  sides?: Partial<Record<Side, string>>;
  ladder?: Ladder | boolean;
  badges?: Badge[];
  cacheMs?: number;
  limitMax?: number;
  profileUrl?: (id: string) => string;
  now?: () => number;
  onBadge?: (x: { player: string; name: string; badge: EarnedBadge }) => void | Promise<void>;
}

export interface Leaderboard {
  record(x: { player: string; name?: string; metrics: Record<string, number>; at?: number }): Promise<EarnedBadge[]>;
  set(x: { player: string; name?: string; metrics: Record<string, number>; at?: number }): Promise<EarnedBadge[]>;
  award(player: string): Promise<EarnedBadge[]>;
  top(opts?: { board?: string; period?: Period; limit?: number; offset?: number }): Promise<Top>;
  standing(opts: { player: string; board?: string; period?: Period }): Promise<Standing | null>;
  profile(player: string): Promise<Profile | null>;
  handle(request: Request): Promise<Response | null>;
  rss(opts?: { board?: string; period?: Period; limit?: number }): Promise<string>;
  index(): unknown;
  widget(): string;
  invalidate(): void;
  boards: Board[]; periods: Period[]; basePath: string; ladder: Ladder | null; badges: Badge[];
}
export function createLeaderboard(options?: LeaderboardOptions): Leaderboard;

export function streaks(days: Iterable<number>, now?: number): { current: number; best: number };
export function format(value: number, kind?: Format, locale?: string): string;
export function periodLabel(period: Period): string;

/** Hono middleware. */
export function leaderboard(lbOrOptions: Leaderboard | LeaderboardOptions): (c: any, next: () => Promise<void>) => Promise<Response | void>;
/** Next.js Route Handler for `app/<basePath>/[[...path]]/route.js`. */
export function leaderboardRoute(lbOrOptions: Leaderboard | LeaderboardOptions): { GET: (request: Request) => Promise<Response>; HEAD: (request: Request) => Promise<Response> };
export function widgetSource(): string;
