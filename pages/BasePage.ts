import { Page, expect, test } from '@playwright/test';
import { site } from '../fixtures/siteProfile';

/**
 * BasePage: shared plumbing for every page object.
 * Keep this thin — if it grows past ~70 lines, something belongs elsewhere.
 */
export abstract class BasePage {
  constructor(protected page: Page) {}

  async open(path = '/'): Promise<void> {
    await this.page.goto(path, { waitUntil: 'domcontentloaded' });
    await this.dismissCookieBanner();
  }

  /**
   * Cookie/consent banners are the #1 cause of flaky journey tests — the
   * OneTrust overlay intercepts clicks on the nav until it is dismissed.
   * We dismiss it with the least-permissive control available (reject /
   * save defaults) and only fall back to "accept all" if the banner offers
   * nothing else, so the run doesn't opt into more tracking than a
   * privacy-conscious customer would.
   *
   * The early return matters: CI runners are often served no banner at all,
   * and without it every candidate below burned its 3s timeout in turn —
   * 15s of dead waiting on every single page open.
   */
  protected async dismissCookieBanner(): Promise<void> {
    // Wait on the BANNER, not the #onetrust-consent-sdk wrapper.
    //
    // The wrapper renders 1440x0 — full width, zero height — so Playwright
    // correctly reports it as not visible, and a presence check against it
    // concludes "no banner was served" whether or not one is on screen. It
    // also sorts first in DOM order, so including it in a comma selector
    // and taking .first() means the wrapper is the element being checked.
    //
    // That returns the right answer here today only by accident: this site
    // currently serves no banner at all, so "not visible" happens to be
    // correct. The same code on Vodacom — same OneTrust, same wrapper, but
    // a banner actually shown — silently skipped dismissal and left a
    // full-viewport consent overlay intercepting every subsequent click.
    const banner = this.page.locator('#onetrust-banner-sdk');
    const darkFilter = this.page.locator('.onetrust-pc-dark-filter');

    const bannerShown = await banner
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (!bannerShown) return; // no banner served — nothing to dismiss

    const candidates = [
      this.page.locator('#onetrust-reject-all-handler'),         // Reject All
      this.page.locator('.save-preference-btn-handler'),         // Allow Selected
      this.page.locator('#onetrust-accept-btn-handler'),         // Accept (banner)
      this.page.locator('#accept-recommended-btn-handler'),      // Accept (prefs)
      this.page.getByRole('button', { name: /accept|agree|allow all/i }),
    ];
    for (const candidate of candidates) {
      try {
        await candidate.first().click({ timeout: 3000 });
        // Both must go. Some OneTrust configurations render the banner as a
        // modal with a separate full-viewport dark filter, and the filter is
        // the element that intercepts clicks — so the banner hiding is not
        // on its own proof that the page is usable again.
        await banner.waitFor({ state: 'hidden', timeout: 5000 });
        await darkFilter.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {
          /* not every OneTrust build renders one */
        });
        return;
      } catch {
        /* try the next control */
      }
    }
    console.warn('[CONSENT] banner was shown but could not be dismissed');
  }

  /**
   * Drop-off instrumentation: screenshot at each funnel step, attached to
   * the test so it appears in the HTML report (and therefore on the S3
   * report site) instead of dying on the CI runner's disk.
   */
  async checkpointReached(stepName: string): Promise<void> {
    const screenshot = await this.page.screenshot({ fullPage: false });
    await test.info().attach(stepName, {
      body: screenshot,
      contentType: 'image/png',
    });
    console.info(`[JOURNEY] checkpoint reached: ${stepName}`);
  }

  async expectUrlContains(fragment: string): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(fragment, 'i'));
  }

  /**
   * True when the site served its bot-protection interstitial instead of
   * the real page — common when the request comes from a datacenter IP
   * (CI runners). The block page is static and present at load, so a
   * no-wait visibility check is enough and costs nothing on a normal run.
   */
  async isBotBlocked(): Promise<boolean> {
    if (site.botBlockUrlPattern?.test(this.page.url())) return true;
    if (!site.botBlockPattern) return false; // site permits automation
    return this.page
      .getByText(site.botBlockPattern)
      .isVisible()
      .catch(() => false);
  }
}
