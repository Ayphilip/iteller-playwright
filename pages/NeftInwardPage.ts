import { expect, type Locator, type Page } from '@playwright/test';

export type MatchType = 'perfect' | 'partial' | 'none';

/**
 * Clearing > NEFT Inward ("Neft Inward Treatment", /pages/Clearing/neftInward).
 *
 * Settlement Window -> tick the window (date/time the file was received) -> "Batch Items" lists
 * "Message ID: <id> : <n> items" -> Load Items -> table of items.
 * Each row: checkbox (ticking it marks the item for return and enables its Return Reason select
 * #sel<ID>), Match dot (green = Perfect, amber = Partial, red = No Match), and an Affirm button
 * (Partial/No Match -> Perfect, lined up for double entry) or Veto (undo an Affirm).
 * Commit saves all the changes (toast shows the result) and reloads the items.
 */
export class NeftInwardPage {
  readonly heading: Locator;
  readonly settlementWindowButton: Locator;
  readonly settlementModal: Locator;
  readonly batchModal: Locator;
  readonly loadItemsButton: Locator;
  readonly rows: Locator;
  readonly commitButton: Locator;

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Neft Inward Treatment' });
    this.settlementWindowButton = page.getByRole('button', { name: /Settlement Window/ });
    this.settlementModal = page.locator('#settlementWindowModal');
    this.batchModal = page.locator('#batchItemsModal');
    this.loadItemsButton = this.batchModal.getByRole('button', { name: /Load Items/ });
    this.rows = page.locator('main table tbody tr');
    this.commitButton = page.getByRole('button', { name: 'Commit', exact: true });
  }

  async expectLoaded() {
    await expect(this.heading).toBeVisible({ timeout: 60_000 });
  }

  /** Settlement Window -> pick the window -> check the batch -> Load Items. */
  async loadWindow(window: string, expect_: { msgId: string; itemCount: number }) {
    await this.settlementWindowButton.click();
    await expect(this.settlementModal).toBeVisible();
    const option = this.settlementModal.locator('li').filter({ hasText: window }).locator('input[type="checkbox"]');
    await expect(option, `Settlement window ${window} not listed`).toBeVisible({ timeout: 30_000 });
    await option.click();

    await expect(this.batchModal).toBeVisible({ timeout: 60_000 });
    await expect(this.batchModal).toContainText(`Message ID: ${expect_.msgId}`);
    await expect(this.batchModal.locator('li').filter({ hasText: `Message ID: ${expect_.msgId}` }))
      .toContainText(`${expect_.itemCount} items`);
    await this.loadItemsButton.click();
    await expect(this.batchModal).toBeHidden({ timeout: 60_000 });
  }

  /** The row for an item, found by its unique Item Sequence Number. */
  row(itemSequenceNo: string) {
    return this.rows.filter({ hasText: itemSequenceNo });
  }

  async match(row: Locator): Promise<MatchType | string> {
    const color = await row.locator('div[style*="border-radius: 50%"]').evaluate((d) => getComputedStyle(d).backgroundColor);
    return ({ 'rgb(0, 128, 0)': 'perfect', 'rgb(255, 192, 0)': 'partial', 'rgb(255, 0, 0)': 'none' } as Record<string, MatchType>)[color] ?? color;
  }

  async itemId(row: Locator) {
    return (await row.locator('td').nth(1).innerText()).trim();
  }

  /** Partial / No Match -> Perfect (lined up for double entry). */
  async affirm(row: Locator) {
    await row.getByRole('button', { name: 'Affirm', exact: true }).click();
    await expect(row.getByRole('button', { name: 'Veto', exact: true })).toBeVisible();
    await expect.poll(() => this.match(row)).toBe('perfect');
  }

  /** Tick the item for return and choose a reason (`reason` if listed, else the first one). Returns the reason. */
  async markForReturn(row: Locator, reason?: string) {
    await row.locator('td').first().locator('input[type="checkbox"]').check();
    const select = row.locator('select[name="ReturnReason"]');
    await expect(select).toBeEnabled();
    const options = (await select.locator('option:not([disabled])').allTextContents()).map((o) => o.trim()).filter(Boolean);
    if (!options.length) throw new Error('No NEFT return reasons configured');
    const chosen = reason && options.includes(reason) ? reason : options[0];
    await select.selectOption({ label: chosen });
    return chosen;
  }

  /**
   * Commit -> POST SaveNEFTChanges ({ Status: 1 = success, Message }). Read from the API response:
   * the toast that shows the same message disappears too fast to read reliably.
   */
  async commit() {
    await expect(this.commitButton).toBeEnabled();
    const response = this.page.waitForResponse((r) => /SaveNEFTChanges/i.test(r.url()) && r.request().method() === 'POST',
      { timeout: 180_000 });
    await this.commitButton.click();
    const res = await response;
    const body = await res.json().catch(async () => ({ Message: await res.text().catch(() => '') }));
    return { ok: res.ok() && Number(body?.Status) === 1, message: `${res.status()} ${body?.Message ?? JSON.stringify(body)}` };
  }

  async cell(row: Locator, header: string) {
    const headers = (await this.page.locator('main table thead th').allInnerTexts()).map((h) => h.trim());
    const i = headers.findIndex((h) => h.startsWith(header));
    if (i < 0) throw new Error(`No "${header}" column. Columns: ${headers.join(' | ')}`);
    return (await row.locator('td').nth(i).innerText()).trim();
  }
}
