import { expect, type Locator, type Page } from '@playwright/test';

export type ScanMode = 'Web' | 'Lite';

/**
 * Transactions > Scan Outward Cheque(Web) / Scan Outward Cheque(Lite)
 * (/pages/Transactions/ScanOutwardChequeWeb | ScanOutwardChequeLite).
 *
 * "Scanner List" (POST /api/LoadScanner | LoadScannerLite) -> Launch Scanner
 * (POST /api/LaunchWebScanner | LaunchScannerLite) -> the browser is sent to the scanner's
 * ClickOnce installer, e.g. http://localhost:8015/installables/scanners/ScannerRS900UV/ScannerRS900UV.application?uid=...
 * The scanner itself is a Windows desktop app (Web: validates the account on the CBA; Lite: no
 * validation) that saves the cheques through the CustomerDetails service.
 */
export class ScanChequePage {
  readonly heading: Locator;
  readonly scanners: Locator;
  readonly launchButton: Locator;

  constructor(readonly page: Page, readonly mode: ScanMode) {
    this.heading = page.getByRole('heading', { name: `Scan Outward Cheque(${mode})` });
    this.scanners = page.locator('#launchScnDrpdwn');
    this.launchButton = page.getByRole('button', { name: 'Launch Scanner' });
  }

  async expectLoaded() {
    await expect(this.heading).toBeVisible({ timeout: 60_000 });
    await expect(this.scanners.locator('option').first(), 'No scanners configured').toBeAttached({ timeout: 60_000 });
  }

  async scannerNames() {
    return (await this.scanners.locator('option').allTextContents()).map((s) => s.trim());
  }

  /**
   * Picks `scanner` (or keeps the first), clicks Launch Scanner and returns the launch URL the API
   * gave, and whether the scanner application could be downloaded from it.
   * The Web page auto-launches when only one scanner is configured.
   */
  async launch(scanner?: string) {
    const names = await this.scannerNames();
    if (scanner && names.includes(scanner)) await this.scanners.selectOption({ label: scanner });
    const chosen = (await this.scanners.locator('option:checked').textContent())?.trim() ?? '';
    const api = this.mode === 'Web' ? /\/api\/LaunchWebScanner/i : /\/api\/LaunchScannerLite/i;
    const response = this.page.waitForResponse((r) => api.test(r.url()), { timeout: 60_000 });
    // The page navigates away (window.location = launch URL), so don't wait for the click to settle.
    await this.launchButton.click({ noWaitAfter: true });
    const res = await response;
    const url = (await res.text().catch(() => '')).replace(/^"|"$/g, '').trim();
    let status = 0;
    if (url) {
      const probe = await this.page.request.get(url, { failOnStatusCode: false, maxRedirects: 0 }).catch(() => null);
      status = probe?.status() ?? 0;
    }
    return { scanner: chosen, scanners: names, apiStatus: res.status(), url, status, available: status === 200 };
  }
}
