import { Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { healing } from '../utils/selfHealing';
import { site } from '../fixtures/siteProfile';

/**
 * Standard Bank home page — the launch point of the journey.
 * Its header carries two navigation bars:
 *   top bar       → client segment (Personal, Business, Corporate, Wealth)
 *   secondary bar → section nav for the chosen segment (Products and
 *                   Services, About us, Locate Us, Contact us)
 *
 * Interactive elements use self-healing locator chains:
 *   1. stable structural class      (most stable — the design system's BEM)
 *   2. accessible role + name       (survives CSS refactors)
 *   3. visible text / href          (last resort)
 */
export class HomePage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /** The client-segment tab in the header's top bar, e.g. "Personal". */
  private segmentLink(segment: string) {
    const name = new RegExp(`^\\s*${segment}\\s*$`, 'i');
    return healing(this.page, `${segment} segment tab`, [
      {
        name: 'top-bar nav item',
        build: p => p.locator('.header__top-bar-nav-item a').filter({ hasText: name }),
      },
      { name: 'role=link', build: p => p.getByRole('link', { name }) },
      { name: 'href', build: p => p.locator(`header a[href$="/${segment.toLowerCase()}"]`) },
    ]);
  }

  /** The "Products and Services" tab in the header's secondary bar. */
  private productsAndServicesLink = healing(this.page, 'Products and Services nav tab', [
    {
      name: 'secondary-bar nav item',
      build: p =>
        p
          .locator('.header__secondary-bar-nav-item a')
          .filter({ hasText: /^\s*products and services\s*$/i }),
    },
    {
      name: 'href',
      build: p => p.locator('header a[href$="/products-and-services"]'),
    },
    {
      name: 'role=link',
      build: p => p.getByRole('link', { name: /products and services/i }),
    },
  ]);

  /**
   * Open a client segment from the header's top bar and return the page the
   * journey continues on.
   *
   * This is not the one-liner it looks like: the segments do not all behave
   * the same way. Personal and Business route in the same tab, while
   * Corporate and Wealth carry target="_blank" and open a NEW TAB on a
   * different host. Clicking those and then asserting on the original page
   * silently tests the page you were already on — which is exactly the trap
   * this method exists to close.
   */
  async openSegment(segment: string): Promise<Page> {
    const link = await this.segmentLink(segment).resolve();
    const opensNewTab = (await link.getAttribute('target')) === '_blank';

    if (!opensNewTab) {
      await link.click();
      await this.checkpointReached('01-segment-selected');
      return this.page;
    }

    const [popup] = await Promise.all([
      this.page.context().waitForEvent('page', { timeout: 45_000 }),
      link.click(),
    ]);
    await popup.waitForLoadState('domcontentloaded');
    console.info(`[JOURNEY] "${segment}" opened in a new tab: ${popup.url()}`);
    await this.checkpointReached('01-segment-selected-new-tab');
    return popup;
  }

  /**
   * Step 1 — choose a same-tab client segment (Personal, Business). The site
   * opens on Personal by default, but the customer's real action is to pick
   * their segment, so we click it and assert the tab reports itself active.
   * That also catches the regression where the tab renders but no longer
   * routes.
   */
  async selectSegment(segment: string): Promise<void> {
    await this.openSegment(segment);
    await this.page.waitForURL(site.segmentUrlPattern, { timeout: 20_000 });
    await expect(
      this.page.locator('.header__top-bar-nav-item--active').filter({ hasText: segment }),
    ).toBeVisible({ timeout: 10_000 });
  }

  /** Step 2 — open Products and Services from the segment's section nav. */
  async openProductsAndServices(): Promise<void> {
    await this.productsAndServicesLink.click();
    await this.checkpointReached('02a-products-nav-clicked');
  }
}
