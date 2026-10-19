/**
 * Which crawlers pay, and which read free.
 *
 * Two kinds of AI crawler visit a site and only one of them ever sends a reader
 * back. RETRIEVAL crawlers feed the live index that ChatGPT search, Perplexity,
 * Bing and Siri cite from; they are welcome everywhere a reader may go.
 * TRAINING crawlers copy pages into a corpus that is baked into weights months
 * later with no link back. Those are the ones robots.txt refuses and the
 * gateway charges.
 *
 * Each entry is the token its operator documents, and the pairs are the point:
 * GPTBot vs OAI-SearchBot, ClaudeBot vs Claude-SearchBot, meta-externalagent vs
 * Meta-ExternalFetcher, Applebot-Extended vs Applebot. Refusing the wrong half
 * of a pair cuts off citations while the corpus crawl carries on.
 */

/** Training-only crawlers: refused in robots.txt, charged by the gateway. */
export const TRAINING_AGENTS = [
  'GPTBot',
  'ClaudeBot',
  'anthropic-ai',
  'CCBot',
  'meta-externalagent',
  'FacebookBot',
  'Bytespider',
  'Applebot-Extended',
  // Amazon documents Amazonbot's crawl as one that "may be used to train
  // Amazon AI models", and it sends no reader back from any of it.
  'Amazonbot',
];

/**
 * Crawlers that resell what they read and send nobody back: SEO backlink and
 * keyword databases. They do obey robots.txt, so they are refused there as well
 * as charged, which is the cheapest outcome of all: they stop asking.
 */
export const SCRAPER_AGENTS = [
  'AhrefsBot',
  'SemrushBot',
  'MJ12bot',
  'DataForSeoBot',
  'DotBot',
  'BLEXBot',
  'serpstatbot',
  'Barkrowler',
];

/**
 * Headless browsers that say so. Nobody reads a page through one of these; a
 * scrape does, and it runs the page's scripts while it is at it. Lightpanda was
 * 151k requests from 63k addresses on one site in a day (2026-10-19). They do
 * not read robots.txt, so they are charged, never named there.
 */
/**
 * Crawlers that feed an AI answer engine's own index and send next to nobody
 * back: measured on our fleet 2026-10-19, meta-webindexer alone was ~5k
 * requests an hour with no referrals to show for it. Anthony's call the same
 * day: charge them like training crawlers. They read robots.txt, so they are
 * named there too.
 */
export const AI_INDEX_AGENTS = ['meta-webindexer', 'YouBot', 'ExaSearchBot', 'AionBot'];

export const HEADLESS_AGENTS = ['Lightpanda', 'HeadlessChrome', 'PhantomJS'];

/**
 * Retrieval crawlers, named in robots.txt so their operators can see they are
 * welcome. Google-Extended is Google's training token but Google documents it
 * as also gating grounding in the Gemini app, so it stays on this side.
 */
export const RETRIEVAL_AGENTS = [
  'OAI-SearchBot',
  'ChatGPT-User',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Bingbot',
];

const lower = (list) => list.map((t) => t.toLowerCase());

/**
 * Whether a user agent is one of `agents` (default: the training list).
 *
 * Substring match on the documented token, which a determined caller can lie
 * about. That is fine and worth being clear about: this identifies a
 * self-declared corpus crawler so it can be charged. It does not stop anything
 * hostile, and a crawler wearing a browser's user agent walks straight past it.
 */
export function isTrainingAgent(userAgent = '', agents = TRAINING_AGENTS) {
  const ua = String(userAgent ?? '').toLowerCase();
  if (!ua) return false;
  return lower(agents).some((t) => ua.includes(t));
}

/**
 * Search crawlers that are welcome everywhere, with the address ranges their
 * operators publish. A user agent alone is not enough to spare a caller from
 * the free allowance -- "Googlebot" is the first string a scraper copies -- so
 * a crawler is only spared when its address agrees with its name.
 *
 * Ranges are the stable blocks of each operator's published list
 * (developers.google.com/static/search/apis/ipranges/googlebot.json,
 * bing.com/toolbox/bingbot.json, Apple's 17.0.0.0/8); a crawl from outside them
 * is simply metered like everyone else, which fails safe.
 */
export const WELCOME_CRAWLERS = [
  { token: 'Googlebot', cidrs: ['66.249.64.0/19', '192.178.4.0/22', '34.100.182.96/28'] },
  {
    token: 'bingbot',
    cidrs: ['40.77.167.0/24', '157.55.39.0/24', '207.46.13.0/24', '52.167.144.0/24', '40.77.188.0/22', '20.15.133.160/27'],
  },
  { token: 'Applebot', cidrs: ['17.0.0.0/8'] },
];
