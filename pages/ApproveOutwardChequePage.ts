import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Approval > Approve Outward Cheque (/pages/Approval/approveOutwardCheque), "Cheque Approval".
 *
 * View Pending Items (POST /api/LoadPending) -> "Select Batch" (one row per scan, Trans. ID) ->
 * the batch's cheques (POST /api/SetPendingItems) -> eye button -> "Approve Cheque" dialog
 * (POST /api/SetPendingDepositDetails: images, cheque no., sort code, account, amount ...) ->
 *   Approve Transaction (POST /api/ApproveCheques) or
 *   Disaprove Transaction -> "Disapproval Reason" -> Continue (POST /api/DisapproveChequeTrans).
 * Both answer { Status: true|false, Message }.
 */
export class ApproveOutwardChequePage {
  readonly heading: Locator;
  readonly batchDialog: Locator;
  readonly chequeRows: Locator;
  readonly dialog: Locator;
  readonly reasonDialog: Locator;
  readonly frontImage: Locator;

  constructor(readonly page: Page) {
    this.heading = page.getByText('Cheque Approval', { exact: true }).first();
    this.batchDialog = page.getByRole('dialog').filter({ hasText: 'Select Batch' });
    this.chequeRows = page.locator('main .MuiDataGrid-row');
    this.dialog = page.getByRole('dialog').filter({ hasText: 'Approve Cheque' });
    this.reasonDialog = page.getByRole('dialog').filter({ hasText: 'Disapproval Reason' });
    this.frontImage = this.dialog.locator('div').filter({ has: page.locator('label', { hasText: 'Front Image' }) }).locator('img').first();
  }

  /** Waits for the page; returns LoadPage's message (e.g. "...Clearing Window has closed") if any. */
  async expectLoaded() {
    const loadPage = this.page.waitForResponse((r) => /\/api\/LoadPage$/i.test(r.url()), { timeout: 60_000 }).catch(() => null);
    await expect(this.heading).toBeVisible({ timeout: 60_000 });
    const res = await loadPage;
    const body = res ? await res.json().catch(() => ({})) : {};
    return String(body?.Message ?? '').trim();
  }

  /** View Pending Items -> Select Batch -> the batch with this Trans. ID. */
  async openBatch(transId: number | string) {
    const pending = this.page.waitForResponse((r) => /\/api\/LoadPending$/i.test(r.url()), { timeout: 60_000 });
    await this.page.getByRole('button', { name: 'View Pending Items' }).click();
    await pending;
    await expect(this.batchDialog, 'No pending outward cheques (Select Batch did not open)').toBeVisible({ timeout: 30_000 });
    const row = this.batchDialog.locator(`.MuiDataGrid-row[data-id="${transId}"]`);
    await expect(row, `Batch ${transId} not pending approval`).toBeVisible({ timeout: 30_000 });
    const items = this.page.waitForResponse((r) => /\/api\/SetPendingItems$/i.test(r.url()), { timeout: 60_000 });
    await row.click();
    await items;
    await expect(this.batchDialog).toBeHidden();
  }

  row(chequeNumber: string) {
    return this.chequeRows.filter({ hasText: chequeNumber });
  }

  /** Eye button of the cheque -> "Approve Cheque" dialog; returns what it shows. */
  async openCheque(chequeNumber: string) {
    const row = this.row(chequeNumber);
    await expect(row, `Cheque ${chequeNumber} not in the batch`).toHaveCount(1, { timeout: 30_000 });
    const details = this.page.waitForResponse((r) => /\/api\/SetPendingDepositDetails$/i.test(r.url()), { timeout: 60_000 });
    await row.getByRole('button').first().click();
    await details;
    await expect(this.dialog).toBeVisible({ timeout: 30_000 });
    await expect(this.dialog.locator('#txtTransId')).toHaveValue(chequeNumber, { timeout: 15_000 });
    const value = (id: string) => this.dialog.locator(`#${id}`).inputValue();
    return {
      chequeNumber: await value('txtTransId'),
      sortCode: await value('txtSortCode'),
      accountNo: await value('txtAccNum'),
      tranType: await value('txtAccountType'),
      expiryDate: await value('txtExpiryDate'),
      checkDigit: await value('txtCheckDigit'),
      amount: await value('txtAmount'),
      beneficiary: await value('txtAccountName'),
      frontImageShown: await this.imageShown(this.frontImage),
      frontImageFormat: await this.imageFormat(this.frontImage),
    };
  }

  /** Format of the shown image's data (the page labels everything image/jpeg). */
  private async imageFormat(img: Locator) {
    const src = (await img.getAttribute('src')) ?? '';
    const data = src.split('base64,')[1] ?? '';
    return data.startsWith('/9j/') ? 'JPEG' : /^SUkq|^TU0A/.test(data) ? 'TIFF' : data.startsWith('iVBOR') ? 'PNG' : data ? 'unknown' : 'none';
  }

  /** True once the image has loaded and decoded (waits up to 15s). */
  private async imageShown(img: Locator) {
    return expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0), { timeout: 15_000 })
      .toBe(true).then(() => true, () => false);
  }

  private async result(api: RegExp, click: () => Promise<void>) {
    const response = this.page.waitForResponse((r) => api.test(r.url()), { timeout: 180_000 });
    await click();
    const res = await response;
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok() && body?.Status === true, message: `${res.status()} ${String(body?.Message ?? '').trim()}` };
  }

  /**
   * Approve Transaction. Picks a Cheque Zone when the dialog asks for one, and types the amount
   * when the bank makes the approver re-enter it from the cheque.
   */
  async approve(amount: number, zone?: string) {
    const zones = this.dialog.locator('#ddlChequeZone');
    if (await zones.isVisible().catch(() => false)) {
      const options = (await zones.locator('option').evaluateAll((els) => els.map((o) => (o as HTMLOptionElement).value))).filter(Boolean);
      await zones.selectOption(zone && options.includes(zone) ? zone : options[0]);
    }
    const amountBox = this.dialog.locator('#txtAmount');
    if (!(await amountBox.inputValue()).trim()) await amountBox.fill(amount.toFixed(2));
    return this.result(/\/api\/ApproveCheques$/i,
      () => this.dialog.getByRole('button', { name: 'Approve Transaction' }).click());
  }

  async disapprove(reason: string) {
    await this.dialog.getByRole('button', { name: 'Disaprove Transaction' }).click();
    await expect(this.reasonDialog).toBeVisible();
    await this.reasonDialog.locator('#reason').fill(reason);
    return this.result(/\/api\/DisapproveChequeTrans$/i,
      () => this.reasonDialog.getByRole('button', { name: 'Continue' }).click());
  }

  /** Closes the dialog if it is still open (it closes itself after the last cheque of a batch). */
  async close() {
    if (await this.dialog.isVisible().catch(() => false)) {
      await this.dialog.getByRole('button', { name: 'close' }).first().click();
      await expect(this.dialog).toBeHidden();
    }
  }
}
