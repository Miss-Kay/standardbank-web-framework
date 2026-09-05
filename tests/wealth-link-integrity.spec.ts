import { expect, test } from '@playwright/test';
import { HomePage } from '../pages/HomePage';
import { WealthPage } from '../pages/WealthPage';
import { groupByVerdict, PageLink } from '../utils/linkChecker';
import { site } from '../fixtures/siteProfile';
import path from 'path';

/** Committed snapshot of the Wealth page's link set. */
const BASELINE_PATH = path.join(__dirname, '..', 'fixtures', 'wealth-links.baseline.json');

/**
 * WEALTH PAGE LINK INTEGRITY — Standard Bank
 *
 * Launches standardbank.co.za, clicks the Wealth tab in the header, and
 * checks that every link on the page it opens actually resolves.
 *
 * Two things make this less trivial than it sounds, and both are handled in
 * the page objects rather than here:
 *   1. Wealth opens in a NEW TAB on a different host — see
 *      HomePage.openSegment().
 *   2. The page lazy-loads sections, so links below the fold are not in the
 *      DOM until it has been scrolled — see WealthPage.links().
 *
 * The run FAILS only on links proven broken. Third-party hosts that refuse
 * an automated request (403/429) are reported as unverified, not failed —
 * see utils/linkChecker.ts for why.
 */
test.describe(`${site.name} — Wealth page link integrity`, () => {
  test(`every link on the Wealth page resolves @links @smoke`, async ({ page }) => {
    const home = new HomePage(page);
    let wealth!: WealthPage;

    await test.step('Step 1 — launch the site and click Wealth', async () => {
      await home.open(site.entryPath);
      test.skip(
        await home.isBotBlocked(),
        `${site.name} served its bot-protection page to this runner IP — skipping (not a code failure)`,
      );

      const wealthTab = await home.openSegment(site.wealth.segment);
      wealth = new WealthPage(wealthTab);
      await wealth.settle();
      await expect(wealthTab).toHaveURL(site.wealth.urlPattern, { timeout: 30_000 });
    });

    await test.step('Step 2 — the Wealth page renders', async () => {
      await wealth.assertLoaded(site.wealth.heading);
    });

    await test.step('Step 3 — no anchor has a malformed href', async () => {
      const malformed = await wealth.malformedLinks();
      expect(malformed, `anchors with unparseable hrefs:\n  - ${malformed.join('\n  - ')}`)
        .toEqual([]);
    });

    let links: PageLink[] = [];

    await test.step('Step 4 — the page still offers the same links as the baseline', async () => {
      links = await wealth.links();
      expect(links.length, 'no links were collected — the page did not render').toBeGreaterThan(10);

      // Resolving every link proves nothing is broken; it cannot prove nothing
      // has gone MISSING. A page that loses half its navigation still passes a
      // pure link check, because everything left over resolves perfectly.
      const diff = await wealth.compareToBaseline(BASELINE_PATH, links);
      expect(
        diff.missing,
        `Links present at baseline but gone from the page — these journeys are `
          + `no longer reachable from here:\n`
          + diff.missing.map(link => `  - "${link.text}" → ${link.key}`).join('\n'),
      ).toEqual([]);
    });

    await test.step('Step 5 — every link on the page resolves', async () => {
      const results = await wealth.checkAllLinks(links);
      const grouped = groupByVerdict(results);

      // Unreachable internal links are broken links: the bank controls that
      // host, so a DNS/TLS/timeout failure there is a real defect.
      const internalUnreachable = grouped.unreachable.filter(result => result.internal);
      const failures = [...grouped.broken, ...internalUnreachable];

      const describe = (label: string, items: typeof failures) =>
        items.map(item => `  - [${item.status ?? item.detail}] "${item.text}" → ${item.url}`).join('\n')
        || `  (no ${label})`;

      expect(
        failures,
        `Broken links on ${site.wealth.host}:\n${describe('broken links', failures)}\n\n`
          + `${grouped.blocked.length} further link(s) could not be verified `
          + `(third-party bot protection) — see the attached report.`,
      ).toEqual([]);

      await wealth.checkpointReached('03-links-verified');
    });
  });
});
