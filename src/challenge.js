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
 *
 * That was not enough. On 2026-10-21 the slice of the swarm that drives a real
 * Chrome ran the script and walked in: 402, then the same address in the same
 * second, then a 200, then never again. It rotates its address on every page,
 * so "once per address per day" is once per page and the script cost it one
 * request. With `work` set the script must also find a nonce whose SHA-256
 * starts with that many zero bits. A person pays about a second once a day; a
 * swarm that changes address every page pays it on every page. The server
 * checks the answer with one hash and keeps nothing.
 *
 * The proof of work did not slow it either (~46 item pages a minute before,
 * ~40 after): its Chrome is real and solves 17 bits easily. But it never
 * loads the page's stylesheet. Of 5,394 addresses that read an item page as
 * a browser, 11 fetched any CSS or JS; a real Chrome fetches the stylesheet
 * on every first visit. With `css` set the page links a stylesheet unique to
 * the address and day, and fetching it is what sets the second cookie. A
 * scraper that blocks stylesheets to save bandwidth never gets it, however
 * much script it runs.
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

/** The second cookie, set only by fetching the challenge stylesheet. */
export const stylesheetToken = (secret, ip, day = Math.floor(Date.now() / DAY)) => hmac(secret, `css|${ip}|${day}`);

/** Whether `got` is today's or yesterday's value of `mint(day)`. */
async function current(got, mint, now) {
  if (!got) return false;
  const day = Math.floor(now / DAY);
  for (const d of [day, day - 1]) if (got === (await mint(d))) return true;
  return false;
}

/** Read one cookie by name. */
export function cookieValue(request, name) {
  const raw = request.headers.get('cookie') ?? '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** Whether a SHA-256 digest starts with `bits` zero bits. */
export function leadingZeros(bytes, bits) {
  let i = 0;
  for (; bits >= 8; bits -= 8) if (bytes[i++]) return false;
  return !bits || !(bytes[i] >> (8 - bits));
}

/** Whether `nonce` answers the proof of work for `seed`. */
export async function solves(seed, nonce, work) {
  if (!work) return true;
  if (!/^\d{1,12}$/.test(nonce ?? '')) return false;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`${seed}.${nonce}`)));
  return leadingZeros(digest, work);
}

/**
 * Whether the request carries today's or yesterday's token for its address,
 * and, with `work`, a nonce that answers it (cookie `<token>.<nonce>`), and,
 * with `css`, the cookie the challenge stylesheet sets (`<cookie>_css`).
 */
export async function passedChallenge(request, { secret, cookie, ip, work = 0, css = false, now = Date.now() }) {
  const got = cookieValue(request, cookie);
  if (!got) return false;
  const [seed, nonce] = got.split('.');
  if (!(await current(seed, (d) => challengeToken(secret, ip, d), now))) return false;
  if (!(await solves(seed, nonce, work))) return false;
  if (!css) return true;
  return current(cookieValue(request, `${cookie}_css`), (d) => stylesheetToken(secret, ip, d), now);
}

/**
 * The challenge stylesheet: `<cssPath><token>`. Sets `<cookie>_css` when the
 * token in the URL is today's or yesterday's for the caller's address, so the
 * URL cannot be fetched on behalf of another address. Always answers CSS, so a
 * browser never logs a broken stylesheet.
 */
export async function stylesheetResponse(request, { secret, cookie, ip, cssPath, now = Date.now() }) {
  const token = new URL(request.url).pathname.slice(cssPath.length);
  const headers = new Headers({ 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-store' });
  if (ip && /^[0-9a-f]{32}$/.test(token) && (await current(token, (d) => challengeToken(secret, ip, d), now))) {
    const value = await stylesheetToken(secret, ip);
    headers.append('set-cookie', `${cookie}_css=${value}; Max-Age=172800; Path=/; SameSite=Lax; Secure; HttpOnly`);
  }
  return new Response('/* ok */\n', { status: 200, headers });
}

/** Wait for the challenge stylesheet; if it cannot load, say so rather than reload forever. */
const WAIT_CSS = `const l=document.getElementById('pfc');if(!(l.sheet||await new Promise(r=>{l.onload=()=>r(1);l.onerror=()=>r(0)}))){document.body.insertAdjacentHTML('beforeend','<p>This check needs the page stylesheet. Reload, or buy a pass.</p>');return}
`;

/** The script that finds the nonce, 256 digests at a time, then sets the cookie and reloads. */
const solver = (token, cookie, work, css) => `(async()=>{const s=${JSON.stringify(token)},w=${work},e=new TextEncoder();${css ? WAIT_CSS : ''}
if(navigator.webdriver){document.body.insertAdjacentHTML('beforeend','<p>Automated browsers need a pass.</p>');return}
const ok=b=>{let n=w,i=0;for(;n>=8;n-=8)if(b[i++])return 0;return!n||!(b[i]>>(8-n))};
for(let n=0;;n+=256){const h=await Promise.all(Array.from({length:256},(_,k)=>crypto.subtle.digest('SHA-256',e.encode(s+'.'+(n+k)))));
for(let k=0;k<256;k++)if(ok(new Uint8Array(h[k]))){document.cookie=${JSON.stringify(`${cookie}=`)}+s+'.'+(n+k)+${JSON.stringify('; Max-Age=172800; Path=/; SameSite=Lax; Secure')};location.reload();return}}})();`;

/** The page that asks. Tiny on purpose: answering it must cost us nothing. */
export function challengePage({ token, cookie, buyUrl, work = 0, cssPath = null }) {
  const css = Boolean(cssPath);
  const script = work || css
    ? solver(token, cookie, work, css)
    : `document.cookie=${JSON.stringify(`${cookie}=${token}; Max-Age=172800; Path=/; SameSite=Lax; Secure`)};location.reload();`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>One moment</title>${css ? `<link id="pfc" rel="stylesheet" href="${cssPath}${token}">` : ''}</head><body>
${work || css ? '<p>Checking your browser. This takes about a second, once a day.</p>\n' : ''}<script>${script}</script>
<noscript><p>This page needs JavaScript. Automated access is sold by the day: <a href="${buyUrl}">${buyUrl}</a></p></noscript>
</body></html>`;
}
