import { expect, type Locator, type Page } from '@playwright/test';

export type Direction = 'Neft CR' | 'Neft DB' | 'Both Neft CR and Neft DB';

/**
 * Clearing > Double Entry Generation NEFT ("Double Entries Generation for Inward NEFT").
 *
 * Date (defaults to today) -> Settlement Windows list for that date -> tick the window ->
 * Direction (Neft CR / Neft DB / Both) -> Post -> "Transaction Details" dialog
 * (Total Record Found, Total Amount) -> Proceed -> toast with the posting result.
 * If nothing is ready to post, Post shows a warning toast instead of the dialog.
 */
export class DoubleEntryNeftPage {
  readonly heading: Locator;
  readonly postButton: Locator;
  readonly dialog: Locator;

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Double Entries Generation for Inward NEFT' });
    this.postButton = page.getByRole('button', { name: 'Post', exact: true });
    this.dialog = page.getByRole('dialog').filter({ hasText: 'Transaction Details' });
  }

  async expectLoaded() {
    await expect(this.heading).toBeVisible({ timeout: 60_000 });
  }

  /** Ticks a settlement window ("2026-11-06 09:37:00") listed for the selected date (today by default). */
  async selectWindow(window: string) {
    // MUI list items (no button role); text is "2026-11-06 09:37:00".
    const item = this.page.locator('main li').filter({ hasText: window }).first();
    await expect(item, `Settlement window ${window} not listed`).toBeVisible({ timeout: 60_000 });
    await item.click();
    await expect(item.locator('input[type="checkbox"]')).toBeChecked();
  }

  async selectDirection(direction: Direction) {
    await this.page.getByRole('radio', { name: direction, exact: true }).check();
  }

  /** Post -> returns the summary dialog values (or the warning when there's nothing to post). */
  async post(): Promise<{ count: number; amount: number } | { warning: string }> {
    await expect(this.postButton).toBeEnabled();
    await this.postButton.click();
    const warning = this.page.locator('.notification-warning, .notification-error').first();
    await expect(this.dialog.or(warning)).toBeVisible({ timeout: 120_000 });
    if (await warning.isVisible()) return { warning: (await warning.innerText()).replace(/\s+/g, ' ').trim() };
    const value = async (label: string) =>
      (await this.dialog.locator('tr').filter({ hasText: label }).locator('td').nth(1).innerText()).trim();
    return {
      count: Number((await value('Total Record Found')).replace(/,/g, '')),
      amount: Number((await value('Total Amount')).replace(/,/g, '')),
    };
  }

  /**
   * Proceed in the summary dialog -> POST ...DoublePosting ({ successful, Message }). Read from the
   * API response (the toast disappears too fast to read reliably).
   */
  async proceed() {
    const response = this.page.waitForResponse((r) => /DoublePosting/i.test(r.url()) && r.request().method() === 'POST',
      { timeout: 600_000 });
    await this.dialog.getByRole('button', { name: 'Proceed' }).click();
    const res = await response;
    const body = await res.json().catch(async () => ({ Message: await res.text().catch(() => '') }));
    const ok = res.ok() && body?.successful !== 0 && body?.successful !== false && body?.successful !== '0';
    return { ok, message: `${res.status()} ${body?.Message ?? JSON.stringify(body)}` };
  }
}
