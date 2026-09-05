import { test } from '@playwright/test';
import { HomePage } from '../pages/HomePage';
import { ProductsAndServicesPage } from '../pages/ProductsAndServicesPage';
import { PillarPage } from '../pages/PillarPage';
import { ProductListingPage } from '../pages/ProductListingPage';
import { ProductDetailPage } from '../pages/ProductDetailPage';
import { journeyMatrix } from '../fixtures/testData';
import { site } from '../fixtures/siteProfile';

/** The four product pillars the landing page must always offer. */
const PILLARS = [
  'Bank with us',
  'Grow your money',
  'Borrow for your needs',
  'Insure what matters',
];

/**
 * PRODUCT DISCOVERY JOURNEY — Standard Bank
 * One test per entry in the journey matrix. Each launches the real site,
 * selects the Personal segment, opens Products and Services, drills through
 * a pillar into a product listing, and opens one product's detail page —
 * stopping there by design, before any application or personal data.
 *
 * Standard Bank's public site permits automation, so the whole journey runs
 * live. If it ever serves a bot-protection page, the test SKIPS rather than
 * fails (see BasePage.isBotBlocked) — that is an external block, not a code
 * regression.
 */
test.describe(`${site.name} products and services journey`, () => {
  for (const journey of journeyMatrix) {
    const label = `${journey.segment} → ${journey.pillar} → ${journey.listingHeading}`;
    test(`customer can discover a product from the home page — ${label} @journey @smoke`, async ({
      page,
    }) => {
      const home = new HomePage(page);
      const products = new ProductsAndServicesPage(page);
      const pillar = new PillarPage(page);
      const listing = new ProductListingPage(page);
      const detail = new ProductDetailPage(page);

      await test.step(`Step 1 — launch and select the ${journey.segment} segment`, async () => {
        await home.open(site.entryPath);
        test.skip(
          await home.isBotBlocked(),
          `${site.name} served its bot-protection page to this runner IP — skipping (not a code failure)`,
        );
        await home.selectSegment(journey.segment);
      });

      await test.step('Step 2 — Products and Services landing page renders', async () => {
        await home.openProductsAndServices();
        await products.assertLoaded();
        await products.assertAllPillarsPresent(PILLARS);
      });

      await test.step(`Step 3 — open the "${journey.pillar}" pillar`, async () => {
        await products.openPillar(journey.pillar, journey.pillarPath);
        await pillar.assertLoaded(journey.pillar);
      });

      await test.step(`Step 4 — open the "${journey.category}" product listing`, async () => {
        await pillar.openCategory(journey.category, journey.categoryPath);
        await listing.assertLoaded(journey.listingHeading);
        await listing.assertMinimumProductsListed(journey.minProductCards);
        await listing.assertEveryCardIsShoppable();
      });

      await test.step(`Step 5 — "${journey.product}" product page is displayed`, async () => {
        await listing.openProduct(journey.product, journey.productPath);
        await detail.assertProductDisplayed(journey.product);
      });
    });
  }
});
