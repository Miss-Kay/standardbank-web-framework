import { expect } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Product detail page, e.g. .../our-accounts/achieva — the HARD STOP for
 * this suite. We assert the customer can see the product and reach its
 * application entry point, but NEVER open the application, enter personal
 * data, or submit anything against the production site.
 */
export class ProductDetailPage extends BasePage {
  /**
   * Assert-only: prove the product page is displayed and the path onward to
   * an application exists (an "Apply now" / "Call me back" call to action),
   * then STOP. Clicking it opens a lead-capture form asking for a real
   * person's name, ID and phone number — so we verify it is reachable and
   * go no further.
   */
  async assertProductDisplayed(product: string): Promise<void> {
    await expect(
      this.page.getByRole('heading', { name: new RegExp(product, 'i') }).first(),
    ).toBeVisible({ timeout: 20_000 });

    // The breadcrumb proves the customer arrived through the intended
    // journey and can navigate back up it.
    await expect(
      this.page.locator('[class*="breadcrumb"]').getByText(/products and services/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    await this.assertApplicationEntryPointReachable();

    await this.checkpointReached('06-product-detail-displayed');
    console.info('[JOURNEY] Product detail page reached. Stopping here by design.');
  }

  /**
   * The apply CTA is the last link in the discovery funnel. It must exist
   * and be enabled — a product a customer cannot act on is a drop-off even
   * though every page along the way returned 200.
   */
  private async assertApplicationEntryPointReachable(): Promise<void> {
    const cta = this.page
      .getByRole('link', { name: /apply|call me back|open now|get started/i })
      .or(this.page.getByRole('button', { name: /apply|call me back|open now|get started/i }))
      .first();
    await expect(cta, 'no application call to action on the product page').toBeVisible({
      timeout: 15_000,
    });
    await expect(cta).toBeEnabled();
    // Deliberately NOT clicked — see the class comment.
  }
}
