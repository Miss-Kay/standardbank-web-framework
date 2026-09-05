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
    const banner = this.page.locator('#onetrust-banner-sdk, #onetrust-consent-sdk');
    const bannerShown = await banner
      .first()
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
        await banner.first().waitFor({ state: 'hidden', timeout: 5000 });
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
