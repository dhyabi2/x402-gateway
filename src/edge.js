/**
 * The two checks that do not need a user agent to be honest.
 *
 * A crawler that names itself is charged by the lists in ./agents. The ones
 * that do not -- a VPS fleet wearing "Chrome/148", a residential-proxy
 * rotation cycling three Chrome strings across five hundred addresses -- need
 * something the request cannot help giving away. Two things qualify:
 *
 *   1. Where it came from. A hosting provider's address range serves no
 *      readers, only machines. A CIDR denylist answers those with a tiny 403
 *      before anything else runs.
 *
 *   2. Whether it is the browser it claims to be. Every Chromium since 76,
 *      headless included, sends `Sec-Fetch-Mode` on every request; it is a
 *      forbidden header, so no page script and no extension can remove it.
 *      A request that says "Chrome/145" and does not send it is an HTTP client
 *      with a copied string. That is not a person, and it is charged like any
 *      other crawler.
 */

/* ------------------------------------------------------------------ CIDRs -- */

function ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

/** Parse "a.b.c.d/len" (or a bare address) into a matcher. Null if unreadable. */
export function parseCidr(cidr) {
  const [ip, lenRaw] = String(cidr).trim().split('/');
  const base = ipv4ToInt(ip);
  if (base === null) return null;
  const len = lenRaw === undefined ? 32 : Number(lenRaw);
  if (!Number.isInteger(len) || len < 0 || len > 32) return null;
  const mask = len === 0 ? 0 : (0xffffffff << (32 - len)) >>> 0;
  return { base: (base & mask) >>> 0, mask, text: `${ip}/${len}` };
}

/** Compile a denylist once. Unreadable entries are dropped, not guessed at. */
export function compileCidrs(list = []) {
  return list.map(parseCidr).filter(Boolean);
}

/** Whether an IPv4 address falls inside any compiled range. */
export function inCidrs(ip, compiled) {
  const n = ipv4ToInt(String(ip ?? '').trim());
  if (n === null) return false;
  return compiled.some((c) => ((n & c.mask) >>> 0) === c.base);
}

/**
 * The caller's address, as the edge reported it.
 *
 * `x-forwarded-for` is a list the client can seed, and a denylist read from
 * its first entry is a denylist any client can step around by sending one.
 * The entry our own edge appends is the LAST, on every platform in front of
 * these sites (Railway's proxy, nginx with `$proxy_add_x_forwarded_for`), so
 * last is what is used. `x-real-ip` is nginx's spelling of the same hop and
 * is preferred when present, because nginx sets it from the socket and
 * nothing a client sends survives into it.
 *
 * A CDN in front of the edge would make the last hop the CDN's; put its
 * ranges nowhere near `denyCidrs` and this still fails safe: nothing is
 * refused, nothing is charged, by this check.
 */
export function clientIp(request) {
  const real = request.headers.get('x-real-ip')?.trim();
  if (real) return real;
  const xff = request.headers.get('x-forwarded-for');
  if (!xff) return '';
  const hops = xff.split(',').map((h) => h.trim()).filter(Boolean);
  return hops[hops.length - 1] ?? '';
}

/* -------------------------------------------------------------- spoofing -- */

const CLAIMS_CHROMIUM = /\bChrome\/\d+/;

/**
 * A crawler that says so. Googlebot's evergreen string is
 * "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible;
 * Googlebot/2.1; +http://www.google.com/bot.html) Chrome/W.X.Y.Z Safari/537.36"
 * -- it claims Chrome, it sends no Sec-Fetch-Mode, and it is the last thing
 * on earth to charge. Bingbot is built the same way. Anything that declares
 * itself is judged by the lists, never by this check: the whole point of the
 * check is the client that declares nothing.
 */
const DECLARES_ITSELF = /compatible;|\bbot\b|bot\/|crawler|spider|slurp/i;

/**
 * A request that claims a Chromium user agent but carries none of the
 * fetch-metadata headers Chromium cannot omit.
 *
 * Only Chromium is judged: Firefox and Safari added Sec-Fetch later and
 * older builds of both are still out there, so their absence proves nothing.
 * `sec-fetch-mode` is the one checked because it is present on every request
 * kind -- navigation, subresource, fetch -- unlike `sec-ch-ua`, which a
 * privacy proxy may strip.
 */
export function isSpoofedBrowser(request) {
  const ua = request.headers.get('user-agent') ?? '';
  if (!CLAIMS_CHROMIUM.test(ua)) return false;
  if (DECLARES_ITSELF.test(ua)) return false;
  return !request.headers.has('sec-fetch-mode');
}

/* ---------------------------------------------------------- stale strings -- */

/*
 * Where each browser's version stood on a known day, and how fast it moves:
 * both ship a major every four weeks. Computing "current" from the date keeps
 * the check from going stale itself, which a hard-coded number would within a
 * year.
 */
const DAY = 86_400_000;
const CADENCE = 28 * DAY;
const CHROME_ANCHOR = { major: 120, at: Date.UTC(2023, 11, 5) };
const FIREFOX_ANCHOR = { major: 121, at: Date.UTC(2023, 11, 19) };

/** The major a browser that auto-updates would be on at `now`. */
export function currentMajor(browser, now = Date.now()) {
  const a = browser === 'firefox' ? FIREFOX_ANCHOR : CHROME_ANCHOR;
  return a.major + Math.max(0, Math.floor((now - a.at) / CADENCE));
}

/*
 * The last version an old operating system can run, and Firefox's extended
 * support releases. A person stuck on one of these is still a person, so these
 * are never called stale, however old.
 */
const TERMINAL_CHROME = [
  { major: 109, os: /Windows NT 6\./ }, // Windows 7, 8, 8.1
  { major: 116, os: /Macintosh/ }, // macOS 10.13, 10.14
  { major: 128, os: /Macintosh/ }, // macOS 10.15
  { major: 138, os: /Macintosh/ }, // macOS 11
];
const FIREFOX_ESR = [115, 128, 140, 153];

/**
 * A desktop browser string far older than anything that auto-updates.
 *
 * Chrome, Edge and Firefox update themselves every four weeks, so a desktop
 * "Chrome/120" two years after Chrome 120 shipped is a string copied into a
 * scraper's rotation pool, not a browser. That is exactly what the swarms do:
 * on 2026-10-19 one pool of ten strings (Chrome 118-120, Edge 119-120, Firefox
 * 120-121) walked watchnews.now and r4ck.dev from thousands of residential
 * addresses, running the page scripts as it went.
 *
 * Only desktop strings are judged. Phones and embedded webviews legitimately
 * sit years behind, and a declared crawler is judged by the lists instead.
 *
 * @param {string} ua
 * @param {number} [now]
 * @param {number} [maxMajorsBehind=24]  about 22 months of releases
 */
export function isStaleBrowser(ua, now = Date.now(), maxMajorsBehind = 24) {
  const s = String(ua ?? '');
  if (!/Windows NT|Macintosh|X11; (?:Linux|Ubuntu|Fedora)/.test(s)) return false;
  if (/Mobile|Android|iPhone|iPad|CrOS/.test(s)) return false;
  if (DECLARES_ITSELF.test(s)) return false;

  const ff = /\bFirefox\/(\d+)/.exec(s);
  if (ff) {
    const major = Number(ff[1]);
    if (FIREFOX_ESR.includes(major)) return false;
    return major < currentMajor('firefox', now) - maxMajorsBehind;
  }
  const chrome = /\bChrome\/(\d+)/.exec(s);
  if (chrome) {
    const major = Number(chrome[1]);
    if (TERMINAL_CHROME.some((t) => t.major === major && t.os.test(s))) return false;
    return major < currentMajor('chrome', now) - maxMajorsBehind;
  }
  return false;
}

/* -------------------------------------------------------- welcome crawlers -- */

const COMPILED = new WeakMap();

/**
 * The welcome crawler a request is, judged by name AND address, or null.
 *
 * @param {Request} request
 * @param {{token: string, cidrs: string[]}[]} list  e.g. WELCOME_CRAWLERS
 */
export function welcomeCrawler(request, list) {
  if (!list?.length) return null;
  const ua = (request.headers.get('user-agent') ?? '').toLowerCase();
  if (!ua) return null;
  const ip = clientIp(request);
  for (const c of list) {
    if (!ua.includes(c.token.toLowerCase())) continue;
    let compiled = COMPILED.get(c);
    if (!compiled) COMPILED.set(c, (compiled = compileCidrs(c.cidrs)));
    if (inCidrs(ip, compiled)) return c.token;
  }
  return null;
}
