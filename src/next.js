import { createLeaderboard } from './index.js';

/**
 * A Route Handler for Next.js. Mount it on a catch-all under the base path:
 *
 *   // app/leaderboard/[[...path]]/route.js
 *   import { leaderboardRoute } from '@profullstack/leaderboard/next';
 *   export const { GET } = leaderboardRoute(lb);
 *   export const dynamic = 'force-dynamic';
 *
 * Anything the leaderboard does not answer 404s, which is what a route under
 * its own path should do.
 *
 * This serves everything UNDER the base path, and not `<base>.json`: Next
 * matches on path segments, so that path is a sibling of the base rather than
 * a child and the catch-all never sees it. Use `<base>/index.json`, which is
 * the same index, or give `app/<base>.json/route.js` its own copy of this.
 * Note that calling the exported GET directly in a test answers any path it is
 * handed, including ones Next would never route to it.
 */
export function leaderboardRoute(lbOrOptions) {
  const lb = lbOrOptions && typeof lbOrOptions.handle === 'function' ? lbOrOptions : createLeaderboard(lbOrOptions);
  const GET = async (request) => (await lb.handle(request)) ?? new Response('Not found', { status: 404 });
  return { GET, HEAD: GET };
}
