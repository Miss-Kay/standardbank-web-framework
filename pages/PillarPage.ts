import { expect } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * A product pillar page, e.g. /products-and-services/bank-with-us.
 * Lists the categories inside that pillar as content cards
 * ("Open a bank account", "Get a credit card", …), each with a
 * "Tell me more" link into the product listing.
 */
export class PillarPage extends BasePage {
  async assertLoaded(pillar: string): Promise<void> {
    await expect(this.page.getByRole('heading', { name: pillar, exact: false }).first()).toBeVisible(
      { timeout: 20_000 },
    );
    await this.checkpointReached('04a-pillar-loaded');
  }

  /** Open a category card and land on its product listing. */
  async openCategory(category: string, expectedPath: string): Promise<void> {
    const card = this.page
      .locator('.content-card-item__container')
      .filter({ hasText: new RegExp(category, 'i') })
      .first();
    await card.scrollIntoViewIfNeeded();
    await card.getByRole('link').first().click();
    await this.page.waitForURL(
      new RegExp(expectedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
      { timeout: 20_000 },
    );
    await this.checkpointReached('04b-category-opened');
  }
}
