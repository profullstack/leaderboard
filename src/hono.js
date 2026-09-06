import { createLeaderboard } from './index.js';

/**
 * The leaderboard as Hono middleware: JSON, RSS, the share card, the embed
 * page and the widget script, all under `basePath`.
 *
 *   import { leaderboard } from '@profullstack/leaderboard/hono';
 *   const lb = createLeaderboard({ store, boards });
 *   app.use('*', leaderboard(lb));
 *
 * Takes either options or a leaderboard already created, so an app can keep
 * the instance around for `record()` and `set()`.
 */
export function leaderboard(lbOrOptions) {
  const lb = lbOrOptions && typeof lbOrOptions.handle === 'function' ? lbOrOptions : createLeaderboard(lbOrOptions);
  return async (c, next) => {
    const answer = await lb.handle(c.req.raw);
    if (answer) return answer;
    await next();
  };
}
