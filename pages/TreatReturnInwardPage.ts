import { expect, type Locator, type Page } from '@playwright/test';

export type ReturnSettlementType = 'Cheque' | 'Neft' | 'Both';

/**
 * Clearing > Treat Return Inward (/pages/Clearing/returnInward), "Return Inward".
 *
 * Date (today by default) -> "Return Inward Settlement Date" list (POST /api/ReturnInward/LoadSession:
 * settlement times of received return files) -> tick one -> Settlement Type (Cheque | Neft | Both)
 * -> Load Data (POST /api/ReturnInward/LoadData: the returned items matched to our outward
 * cheques/NEFT, not yet posted) -> Generate CSV/POST (POST /api/ReturnInward/GenerateCSV: posts
 * the return entries to the CBA, answers with a text such as
 * "1 RECORD(S)  POSTED TO CBA! 1 RECORD(S) ARE SUCCESSFULLY POSTED TO CBA - 0 RECORD(S) FAILED ...")
 * -> "Good job!" popup (or "Oops..." on an error) -> the list reloads.
 */
export class TreatReturnInwardPage {
  readonly heading: Locator;
  readonly sessions: Locator;
  readonly rows: Locator;
  readonly popup: Locator;

  constructor(readonly page: Page) {
    this.heading = page.locator('h3.page-title').filter({ hasText: /^Return Inward/ });
    this.sessions = page.locator('main li').filter({ has: page.locator('input[type="checkbox"]') });
    this.rows = page.locator('main .MuiDataGrid-row');
    this.popup = page.locator('.swal2-popup');
  }

  async expectLoaded() {
    await expect(this.heading).toBeVisible({ timeout: 60_000 });
  }

  /** The settlement time's entry, listed as e.g. "2026-11-08T16:05:00". */
  session(settlement: { date: string; time: string }) {
    return this.sessions.filter({ hasText: new RegExp(`${settlement.date}.${settlement.time}`) });
  }

  async selectSession(settlement: { date: string; time: string }) {
    const item = this.session(settlement).first();
    await expect(item, `Return settlement ${settlement.date} ${settlement.time} not listed`).toBeVisible({ timeout: 60_000 });
    const box = item.locator('input[type="checkbox"]');
    await box.click(); // the row's click handler toggles the selection
    await expect(box).toBeChecked();
  }

  async selectType(type: ReturnSettlementType) {
    await this.page.locator('#demo-simple-select').click();
    await this.page.getByRole('option', { name: type, exact: true }).click();
    await expect(this.page.locator('#demo-simple-select')).toHaveText(type);
  }

  /** Load Data -> the returned items listed (API rows: RecordId, SerialNumber, PayBankRoutNo, AccountNumber, ItemAmount ...). */
  async loadData() {
    const response = this.page.waitForResponse((r) => /\/api\/ReturnInward\/LoadData$/i.test(r.url()), { timeout: 180_000 });
    await this.page.getByRole('button', { name: 'Load Data' }).click();
    const res = await response;
    const body = await res.json().catch(() => ({}));
    const items: Record<string, any>[] = Array.isArray(body?.ReturnInward) ? body.ReturnInward : [];
    if (items.length) await expect(this.rows.first()).toBeVisible({ timeout: 30_000 });
    return { fileFound: body?.FileResult?.Status === true, items };
  }

  row(recordId: number | string) {
    return this.page.locator(`main .MuiDataGrid-row[data-id="${recordId}"]`);
  }

  /** Generate CSV/POST -> { ok, message } from the API answer and the result popup. */
  async generateAndPost() {
    const button = this.page.getByRole('button', { name: 'Generate CSV/POST' });
    await expect(button).toBeEnabled();
    const response = this.page.waitForResponse((r) => /\/api\/ReturnInward\/GenerateCSV$/i.test(r.url()), { timeout: 600_000 });
    await button.click();
    const res = await response;
    const apiText = (await res.text().catch(() => '')).replace(/^"|"$/g, '').trim();
    await expect(this.popup).toBeVisible({ timeout: 60_000 });
    const title = (await this.popup.locator('.swal2-title').innerText().catch(() => '')).trim();
    const text = (await this.popup.locator('.swal2-html-container').innerText().catch(() => '')).trim();
    await this.popup.locator('.swal2-confirm').click().catch(() => {});
    const message = text || apiText;
    const posted = Number(/(\d+) RECORD\(S\) ARE SUCCESSFULLY POSTED/i.exec(message)?.[1] ?? NaN);
    const failedCount = Number(/(\d+) RECORD\(S\) FAILED/i.exec(message)?.[1] ?? NaN);
    const errorText = /error|exception|oops/i.test(`${title} ${message}`);
    return {
      ok: res.ok() && /good job/i.test(title) && !errorText && !(failedCount > 0),
      message: `${res.status()} ${title}: ${message}`,
      posted,
      failedCount,
    };
  }
}
