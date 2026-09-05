import { Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * A product listing page, e.g. .../bank-with-us/bank-accounts/our-accounts.
 * Renders one `.product-card` per product: title, pricing tiles (monthly
 * fee / income required), an apply-type call to action, and a
 * "Tell me more" link into the product detail page.
 *
 * This is where silent drop-off shows up. The page still returns 200 when a
 * card loses its price or its "Tell me more" href, so uptime monitoring
 * stays green while the customer hits a dead end — hence the per-card
 * content assertions below.
 */
export class ProductListingPage extends BasePage {
  private cards(): Locator {
    return this.page.locator('.product-card').filter({ has: this.page.locator('.product-card__title') });
  }

  /** SLA assertion: the listing must render products, not an empty shell. */
  async assertLoaded(heading: string, slaMs = 20_000): Promise<void> {
    const start = Date.now();
    await expect(
      this.page.getByRole('heading', { name: new RegExp(heading, 'i') }).first(),
    ).toBeVisible({ timeout: slaMs });
    await this.cards().first().waitFor({ state: 'visible', timeout: slaMs });
    console.info(`[PERF] product listing rendered in ${Date.now() - start}ms (SLA ${slaMs}ms)`);
    await this.checkpointReached('05a-product-listing-loaded');
  }

  /** The catalogue must not silently shrink. */
  async assertMinimumProductsListed(minimum: number): Promise<number> {
    const count = await this.cards().count();
    expect(count, `only ${count} product cards rendered, expected at least ${minimum}`)
      .toBeGreaterThanOrEqual(minimum);
    console.info(`[JOURNEY] ${count} products listed`);
    return count;
  }

  /**
   * The listing hydrates progressively — cards mount before their links are
   * populated, so reading hrefs too early reports a healthy card as broken.
   * Wait until the card count stops changing before inspecting content.
   */
  private async waitForCardsToSettle(timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let previous = -1;
    while (Date.now() < deadline) {
      const current = await this.cards().count();
      if (current > 0 && current === previous) return;
      previous = current;
      await this.page.waitForTimeout(1000);
    }
    console.warn('[JOURNEY] card count never settled — inspecting what rendered');
  }

  /**
   * Every card must carry the three things a customer needs to choose:
   * a name, at least one pricing tile, and a "Tell me more" link that
   * actually goes somewhere (an href of "#" is a dead end, not a link).
   *
   * All cards are inspected and every defect reported together — a run that
   * stopped at the first bad card would hide the rest of the drop-off.
   */
  async assertEveryCardIsShoppable(): Promise<void> {
    await this.waitForCardsToSettle();
    const cards = await this.cards().all();
    const broken: string[] = [];

    for (const card of cards) {
      const title = (await card.locator('.product-card__title').first().innerText()).trim();

      if (!title) {
        broken.push('a card rendered with no product name');
        continue;
      }
      if ((await card.locator('.product-card__price').count()) === 0) {
        broken.push(`"${title}" shows no pricing`);
      }

      const tellMeMore = card.getByRole('link', { name: /tell me more/i }).first();
      if ((await tellMeMore.count()) === 0) {
        broken.push(`"${title}" has no "Tell me more" link at all`);
        continue;
      }
      // Re-read the href for a moment before judging it: a link that is
      // still "#" once the page has settled is a genuine dead end.
      const href = await this.settledHref(tellMeMore);
      if (!href || href === '#') {
        broken.push(`"${title}" has a dead-end "Tell me more" link (href=${href ?? 'missing'})`);
      }
    }

    expect(broken, `product cards with drop-off defects:\n  - ${broken.join('\n  - ')}`)
      .toEqual([]);
    console.info(`[JOURNEY] all ${cards.length} product cards are shoppable`);
  }

  /** Poll an anchor's href briefly so late hydration isn't called a defect. */
  private async settledHref(link: Locator, attempts = 5): Promise<string | null> {
    let href: string | null = null;
    for (let i = 0; i < attempts; i++) {
      href = await link.getAttribute('href').catch(() => null);
      if (href && href !== '#') return href;
      await this.page.waitForTimeout(500);
    }
    return href;
  }

  /** Open a product's detail page via its "Tell me more" call to action. */
  async openProduct(product: string, expectedPath: string): Promise<void> {
    const card = this.cards().filter({ hasText: new RegExp(product, 'i') }).first();
    await expect(card, `no product card matching "${product}"`).toBeVisible({ timeout: 10_000 });
    await card.scrollIntoViewIfNeeded();
    await card.getByRole('link', { name: /tell me more/i }).first().click();
    await this.page.waitForURL(
      new RegExp(expectedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
      { timeout: 20_000 },
    );
    await this.checkpointReached('05b-product-opened');
  }
}
