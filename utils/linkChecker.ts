import { APIRequestContext, BrowserContext, Page } from '@playwright/test';

/**
 * LINK INTEGRITY CHECKER
 * ----------------------
 * Collects every anchor on a page and resolves each one over HTTP, so a
 * link that has quietly rotted is caught before a customer clicks it.
 *
 * The classification below is the important part. A link check that simply
 * fails on "not 200" is useless against a real bank site: it spans dozens of
 * third-party hosts whose bot managers answer an automated request with 403
 * while serving a human perfectly. We therefore only fail on links we can
 * PROVE are broken, and report the rest as unverified.
 */

export type LinkVerdict = 'ok' | 'broken' | 'blocked' | 'unreachable' | 'skipped';

export interface PageLink {
  /** The raw href attribute as authored. */
  href: string;
  /** Resolved absolute URL. */
  url: string;
  /** Visible link text (first occurrence), for the report. */
  text: string;
  /** Number of times this URL appears on the page. */
  occurrences: number;
  /** True when the URL is on the same host as the page under test. */
  internal: boolean;
}

export interface LinkResult extends PageLink {
  verdict: LinkVerdict;
  status?: number;
  /** Final URL after redirects, when it differs from the requested one. */
  redirectedTo?: string;
  detail?: string;
}

/** Schemes that are not fetchable and are reported as skipped, not broken. */
const NON_HTTP_SCHEME = /^(mailto|tel|javascript|sms|whatsapp|data|blob):/i;

/**
 * Collect every anchor on the page, resolved to absolute URLs and deduped.
 * In-page anchors ("#main") and non-HTTP schemes are dropped here — they
 * are not link rot, and fetching them is meaningless.
 */
export async function collectLinks(page: Page): Promise<PageLink[]> {
  const raw = await page.$$eval('a[href]', anchors =>
    anchors.map(a => ({
      href: a.getAttribute('href') ?? '',
      url: (a as HTMLAnchorElement).href,
      text: (a.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
    })),
  );

  const pageHost = new URL(page.url()).host;
  const byUrl = new Map<string, PageLink>();

  for (const link of raw) {
    const href = link.href.trim();
    if (!href || href.startsWith('#') || NON_HTTP_SCHEME.test(href)) continue;

    let parsed: URL;
    try {
      parsed = new URL(link.url);
    } catch {
      continue; // unparseable href — reported by assertNoMalformedHrefs below
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;

    // Ignore the fragment when deduping: /page and /page#section are one URL.
    const key = `${parsed.origin}${parsed.pathname}${parsed.search}`;
    const existing = byUrl.get(key);
    if (existing) {
      existing.occurrences += 1;
      if (!existing.text && link.text) existing.text = link.text;
      continue;
    }
    byUrl.set(key, {
      href,
      url: parsed.toString(),
      text: link.text,
      occurrences: 1,
      internal: parsed.host === pageHost,
    });
  }

  return [...byUrl.values()];
}

/** Anchors whose href cannot be resolved to a URL at all — always a defect. */
export async function collectMalformedLinks(page: Page): Promise<string[]> {
  return page.$$eval('a[href]', anchors =>
    anchors
      .filter(a => {
        const href = (a.getAttribute('href') ?? '').trim();
        if (!href || href.startsWith('#')) return false;
        if (/^(mailto|tel|javascript|sms|whatsapp|data|blob):/i.test(href)) return false;
        try {
          new URL((a as HTMLAnchorElement).href);
          return false;
        } catch {
          return true;
        }
      })
      .map(a => `${(a.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 50)} → ${a.getAttribute('href')}`),
  );
}

export interface CheckOptions {
  /** Parallel requests. Kept modest so the check isn't mistaken for an attack. */
  concurrency?: number;
  /** Per-request timeout in ms. */
  timeout?: number;
}

/** Resolve every link over HTTP, a few at a time. See checkOne() for the rules. */
export async function checkLinks(
  request: APIRequestContext,
  links: PageLink[],
  options: CheckOptions = {},
): Promise<LinkResult[]> {
  const concurrency = options.concurrency ?? 6;
  const timeout = options.timeout ?? 25_000;
  const results: LinkResult[] = new Array(links.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < links.length) {
      const index = cursor++;
      results[index] = await checkOne(request, links[index], timeout);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, links.length) }, worker));
  return results;
}

/**
 * Resolve one link.
 *
 * Two rules earned by running this against the real page:
 *
 * 1. HEAD and GET disagree. Several hosts answer one and refuse the other —
 *    facebook.com returns 200 to a bare request and 400 to a browser-shaped
 *    one, purely as bot handling. So we try both and take the BEST answer:
 *    if either resolves, the link is not broken.
 *
 * 2. Only 404/410 is unambiguous. "Not found" and "gone" mean the link is
 *    dead no matter who asks. Every other 4xx from a third-party host
 *    (400/401/403/405/429/451) is that host deciding it does not serve
 *    robots — a fact about the checker, not about the link — so it is
 *    reported as unverified rather than failed. Anything on the bank's own
 *    hosts is held to the strict standard: they control it, so any error
 *    there is a real defect.
 */
async function checkOne(
  request: APIRequestContext,
  link: PageLink,
  timeout: number,
): Promise<LinkResult> {
  const attempt = async (method: 'HEAD' | 'GET') => {
    const response = await request.fetch(link.url, {
      method,
      timeout,
      maxRedirects: 10,
      failOnStatusCode: false,
      headers: { accept: 'text/html,application/xhtml+xml,*/*' },
    });
    return {
      status: response.status(),
      finalUrl: response.url(),
    };
  };

  let best: { status: number; finalUrl: string } | undefined;
  let networkError: string | undefined;

  for (const method of ['HEAD', 'GET'] as const) {
    try {
      const outcome = await attempt(method);
      if (!best || outcome.status < best.status) best = outcome;
      if (outcome.status < 400) break; // resolved — no need to try the other verb
    } catch (error) {
      networkError = error instanceof Error ? error.message.split('\n')[0] : String(error);
    }
  }

  if (!best) {
    return { ...link, verdict: 'unreachable', detail: networkError ?? 'no response' };
  }

  const { status, finalUrl } = best;
  const redirectedTo = finalUrl !== link.url ? finalUrl : undefined;

  if (status < 400) return { ...link, verdict: 'ok', status, redirectedTo };

  // Definitively dead, whoever is asking.
  if (status === 404 || status === 410) {
    return { ...link, verdict: 'broken', status, redirectedTo };
  }

  // The bank's own hosts are held to the strict standard.
  if (link.internal) return { ...link, verdict: 'broken', status, redirectedTo };

  return {
    ...link,
    verdict: 'blocked',
    status,
    redirectedTo,
    detail: 'third-party host refused an automated request — not verified',
  };
}

/**
 * SECOND PASS — re-check "blocked" links in a real browser.
 *
 * A host that refuses Playwright's request context often serves a browser
 * perfectly: standardbank.co.mz answers 403 to every programmatic request
 * while rendering normally in Chromium. Leaving those unverified would mean
 * the suite quietly checks nothing for them, so we open each in a real page
 * and use what the browser actually got.
 *
 * A browser 404/410 here is conclusive — the link really is dead.
 */
export async function verifyBlockedInBrowser(
  context: BrowserContext,
  results: LinkResult[],
  options: { timeout?: number; max?: number } = {},
): Promise<LinkResult[]> {
  const timeout = options.timeout ?? 30_000;
  const max = options.max ?? 15;
  const blocked = results.filter(result => result.verdict === 'blocked').slice(0, max);
  if (blocked.length === 0) return results;

  const verified = new Map<string, LinkResult>();

  for (const link of blocked) {
    const page = await context.newPage();
    try {
      const response = await page.goto(link.url, {
        waitUntil: 'domcontentloaded',
        timeout,
      });
      const status = response?.status();

      if (status !== undefined && status < 400) {
        verified.set(link.url, {
          ...link,
          verdict: 'ok',
          status,
          detail: `refused an API request (${link.status}) but renders in a browser`,
        });
      } else if (status === 404 || status === 410) {
        verified.set(link.url, {
          ...link,
          verdict: 'broken',
          status,
          detail: 'confirmed dead in a real browser',
        });
      } else if (status !== undefined) {
        verified.set(link.url, { ...link, status, detail: `browser also got ${status}` });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message.split('\n')[0] : String(error);
      verified.set(link.url, { ...link, detail: `browser check failed: ${detail}` });
    } finally {
      await page.close();
    }
  }

  return results.map(result => verified.get(result.url) ?? result);
}

/** Group results by verdict, for assertions and reporting. */
export function groupByVerdict(results: LinkResult[]): Record<LinkVerdict, LinkResult[]> {
  const grouped: Record<LinkVerdict, LinkResult[]> = {
    ok: [],
    broken: [],
    blocked: [],
    unreachable: [],
    skipped: [],
  };
  for (const result of results) grouped[result.verdict].push(result);
  return grouped;
}

/** A readable report, attached to the test so it lands in the HTML report. */
export function formatReport(pageUrl: string, results: LinkResult[]): string {
  const grouped = groupByVerdict(results);
  const browserVerified = grouped.ok.filter(r => r.detail?.includes('renders in a browser')).length;
  const lines: string[] = [
    `# Link integrity — ${pageUrl}`,
    '',
    `Checked ${results.length} unique links `
      + `(${results.filter(r => r.internal).length} internal, `
      + `${results.filter(r => !r.internal).length} external)`,
    '',
    `- OK: ${grouped.ok.length}` + (browserVerified ? ` (${browserVerified} verified in a browser after an API refusal)` : ''),
    `- BROKEN: ${grouped.broken.length}`,
    `- UNREACHABLE: ${grouped.unreachable.length}`,
    `- BLOCKED (bot protection, not verified): ${grouped.blocked.length}`,
    '',
  ];

  const section = (title: string, items: LinkResult[]) => {
    if (items.length === 0) return;
    lines.push(`## ${title}`, '');
    for (const item of items) {
      const status = item.status ? `HTTP ${item.status}` : (item.detail ?? 'no response');
      lines.push(
        `- [${status}] "${item.text || '(no text)'}" → ${item.url}`
          + `${item.occurrences > 1 ? ` (×${item.occurrences} on the page)` : ''}`
          + `${item.detail && item.status ? ` — ${item.detail}` : ''}`,
      );
    }
    lines.push('');
  };

  section('Broken', grouped.broken);
  section('Unreachable', grouped.unreachable);
  section('Blocked — could not verify', grouped.blocked);
  section('OK', grouped.ok);

  return lines.join('\n');
}
