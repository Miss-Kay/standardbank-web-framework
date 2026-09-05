/**
 * SITE PROFILE — every site-specific value lives in this one object.
 *
 * Adopting the framework for another bank (or another Standard Bank market)
 * means writing a new profile plus page objects for that site's navigation;
 * nothing else in the framework references Standard Bank directly.
 */
export interface SiteProfile {
  /** Human name — used in logs, reports, and test titles. */
  name: string;
  /** Default base URL; the BASE_URL env var overrides it. */
  baseUrl: string;
  /** Entry path the journey launches from. */
  entryPath: string;
  /** Browser locale for the test context. */
  locale: string;
  /** Path the chosen client segment lands on, used to prove the hand-off. */
  segmentUrlPattern: RegExp;
  /** URL fragment the Products and Services hand-off lands on. */
  productsUrlPattern: RegExp;
  /** Heading that proves we are on the Products and Services landing page. */
  productsHeading: RegExp;
  /**
   * The Wealth segment. It is a separate property because it does not behave
   * like the others: the header tab carries target="_blank" and the page it
   * opens lives on a different host, so both the hand-off and the
   * internal/external split in the link check depend on it.
   */
  wealth: {
    /** Label of the segment tab in the header's top bar. */
    segment: string;
    /** Host the Wealth site is served from. */
    host: string;
    /** URL the tab must land on. */
    urlPattern: RegExp;
    /** Heading that proves the page rendered. */
    heading: RegExp;
  };
  /**
   * Signatures of the site's bot-protection / "access restricted"
   * interstitial — the URL it redirects to, and text unique to the page.
   * When a request is served this page, the test skips rather than
   * false-failing. See BasePage.isBotBlocked(). Optional: sites that
   * permit automation (e.g. standardbank.co.za) can omit these.
   */
  botBlockUrlPattern?: RegExp;
  botBlockPattern?: RegExp;
}

/**
 * Standard Bank South Africa — the active target. The public marketing site
 * (segment nav → Products and Services → product listings) is fully
 * automatable: it serves normal pages to an automated browser, so the whole
 * discovery journey runs live against production. The journey is read-only —
 * it never signs in and never starts a product application.
 */
export const standardBankSA: SiteProfile = {
  name: 'Standard Bank SA',
  baseUrl: 'https://www.standardbank.co.za',
  entryPath: '/',
  locale: 'en-ZA',
  segmentUrlPattern: /\/southafrica\/personal(\/|$|\?)/i,
  productsUrlPattern: /\/southafrica\/personal\/products-and-services/i,
  productsHeading: /products and services/i,
  wealth: {
    segment: 'Wealth',
    host: 'wealthandinvestment.standardbank.com',
    urlPattern: /wealthandinvestment\.standardbank\.com\/wi\/wealth-and-investment/i,
    heading: /wealth and investment/i,
  },
};

/** The profile the suite runs against. */
export const site: SiteProfile = standardBankSA;
