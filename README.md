# Standard Bank — Web Journey & Link Integrity Framework

Playwright + TypeScript framework that walks the **live standardbank.co.za**
site the way a customer does and asserts it still works. Two suites:

| Suite | What it proves |
| --- | --- |
| `tests/wealth-link-integrity.spec.ts` | Land on standardbank.co.za, click **Wealth**, and verify the page still offers **the same links as the committed baseline** and that **every one of them resolves**. |
| `tests/products-journey.spec.ts` | Land on standardbank.co.za, select **Personal → Products and Services**, drill into a product listing, and reach a product page. |

Built to be simple, maintainable and self-healing, with CI/CD via GitHub
Actions publishing reports to AWS S3. The site-agnostic design (see
`fixtures/siteProfile.ts`) makes another market or bank a new profile.

## Suite 1 — Wealth page link integrity

Broken links on a bank's site are silent: the page still returns 200, so
uptime monitoring stays green while customers hit dead ends. This suite
clicks through to Wealth and resolves every link on the page.

Two things make it less trivial than it sounds, and both are real traps the
framework handles rather than papers over:

1. **Wealth opens in a new tab, on a different host.** The header tab carries
   `target="_blank"` and lands on `wealthandinvestment.standardbank.com`.
   Clicking it and then asserting on the original page silently tests the
   page you were already on. `HomePage.openSegment()` detects the target,
   captures the popup, and returns the page the journey continues on.
2. **The page lazy-loads.** Links below the fold are not in the DOM until it
   has been scrolled, so a naive check silently covers only the top of the
   page. `WealthPage.links()` scrolls the full height first.

### The baseline — catching links that go *missing*

Resolving every link proves nothing is broken. It cannot prove nothing has
gone **missing**: a page that quietly loses half its navigation still passes a
pure link check, because everything left over resolves perfectly. That is the
more common regression on a marketing site — a section is dropped in a CMS
edit and no one notices, because nothing 404s.

So the link set is committed as a snapshot in
`fixtures/wealth-links.baseline.json` (62 links) and diffed on every run:

- **Missing since baseline → the run fails.** The customer can no longer reach
  that page from here. This also catches a link being *re-pointed*: the old URL
  disappears, and the new one shows up as an addition.
- **New since baseline → reported, never failed.** Marketing pages gain content
  constantly, and failing on additions makes the suite noisy — a noisy suite
  gets ignored.

Links are keyed on origin + path + query with the fragment dropped, so a
changed `#section` cannot churn the snapshot. Accept intentional changes
deliberately:

```bash
npm run baseline:update
```

The diff is attached to every run as `link-baseline-diff.md`, so the HTML
report explains what changed without anyone reading the logs.

### How a link is judged

A link check that simply fails on "not 200" is useless here: the page spans
~34 hosts, and plenty of them answer an automated request with 403 while
serving a human perfectly. So the checker only fails on links it can **prove**
are broken.

| Verdict | Meaning | Fails the run? |
| --- | --- | --- |
| `ok` | Resolved with a status under 400 | no |
| `broken` | 404/410 anywhere, or any error on a Standard Bank host | **yes** |
| `unreachable` | DNS/TLS/timeout failure on a Standard Bank host | **yes** |
| `blocked` | A third party refused an automated request (400/403/429) | no — reported as unverified |

Three rules earned by running this against the real page:

- **HEAD and GET disagree.** `facebook.com` returns 200 to a bare request and
  400 to a browser-shaped one, purely as bot handling. Both verbs are tried
  and the best answer wins.
- **Only 404/410 is unambiguous.** Every other 4xx from a third-party host is
  that host declining robots — a fact about the checker, not the link.
- **Refused links get a second pass in a real browser.** If a host rejects the
  API request, the link is re-opened in a real Chromium page and the browser's
  own response decides. A browser 404 is conclusive.

The framework never tries to defeat bot protection — no fingerprint spoofing,
no stealth plugins. Where a host blocks headless Chromium too, the link is
reported as unverified rather than guessed at.

### Latest live result

```
collected 62 unique links (24 internal, 38 external)
re-checking 3 refused link(s) in a real browser
ok=60  broken=0  unreachable=0  blocked=2
  BLOCKED 403 "Mozambique" → https://www.standardbank.co.mz/
  BLOCKED 403 "twitter"    → https://twitter.com/standardbankza
```

Both unverified links were confirmed healthy by hand in a headful browser —
their WAFs block headless Chromium, not customers.

A full `link-integrity-report.md` and `link-integrity-results.json` are
attached to every run, so the HTML report (and the S3 report site) carries
the complete per-link verdict.

## Suite 2 — Products and services journey

1. **Launch** standardbank.co.za and select the **Personal** segment.
2. **Products and Services** renders, and all four pillars are present
   (Bank with us, Grow your money, Borrow for your needs, Insure what matters).
3. **Pillar** — open "Bank with us".
4. **Product listing** — open "Bank accounts", assert the catalogue has not
   silently shrunk, and that every card is *shoppable*: it has a name,
   pricing, and a "Tell me more" link that actually goes somewhere.
5. **Product page** — open ACHIEVA and confirm the application entry point
   is reachable.

A screenshot is attached at every checkpoint, so a failure shows exactly what
the customer would have seen.

> **Hard stop by design:** the suite reaches the product page and stops — it
> never opens an application, enters personal data, or submits anything
> against the production site.

### Known live finding

`savingsJourney` in `fixtures/testData.ts` fails at step 4 on a **real defect**:
on *Grow your money → Savings and investment accounts*, the **PureSave Account**
card's "Tell me more" link has `href="#"` — a dead end for the customer. Every
other card on that page links correctly.

It is deliberately excluded from the default matrix so the pipeline stays
meaningful (red = a *new* regression). Add it back to `journeyMatrix` to
re-check whether the link has been fixed.

## Architecture (deliberately simple)

```
tests/       one spec per journey, readable as a narrative
pages/       page objects — locators + actions, no assertion logic
utils/       selfHealing.ts (ordered locator fallbacks)
             linkChecker.ts (collect, resolve and classify links)
fixtures/    siteProfile.ts (all site-specific values) + typed test data
.github/     CI workflow + Dependabot: run suites, publish report to S3
scripts/     one-time AWS bootstrap
```

Three design rules keep it maintainable:

1. **Selectors live only in page objects** — a UI change touches one file.
2. **Self-healing chains, not magic** — each element has 2–3 ordered
   strategies (structural class → role → text). Fallback use is logged loudly
   so the primary selector gets fixed instead of rotting.
3. **Tests read like the customer journey** — `test.step` per stage.

## Run locally

```bash
npm ci
npx playwright install --with-deps chromium
npm run test:links          # the Wealth link check
npm run baseline:update     # accept intentional link-set changes
npm run test:headed         # watch it drive the site
npm run report              # open the HTML report
```

Run against a different environment:

```bash
BASE_URL=https://staging.example.com npm test
```

## CI/CD

`.github/workflows/playwright.yml` typechecks, runs both suites, and publishes
reports on push, PR, a schedule (every 3rd day, 06:00 SAST), and manual
dispatch. Reports upload as a GitHub artifact **and** sync to S3 — both a
per-run URL and a stable `reports/latest/` link. Set an optional
`SLACK_WEBHOOK_URL` repo secret to get a Slack ping when a run fails.
Dependabot keeps npm packages and GitHub Actions current with weekly PRs.

### One-time AWS setup

Run the bootstrap script with admin AWS credentials — it creates the report
bucket (static website hosting), the GitHub OIDC provider, and a repo-scoped
IAM role, then prints the `gh` commands that wire the repo to AWS:

```bash
./scripts/setup-aws-reports.sh <bucket-name> <aws-region> <github-org/repo>
```

The role name defaults to `<repo-name>-report-publisher` so two projects in
one AWS account never share a role, and the script refuses to repoint a role
that another repository already trusts. This project uses:

```bash
ROLE_NAME=standardbank-report-publisher \
  ./scripts/setup-aws-reports.sh standardbank-suite-reports eu-west-1 Miss-Kay/standardbank-web-framework
```

The S3 publish steps are skipped automatically until the `REPORT_BUCKET`
variable exists, so CI is green before AWS is configured.

#### Immutable OIDC subjects

If the GitHub account has **immutable OIDC subject IDs** enabled, the token's
`sub` claim embeds numeric IDs:

```
repo:Miss-Kay@86423962/standardbank-web-framework@1358460147:ref:refs/heads/main
```

rather than `repo:Miss-Kay/standardbank-web-framework:ref:refs/heads/main`. A
trust policy matching only the classic form then never matches, and the run
fails with an opaque `Not authorized to perform sts:AssumeRoleWithWebIdentity`.
The setting is account-wide and can be switched on *after* a role is created,
so it breaks working pipelines with no change to them.

The bootstrap script looks the numeric IDs up with `gh` and trusts both forms.
To decode what your runner is actually sending:

```bash
curl -sS -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
  "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=sts.amazonaws.com" | jq -r .value \
  | cut -d. -f2 | base64 -d 2>/dev/null | jq .sub
```

### Note on bot protection

standardbank.co.za permits automation, so both suites run live against
production. If it ever serves a bot-protection page, the suite **skips rather
than fails** — an external block is not a code regression, and a red pipeline
is reserved for real defects (see `BasePage.isBotBlocked()` and the optional
`botBlock*` patterns in `fixtures/siteProfile.ts`).

Worth understanding: **a skipped run verifies nothing.** For a blocked target
the options, in order of preference, are to point `BASE_URL` at a staging
environment, get the monitor's egress IP allowlisted in the bot manager (the
standard arrangement for authorized synthetic monitoring), or run locally from
a clean network.

## Roadmap

- Extend the baseline to `<img>`/asset URLs, so a broken hero image fails too
- Crawl one level deeper from the Wealth page (links of linked pages)
- Accessibility budget (axe) on the Wealth and product listing pages
- Lighthouse performance budget on the product listing
- API-level checks (Playwright `request`) for a faster signal
