/**
 * A question only a browser answers: run this script, then ask again.
 *
 * The swarm that walks a site's item pages from a million residential
 * addresses wears a current Chrome string, sends one request per address and
 * never runs the page: on nichedb.dev (2026-10-19) 4.6M browser-looking
 * requests a day came from 1.58M addresses, and the analytics beacon fired for
 * about 2% of them. No user agent rule and no per-address allowance can see
 * that. A person's browser can: it runs a one-line script that sets a cookie
 * and reloads, once a day, and from then on is never asked again.
 *
 * The cookie is an HMAC of the caller's address and the day, so it cannot be
 * minted without asking, and an address that rotates has to ask from each new
 * address. The page that asks is a 402 carrying a link to the sales page, so a
 * scraper that cannot run scripts learns what a pass costs, which is the same
 * answer every other refused crawler gets.
 */

const enc = new TextEncoder();
const DAY = 86_400_000;

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
  let hex = '';
  for (const b of sig.subarray(0, 16)) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/** The token a browser at `ip` gets on day `day` (days since the epoch). */
export const challengeToken = (secret, ip, day = Math.floor(Date.now() / DAY)) => hmac(secret, `js|${ip}|${day}`);

/** Read one cookie by name. */
export function cookieValue(request, name) {
  const raw = request.headers.get('cookie') ?? '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** Whether the request carries today's or yesterday's token for its address. */
export async function passedChallenge(request, { secret, cookie, ip, now = Date.now() }) {
  const got = cookieValue(request, cookie);
  if (!got) return false;
  const day = Math.floor(now / DAY);
  for (const d of [day, day - 1]) if (got === (await challengeToken(secret, ip, d))) return true;
  return false;
}

/** The page that asks. Tiny on purpose: answering it must cost us nothing. */
export function challengePage({ token, cookie, buyUrl }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>One moment</title></head><body>
<script>document.cookie=${JSON.stringify(`${cookie}=${token}; Max-Age=172800; Path=/; SameSite=Lax; Secure`)};location.reload();</script>
<noscript><p>This page needs JavaScript. Automated access is sold by the day: <a href="${buyUrl}">${buyUrl}</a></p></noscript>
</body></html>`;
}
