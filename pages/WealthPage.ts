import { Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import {
  LinkResult,
  PageLink,
  checkLinks,
  collectLinks,
  collectMalformedLinks,
  formatReport,
  groupByVerdict,
  verifyBlockedInBrowser,
} from '../utils/linkChecker';
import { test } from '@playwright/test';

/**
 * Wealth and Investment landing page.
 *
 * NB: this page lives on a DIFFERENT host from the rest of the site
 * (wealthandinvestment.standardbank.com), and the header's Wealth tab opens
 * it in a new tab — see HomePage.openSegment().
 */
export class WealthPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /** Dismiss the consent overlay on this host too — it has its own. */
  async settle(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded');
    await this.dismissCookieBanner();
  }

  async assertLoaded(heading: RegExp, slaMs = 30_000): Promise<void> {
    const start = Date.now();
    await expect(this.page.getByRole('heading', { name: heading }).first()).toBeVisible({
      timeout: slaMs,
    });
    console.info(`[PERF] Wealth page rendered in ${Date.now() - start}ms (SLA ${slaMs}ms)`);
    await this.checkpointReached('02-wealth-page-loaded');
  }

  /** Every anchor on the page, deduped and resolved to absolute URLs. */
  async links(): Promise<PageLink[]> {
    // The page lazy-loads sections as they scroll into view, so links below
    // the fold do not exist in the DOM until we go looking for them.
    await this.scrollThroughPage();
    const links = await collectLinks(this.page);
    console.info(`[LINKS] collected ${links.length} unique links`);
    return links;
  }

  /** Hrefs that cannot be parsed as URLs at all — always a defect. */
  async malformedLinks(): Promise<string[]> {
    return collectMalformedLinks(this.page);
  }

  /**
   * Resolve every collected link over HTTP, re-check in a real browser any
   * that a host refused, then attach the report.
   */
  async checkAllLinks(links: PageLink[]): Promise<LinkResult[]> {
    const apiResults = await checkLinks(this.page.request, links);
    const blockedCount = groupByVerdict(apiResults).blocked.length;
    if (blockedCount > 0) {
      console.info(`[LINKS] re-checking ${blockedCount} refused link(s) in a real browser`);
    }
    const results = await verifyBlockedInBrowser(this.page.context(), apiResults);
    const report = formatReport(this.page.url(), results);

    await test.info().attach('link-integrity-report.md', {
      body: report,
      contentType: 'text/markdown',
    });
    await test.info().attach('link-integrity-results.json', {
      body: JSON.stringify(results, null, 2),
      contentType: 'application/json',
    });

    const grouped = groupByVerdict(results);
    console.info(
      `[LINKS] ok=${grouped.ok.length} broken=${grouped.broken.length} `
        + `unreachable=${grouped.unreachable.length} blocked=${grouped.blocked.length}`,
    );
    // Echo everything that did not simply resolve, so the CI log alone tells
    // the story without anyone having to open the HTML report.
    for (const result of [...grouped.broken, ...grouped.unreachable, ...grouped.blocked]) {
      console.info(
        `[LINKS] ${result.verdict.toUpperCase()} `
          + `${result.status ?? result.detail ?? ''} "${result.text || '(no text)'}" → ${result.url}`,
      );
    }
    return results;
  }

  /**
   * Scroll the full height of the page so lazy-loaded sections mount and
   * their links enter the DOM. Without this the check silently covers only
   * the part of the page that happened to be above the fold.
   */
  private async scrollThroughPage(): Promise<void> {
    await this.page.evaluate(async () => {
      const step = window.innerHeight;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      window.scrollTo(0, 0);
    });
    await this.page.waitForTimeout(1500);
  }
}
