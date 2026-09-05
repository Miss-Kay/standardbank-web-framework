import { expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { site } from '../fixtures/siteProfile';

/**
 * Products and Services landing page (/southafrica/personal/products-and-services).
 * Asserts the page renders, then opens one of the four product pillars
 * ("Bank with us", "Grow your money", "Borrow for your needs",
 * "Insure what matters"), each a content card with a "Tell me more" link.
 */
export class ProductsAndServicesPage extends BasePage {
  /** A pillar/category content card, matched by its visible title. */
  private card(title: string) {
    return this.page
      .locator('.content-card-item__container')
      .filter({ hasText: new RegExp(title, 'i') })
      .first();
  }

  /** SLA assertion: the landing page must actually render, not hang blank. */
  async assertLoaded(slaMs = 20_000): Promise<void> {
    const start = Date.now();
    await this.page.waitForURL(site.productsUrlPattern, { timeout: slaMs });
    await expect(
      this.page.getByRole('heading', { name: site.productsHeading }).first(),
    ).toBeVisible({ timeout: slaMs });
    await this.page
      .locator('.content-card-item__container')
      .first()
      .waitFor({ state: 'visible', timeout: slaMs });
    console.info(`[PERF] products landing rendered in ${Date.now() - start}ms (SLA ${slaMs}ms)`);
    await this.checkpointReached('02b-products-and-services-loaded');
  }

  /**
   * All four pillars must be present. A silently missing pillar is exactly
   * the kind of drop-off this suite exists to catch: the page still returns
   * 200, so uptime monitoring stays green while a whole product line has
   * become unreachable from the landing page.
   */
  async assertAllPillarsPresent(pillars: string[]): Promise<void> {
    for (const pillar of pillars) {
      await expect(this.card(pillar), `pillar card "${pillar}" is missing`).toBeVisible({
        timeout: 10_000,
      });
    }
    console.info(`[JOURNEY] all ${pillars.length} product pillars present`);
  }

  /**
   * Open a pillar via its card's "Tell me more" call to action — the route
   * a customer actually takes, rather than a direct goto() that would skip
   * (and therefore never test) the link itself.
   */
  async openPillar(pillar: string, expectedPath: string): Promise<void> {
    const card = this.card(pillar);
    await card.scrollIntoViewIfNeeded();
    await card.getByRole('link').first().click();
    await this.page.waitForURL(new RegExp(escapeRegExp(expectedPath), 'i'), {
      timeout: 20_000,
    });
    await this.checkpointReached('03-pillar-opened');
  }
}

/** Path fragments are literals, not patterns — escape before matching. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
