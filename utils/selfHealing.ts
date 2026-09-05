import { Page, Locator } from '@playwright/test';

/**
 * SELF-HEALING LOCATOR
 * --------------------
 * Instead of one brittle selector, each element is defined by an ordered
 * chain of strategies (most stable first). If the primary selector breaks
 * after a UI change, the next candidate is tried automatically, and the
 * "heal" is logged so you know which selectors need updating.
 *
 * Keep it simple: no AI, no external service — just ordered fallbacks.
 */
export interface HealingCandidate {
  name: string;      // human-readable label for logs
  build: (page: Page) => Locator;
}

export class SelfHealingLocator {
  constructor(
    private page: Page,
    private elementName: string,
    private candidates: HealingCandidate[],
  ) {}

  /** Returns the first candidate locator that resolves to a visible element. */
  async resolve(timeoutPerCandidate = 3000): Promise<Locator> {
    const failures: string[] = [];

    for (const [index, candidate] of this.candidates.entries()) {
      const locator = candidate.build(this.page);
      try {
        await locator.first().waitFor({ state: 'visible', timeout: timeoutPerCandidate });
        if (index > 0) {
          // A heal happened — surface it so the team fixes the primary selector.
          console.warn(
            `[SELF-HEAL] "${this.elementName}": primary selector failed, ` +
            `healed using fallback "${candidate.name}" (candidate #${index + 1}). ` +
            `Failed candidates: ${failures.join(', ')}`,
          );
        }
        return locator.first();
      } catch {
        failures.push(candidate.name);
      }
    }

    throw new Error(
      `[SELF-HEAL] "${this.elementName}": ALL ${this.candidates.length} ` +
      `locator strategies failed (${failures.join(', ')}). Element needs re-mapping.`,
    );
  }

  async click(): Promise<void> {
    await (await this.resolve()).click();
  }

  async fill(value: string): Promise<void> {
    await (await this.resolve()).fill(value);
  }

  /**
   * Type character-by-character with real key events — needed for
   * autocomplete widgets that ignore programmatic fill() and only
   * build their suggestion list from keystrokes.
   */
  async type(value: string): Promise<void> {
    const locator = await this.resolve();
    await locator.click();
    await locator.fill(''); // clear any prefilled value
    await locator.pressSequentially(value, { delay: 60 });
  }
}

/** Convenience factory so page objects read cleanly. */
export function healing(
  page: Page,
  elementName: string,
  candidates: HealingCandidate[],
): SelfHealingLocator {
  return new SelfHealingLocator(page, elementName, candidates);
}
