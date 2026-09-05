/** Typed test data — single source of truth, easy to extend to data-driven runs. */

export interface ProductJourney {
  /** Client segment selected in the top bar (Personal, Business, …). */
  segment: string;
  /** Pillar card on the Products and Services landing page. */
  pillar: string;
  /** Path fragment the pillar link must resolve to. */
  pillarPath: string;
  /** Title of the category card on the pillar page. */
  category: string;
  /** Path fragment the category link must resolve to. */
  categoryPath: string;
  /** Heading that proves the product listing rendered. */
  listingHeading: string;
  /** Product on the listing page whose detail page we open. */
  product: string;
  /** Path fragment the product detail page must resolve to. */
  productPath: string;
  /** Minimum number of product cards the listing must show to be healthy. */
  minProductCards: number;
}

/**
 * The reference journey: a personal-banking customer discovering a
 * transactional account — Personal → Products and Services → Bank with us →
 * Bank accounts → ACHIEVA.
 */
export const bankAccountsJourney: ProductJourney = {
  segment: 'Personal',
  pillar: 'Bank with us',
  pillarPath: '/products-and-services/bank-with-us',
  category: 'Open a bank account',
  categoryPath: '/bank-with-us/bank-accounts/our-accounts',
  listingHeading: 'Bank accounts',
  product: 'ACHIEVA',
  productPath: '/our-accounts/achieva',
  minProductCards: 3,
};

/**
 * A second pillar through the same funnel, proving the page objects are
 * driven by data and not hard-wired to one product line.
 *
 * NB: this journey currently FAILS at step 4 on a real production defect —
 * the "PureSave Account" card's "Tell me more" link has href="#", so the
 * customer cannot reach the product. That is the suite doing its job; see
 * the "Known live finding" section of the README.
 */
export const savingsJourney: ProductJourney = {
  segment: 'Personal',
  pillar: 'Grow your money',
  pillarPath: '/products-and-services/grow-your-money',
  category: 'Savings and investment accounts',
  categoryPath: '/grow-your-money/savings-and-investment/our-accounts',
  listingHeading: 'Savings and investment accounts',
  product: 'SaveUp account',
  productPath: '/our-accounts/saveup-savings-account',
  minProductCards: 6,
};

/**
 * Data-driven matrix — the spec generates one test per entry.
 *
 * savingsJourney is deliberately NOT in the default run: it fails on a real
 * production defect that is already known and reported (see above), and a
 * permanently red pipeline would hide the next regression. Add it here to
 * re-check whether the PureSave link has been fixed.
 */
export const journeyMatrix: ProductJourney[] = [bankAccountsJourney];
