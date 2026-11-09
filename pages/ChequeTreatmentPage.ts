import { expect, test, type Locator, type Page } from '@playwright/test';

export type TreatmentMode = 'Pre' | 'Full';

/**
 * Clearing > Inward Chq Pre Treatment / Inward Chq Full Treatment (same screen, two modes):
 * "Inward Cheque Pre Treatment" / "Inward Cheque Full Treatment".
 *
 * Settlement Time list (tick the window -> cheques load into the table) -> row "Details" opens
 * "Cheque Details" (#chequeDetailsModal):
 *   - Pre treatment: check/correct the captured details (account, cheque no., amount ...) -> Save.
 *   - Full treatment: View Mandate (#mandateModal) -> Affirmations (Mandate / Funding / Confirmation)
 *     -> Honor / Return (+ Return Reason) / Suspend -> Save (labelled "Return" when returning).
 * Save posts TreatChequeItem; its DisplayMessage contains "successfully" when saved.
 */
export class ChequeTreatmentPage {
  readonly heading: Locator;
  readonly rows: Locator;
  readonly details: Locator;
  readonly saveButton: Locator;
  readonly mandateModal: Locator;
  readonly lockedModal: Locator;

  constructor(readonly page: Page, readonly mode: TreatmentMode) {
    this.heading = page.getByRole('heading', { name: `Inward Cheque ${mode} Treatment` });
    this.rows = page.locator('main .rdt_TableBody .rdt_TableRow');
    this.details = page.locator('#chequeDetailsModal');
    this.saveButton = this.details.locator('#btnSave');
    this.mandateModal = page.locator('#mandateModal');
    this.lockedModal = page.locator('#lockedItemMsgModal').filter({ visible: true }); // the page has two copies
  }

  async expectLoaded() {
    await expect(this.heading).toBeVisible({ timeout: 60_000 });
  }

  /** Ticks the settlement time (checkbox value is the raw "2026-11-07T10:15:00..."). */
  async selectSettlement(settlement: { date: string; time: string }) {
    const boxes = this.page.locator('input.stlChkBx');
    await expect(boxes.first(), 'No settlement times listed').toBeVisible({ timeout: 60_000 });
    const wanted = new RegExp(`^${settlement.date}.${settlement.time}`);
    const values = await boxes.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    const index = values.findIndex((v) => wanted.test(v));
    if (index < 0) throw new Error(`Settlement ${settlement.date} ${settlement.time} not listed. Listed: ${values.slice(0, 10).join(', ')}`);
    await boxes.nth(index).check();
  }

  /** The row for a cheque, found by its serial (cheque) number. */
  row(serialNo: string) {
    return this.rows.filter({ hasText: serialNo });
  }

  async openDetails(serialNo: string) {
    const row = this.row(serialNo);
    await expect(row, `Cheque ${serialNo} not loaded`).toHaveCount(1, { timeout: 60_000 });
    await row.getByRole('button', { name: 'Details', exact: true }).click();
    await expect(this.details.or(this.lockedModal).first()).toBeVisible({ timeout: 60_000 });
    if (await this.lockedModal.count()) {
      throw new Error(`Cheque ${serialNo} cannot be opened: ${(await this.lockedModal.first().innerText()).trim()}`);
    }
    await expect(this.details.getByRole('heading', { name: 'Cheque Details' })).toBeVisible();
  }

  /** Full treatment: View Mandate, keep it open for `seconds` (like a reviewer would), close it. */
  async viewMandate(seconds: number) {
    const button = this.details.locator('#btnViewMandate');
    await expect(button).toBeVisible();
    const loaded = this.page.waitForResponse((r) => /LoadMandates/i.test(r.url()), { timeout: 60_000 });
    await button.click();
    const res = await loaded;
    const body = await res.json().catch(() => []);
    const count = Array.isArray(body) ? body.length : 0;
    test.info().annotations.push({ type: 'Mandate', description: `${count} mandate record(s) shown for ${seconds}s` });
    await this.page.waitForTimeout(seconds * 1000);
    // Close: header close button when mandates are listed; otherwise hide the (empty) modal.
    const close = this.mandateModal.locator('.modal-header').locator('button.close, button.btn-close').first();
    if (await close.isVisible().catch(() => false)) await close.click();
    else await this.page.evaluate(() => (window as any).$('#mandateModal').modal('hide'));
    await expect(this.mandateModal).toBeHidden({ timeout: 15_000 });
    return count;
  }

  /** Full treatment: tick the affirmations (Mandate, Funding, Confirmation) after reviewing. */
  async affirm(which: ('Mandate' | 'Funding' | 'Confirmation')[] = ['Mandate', 'Funding', 'Confirmation']) {
    const cls = { Mandate: '.chkbxAffMandate', Funding: '.chkbxAffFunding', Confirmation: '.chkbxAffConfirm' };
    for (const w of which) {
      const box = this.details.locator(cls[w]).first();
      if (!(await box.isChecked())) await box.check();
    }
  }

  async honour() {
    await this.details.locator('input[name="status"][value="Honor"]').check();
  }

  /** Return with `reason` if listed, else the first reason. Returns the reason used. */
  async markReturn(reason?: string) {
    await this.details.locator('input[name="status"][value="Return"]').check();
    const select = this.details.locator('select.selReturnRsn');
    await expect(select).toBeVisible();
    const options = (await select.locator('option').allTextContents()).map((o) => o.trim()).filter(Boolean);
    if (!options.length) throw new Error('No cheque return reasons configured');
    const chosen = reason && options.includes(reason) ? reason : options[0];
    await select.selectOption({ label: chosen });
    await expect(this.saveButton).toHaveText('Return');
    return chosen;
  }

  /** Save (or "Return") -> TreatChequeItem; returns { ok, message, status }. Closes the details window. */
  async save() {
    await expect(this.saveButton).toBeEnabled();
    const response = this.page.waitForResponse((r) => /TreatChequeItem/i.test(r.url()) && r.request().method() === 'POST',
      { timeout: 180_000 });
    await this.saveButton.click();
    const res = await response;
    const body = await res.json().catch(() => ({}));
    const message = String(body?.DisplayMessage ?? '').trim();
    const status = body?.IsHonor ? 'H' : body?.IsReturn ? 'R' : body?.IsSuspend ? 'S' : '';
    // Result popup closes itself on success; close it and the details window either way.
    await this.page.waitForTimeout(500);
    for (const id of ['#saveChqDtInfoAndRemainModal', '#saveChqDtInfoModal']) {
      const m = this.page.locator(id);
      if (await m.isVisible().catch(() => false)) await m.locator('.btn-close').click().catch(() => {});
    }
    if (await this.details.isVisible()) {
      await this.details.locator('#btnCloseWindow').click();
      await expect(this.details).toBeHidden({ timeout: 15_000 });
    }
    return { ok: res.ok() && /success/i.test(message), message: `${res.status()} ${message}`, status };
  }
}
