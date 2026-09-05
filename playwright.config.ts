import { defineConfig } from '@playwright/test';
import { site } from './fixtures/siteProfile';

/**
 * BASE_URL is env-driven so the same framework runs against:
 *  - the site profile's production URL (local, headed, exploratory runs)
 *  - a staging environment                (CI — if production ever blocks bots)
 */
export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['junit', { outputFile: 'test-results/junit.xml' }], // Jira/Xray-importable
  ],
  use: {
    baseURL: process.env.BASE_URL || site.baseUrl, // empty/unset → site profile
    trace: 'retain-on-failure',
    screenshot: 'on',
    video: 'retain-on-failure',
    // A realistic desktop viewport: below ~992px the header collapses into a
    // hamburger menu whose nav markup differs, so the journey would need a
    // separate mobile page object.
    viewport: { width: 1440, height: 900 },
    locale: site.locale,
  },
  projects: [
    {
      name: 'chromium',
    },
  ],
});
