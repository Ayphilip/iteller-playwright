import { expect, type Locator, type Page } from '@playwright/test';

/**
 * View > Double Entries (/pages/View/DoubleEntries): "Double Entries Generation" for cheques.
 *
 * Settlement Time (for the Date, today by default) -> tick "Cheques" -> Generate -> "Summary"
 * (Total Amount / Total Cheque / Total Suspended ...) -> Post Double Entry -> "Are you sure you
 * want to post these entries?" -> Yes -> POST /api/DoubleEntry/Post (Generate = POST /api/Generate) ({ Message: "Successful" | error }).
 */
export class ChequeDoubleEntryPage {
  readonly heading: Locator;
  readonly summary: Locator;
  readonly confirm: Locator;

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Double Entries Generation', exact: true });
    this.summary = page.locator('#dblEntriesModal');
    this.confirm = page.locator('#staticBackdrop');
  }

  async expectLoaded() {
    await expect(this.heading).toBeVisible({ timeout: 60_000 });
  }

  /** Ticks the settlement time ("2026-11-07 10:15:00") and the Cheques option. */
  async select(window: string) {
    const item = this.page.locator('main li.list-group-item').filter({ hasText: window }).first();
    await expect(item, `Settlement time ${window} not listed`).toBeVisible({ timeout: 60_000 });
    await item.locator('input[type="checkbox"]').check();
    const cheques = this.page.locator('main li.list-group-item').filter({ hasText: /^\s*Cheques\s*$/ }).locator('input');
    await cheques.check();
  }

  /**
   * Cheque Zone (#ddlChequeZone, from config "InwardZONE", e.g. SMDINW). Required when zones are
   * configured ("You need to select a zone to proceed"). Uses `zone` if listed, else the first zone.
   * Returns the zone chosen ('' when the page has no zones).
   */
  async selectZone(zone?: string) {
    const select = this.page.locator('#ddlChequeZone');
    if (!(await select.count())) return '';
    const options = (await select.locator('option').evaluateAll((els) =>
      els.map((o) => ({ value: (o as HTMLOptionElement).value, label: (o.textContent ?? '').trim() }))))
      .filter((o) => o.value);
    if (!options.length) return '';
    const chosen = options.find((o) => o.value === zone || o.label === zone) ?? options[0];
    await select.selectOption(chosen.value);
    return chosen.label;
  }

  /** Generate -> Summary values for cheques. */
  async generate() {
    const response = this.page.waitForResponse(
      (r) => /\/api\/Generate(\?|$)/i.test(r.url()) && r.request().method() === 'POST', { timeout: 300_000 });
    await this.page.getByRole('button', { name: 'Generate' }).click();
    await response;
    await expect(this.summary).toBeVisible({ timeout: 60_000 });
    const value = async (label: string) => {
      const cells = this.summary.locator('tr').filter({ hasText: label }).first().locator('td');
      if (!(await cells.count())) return { amount: 0, count: 0 };
      return {
        amount: Number((await cells.nth(1).innerText()).replace(/[^\d.-]/g, '')) || 0,
        count: Number((await cells.nth(2).innerText()).replace(/[^\d.-]/g, '')) || 0,
      };
    };
    return { total: await value('Total Amount'), cheques: await value('Total Cheque'), suspended: await value('Total Suspended') };
  }

  /** Post Double Entry -> Yes -> { ok, message }. */
  async post() {
    await this.summary.getByRole('button', { name: 'Post Double Entry' }).click();
    await expect(this.confirm).toBeVisible();
    const response = this.page.waitForResponse((r) => /\/api\/DoubleEntry\/Post/i.test(r.url()), { timeout: 600_000 });
    await this.confirm.getByRole('button', { name: 'Yes' }).click();
    const res = await response;
    const body = await res.json().catch(() => ({}));
    const message = String(body?.Message ?? '').trim();
    return { ok: res.ok() && message === 'Successful', message: `${res.status()} ${message}` };
  }
}
