import { expect, test, type Locator, type Page } from '@playwright/test';

/** Approval > Pending Transfers (/pages/Approval/NeftOutwardPending). */
export class PendingTransfersPage {
  readonly heading: Locator;
  readonly filter: Locator;
  readonly rows: Locator;
  readonly loadingModal: Locator;
  readonly detailsModal: Locator;
  readonly detailsAccountNo: Locator;
  readonly detailsNarration: Locator;
  readonly detailsTitle: Locator;
  readonly detailsRows: Locator;
  readonly detailsClose: Locator;
  readonly approveButton: Locator;
  readonly disapproveButton: Locator;
  readonly approveConfirmModal: Locator;
  readonly disapproveModal: Locator;
  /** Result of approve/disapprove: #headerSpn "Item(s) Approved Succesfully" / "Approval Failed" / ... */
  readonly resultModal: Locator;

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { name: 'Transactions Pending Approval' });
    this.filter = page.locator('main #search');
    this.rows = page.locator('main .rdt_TableBody .rdt_TableRow');
    this.loadingModal = page.locator('#PendingDetailsStillLoadingModal');
    this.detailsModal = page.locator('#OutwardNEFTPendingDetailsModal');
    this.detailsAccountNo = this.detailsModal.locator('#txtAccNum');
    this.detailsNarration = this.detailsModal.locator('#txtNarration');
    this.detailsTitle = this.detailsModal.locator('#txtTitle');
    this.detailsRows = this.detailsModal.locator('.rdt_TableBody .rdt_TableRow');
    this.detailsClose = this.detailsModal.locator('#btnCloseWindow');
    this.approveButton = this.detailsModal.getByRole('button', { name: 'Approve', exact: true });
    this.disapproveButton = this.detailsModal.getByRole('button', { name: 'Disapprove', exact: true });
    this.approveConfirmModal = page.locator('#preProceedModal4PndDetail');
    this.disapproveModal = page.locator('#DisapprovalReasonModalForDetail');
    this.resultModal = page.locator('#approvedSuccessfullyModal');
  }

  /** Details > Approve > "Are you sure?" Proceed. Returns the result dialog's header and message. */
  async approve() {
    await this.approveButton.click();
    await expect(this.approveConfirmModal).toBeVisible();
    await this.approveConfirmModal.locator('#btnProceed').click();
    return this.readResult();
  }

  /**
   * Details > Disapprove > choose a reason > Ok. Uses `reason` if it is one of the app's reasons,
   * otherwise the first listed reason; falls back to "Other" with `reason` as free text.
   */
  async disapprove(reason?: string) {
    await this.disapproveButton.click();
    await expect(this.disapproveModal).toBeVisible();
    const select = this.disapproveModal.locator('select');
    // Reasons are fetched when the page opens; wait until more than "Select Reason"/"Other" are there.
    await expect.poll(() => select.locator('option').count(), { timeout: 15_000 }).toBeGreaterThan(2)
      .catch(() => { /* none configured: use "Other" below */ });
    const options = (await select.locator('option').allTextContents()).map((o) => o.trim());
    const listed = options.filter((o) => o && o !== 'Select Reason' && o !== 'Other');
    const chosen = reason && listed.includes(reason) ? reason : (!reason && listed[0]);
    if (chosen) {
      await select.selectOption({ label: chosen });
    } else {
      await select.selectOption('Other');
      await this.disapproveModal.locator('#txtDisApprvReason').fill(reason || 'Playwright automated test disapproval');
    }
    const ok = this.disapproveModal.getByRole('button', { name: 'Ok', exact: true });
    await expect(ok).toBeEnabled();
    await ok.click();
    return this.readResult();
  }

  private async readResult() {
    await expect(this.resultModal).toBeVisible({ timeout: 120_000 });
    const header = (await this.resultModal.locator('#headerSpn').innerText()).trim();
    const message = (await this.resultModal.locator('#bodyPara').innerText()).trim();
    await this.resultModal.locator('.btn-close').click();
    await expect(this.resultModal).toBeHidden();
    await expect(this.detailsModal).toBeHidden({ timeout: 30_000 });
    return { header, message };
  }

  async closeDetails() {
    await this.detailsClose.click();
    await expect(this.detailsModal).toBeHidden();
  }

  async expectLoaded() {
    await expect(this.heading).toBeVisible({ timeout: 60_000 });
  }

  /** Filters the list (matches narration, account, title, customer ref or amount). */
  rowFor(text: string) {
    return this.rows.filter({ hasText: text });
  }

  async search(text: string) {
    await this.filter.fill(text);
    await expect(this.rowFor(text)).toHaveCount(1, { timeout: 30_000 });
    return this.rowFor(text);
  }

  async openDetails(text: string) {
    const row = await this.search(text);
    await row.getByRole('button', { name: /Details/ }).click();
    await expect(this.detailsModal).toBeVisible({ timeout: 60_000 });
    // App glitch: "Loading Batch Details..." sometimes stays on top after the details have loaded
    // (Bootstrap ignores hide() during the show animation). It has no close button and blocks the
    // details window, so hide it the way the app intended and flag it in the report.
    try {
      await expect(this.loadingModal).toBeHidden({ timeout: 5_000 });
    } catch {
      test.info().annotations.push({
        type: 'app issue',
        description: `"Loading Batch Details..." modal stayed open after details loaded for "${text}"; hidden by test`,
      });
      await this.page.evaluate(() => (window as any).$('#PendingDetailsStillLoadingModal').modal('hide'));
      await expect(this.loadingModal).toBeHidden();
    }
  }
}
