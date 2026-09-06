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
 */
export function leaderboardRoute(lbOrOptions) {
  const lb = lbOrOptions && typeof lbOrOptions.handle === 'function' ? lbOrOptions : createLeaderboard(lbOrOptions);
  const GET = async (request) => (await lb.handle(request)) ?? new Response('Not found', { status: 404 });
  return { GET, HEAD: GET };
}
