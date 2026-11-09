import { expect, type Locator, type Page } from '@playwright/test';

export type PresentmentTransType = 'Cheques' | 'NEFT' | 'Both';

/**
 * Clearing > Generate Presentment Files (/pages/Clearing/GenerateCaptureFile).
 *
 * Trans Type (Cheques | NEFT | Both), optional Regenerate, Date (always today, read-only),
 * States + Branches (all pre-selected once loaded) -> Transmit.
 * The API (GeneratePresentmentData) builds the file through CustomerDetails, which writes
 * <OutwardFilePath4iTeller>_<bank>_<yyyymmdd>_<msgId>.xml, e.g. E:\MyOutward\OPFData_305_20261105_2700.xml.
 * The result is shown in the "File Capture" dialog.
 */
export class PresentmentPage {
  readonly heading: Locator;
  readonly transType: Locator;
  readonly regenerate: Locator;
  readonly date: Locator;
  readonly states: Locator;
  readonly branches: Locator;
  readonly transmitButton: Locator;
  readonly resultModal: Locator;
  readonly resultMessage: Locator;

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Generate Presentment Files' });
    this.transType = page.locator('#selTransType');
    this.regenerate = page.locator('#regenChkbx');
    this.date = page.locator('#dtCapWrp input');
    this.states = page.locator('.chkBxState');
    this.branches = page.locator('.chkBxBranch');
    this.transmitButton = page.locator('#btnTransmit');
    this.resultModal = page.locator('#CptFileGenModal');
    this.resultMessage = this.resultModal.locator('#spnCaputuremsg');
  }

  /** Waits until states and branches have loaded and are all selected. */
  async expectLoaded() {
    await expect(this.heading).toBeVisible({ timeout: 60_000 });
    await expect(this.transmitButton).toBeEnabled({ timeout: 60_000 });
    await expect(this.transType.locator('option')).not.toHaveCount(0);
    await expect.poll(async () => {
      const [s, sc, b, bc] = await Promise.all([
        this.states.count(), this.page.locator('.chkBxState:checked').count(),
        this.branches.count(), this.page.locator('.chkBxBranch:checked').count(),
      ]);
      return s > 0 && b > 0 && s === sc && b === bc;
    }, { message: 'All states and branches should be loaded and selected', timeout: 60_000 }).toBe(true);
  }

  /** Selects the type, then Transmit. Returns the "File Capture" message. */
  async transmit(type: PresentmentTransType, opts: { regenerate?: boolean } = {}) {
    await this.transType.selectOption({ label: type });
    await this.regenerate.setChecked(!!opts.regenerate);
    await this.transmitButton.click();
    // Building the file goes through every branch's items: allow several minutes.
    await expect(this.resultModal).toBeVisible({ timeout: 600_000 });
    await expect(this.resultMessage).not.toHaveText('');
    const message = (await this.resultMessage.innerText()).trim();
    await this.resultModal.getByRole('button', { name: 'Ok' }).click();
    await expect(this.resultModal).toBeHidden();
    return message;
  }
}
