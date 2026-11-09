import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Clearing > Return Request File Transmission (/pages/clearing/returnRequestFileTransmission).
 *
 * "Posting File ID" list (settlement windows with items to return) -> tick the window ->
 * Settlement Window session (11) -> settlement type Neft (and/or Cheque) -> Transmit.
 * The API (GenerateReturnRequest) has CustomerDetails write E:\MyOutward\ORFData_<bank>_<date>_<msgId>.xml,
 * then a confirmation pops up with the response; "No item to generate return file for" if nothing.
 */
export class ReturnRequestTransmissionPage {
  readonly heading: Locator;
  readonly transmitButton: Locator;

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Return Request File Transmission' });
    this.transmitButton = page.getByRole('button', { name: 'Transmit', exact: true });
  }

  async expectLoaded() {
    await expect(this.heading).toBeVisible({ timeout: 60_000 });
  }

  /** The window's entry in "Posting File ID" (MUI list item, shown as e.g. "2026-11-06T09:11:00.00"). */
  fileId(settlement: { date: string; time: string }) {
    return this.page.locator('main li').filter({ hasText: new RegExp(`${settlement.date}.${settlement.time}`) });
  }

  async selectFileId(settlement: { date: string; time: string }) {
    const item = this.fileId(settlement);
    await expect(item, `Settlement ${settlement.date} ${settlement.time} not listed under Posting File ID`)
      .toBeVisible({ timeout: 60_000 });
    await item.first().click();
    await expect(item.first().locator('input[type="checkbox"]')).toBeChecked();
  }

  async selectTypes(types: { neft?: boolean; cheque?: boolean }) {
    await this.page.getByRole('checkbox', { name: 'Neft', exact: true }).setChecked(!!types.neft);
    await this.page.getByRole('checkbox', { name: 'Cheque', exact: true }).setChecked(!!types.cheque);
  }

  /** Transmit -> confirmation (Ok) or warning toast. Returns { ok, message }. */
  async transmit() {
    await expect(this.transmitButton).toBeEnabled();
    // POST ReturnRequest/Generate -> { succeeded, result: { Response } }. On failure the page only
    // says "No item to generate return file for", so keep the API's own answer for the report.
    const response = this.page.waitForResponse((r) => /ReturnRequest\/Generate/i.test(r.url()), { timeout: 600_000 });
    await this.transmitButton.click();
    const res = await response;
    const body = await res.json().catch(() => ({}));
    const apiMessage = `${res.status()} succeeded=${body?.succeeded} ${body?.result?.Response ?? body?.message ?? ''}`.trim();

    const confirm = this.page.locator('.swal2-popup');
    if (body?.succeeded !== true) return { ok: false, message: `No return file generated (API: ${apiMessage})` };
    await expect(confirm).toBeVisible({ timeout: 30_000 });
    const message = (await confirm.locator('.swal2-html-container').innerText()).trim();
    await confirm.getByRole('button', { name: 'Ok' }).click();
    return { ok: true, message };
  }
}
