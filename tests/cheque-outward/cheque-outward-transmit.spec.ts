import { test, expect } from '../../fixtures/test';
import { SideMenu } from '../../pages/SideMenu';
import { PresentmentPage } from '../../pages/PresentmentPage';
import { readApprovedCheques } from '../../flows/chequeOutward';
import { pickupWaitSeconds, watchOutwardFiles } from '../../flows/transmitter';

/**
 * Outward cheque transmission, after the cheques have been scanned and approved
 * (file name sorts after the cheque-outward-scan-* tests, so in a full run it runs last).
 *
 *   1. Clearing > Generate Presentment Files > Trans Type Cheques > Transmit.
 *   2. A new OPFData_<bank>_<date>_<msgId>.xml appears in E:\MyOutward (OUTWARD_FILE_DIR) with
 *      the cheques approved earlier in this run (cheque number, paying bank sort code, amount).
 *   3. The iTellerTransmitter service archives it and sends it to the switch (same checks as NEFT).
 *
 * WARNING: Transmit sends every approved, untransmitted cheque for all branches, not only the
 * ones this suite created. Run it only on a test environment.
 */
test('Cheque Outward transmission: Generate Presentment Files (Cheques) > Transmit', async ({ page }) => {
  test.setTimeout(900_000 + pickupWaitSeconds() * 1000 + 240_000);
  const approved = readApprovedCheques();
  test.info().annotations.push({
    type: 'Approved in this run',
    description: approved.length
      ? approved.map((c) => `${c.mode} cheque ${c.chequeNumber} (Trans. ID ${c.tranID}, NGN ${c.amount.toFixed(2)})`).join(', ')
      : 'none (transmitting whatever approved cheques already exist)',
  });

  const watch = watchOutwardFiles('OPFData');

  await test.step('transmit Cheques', async () => {
    const menu = new SideMenu(page);
    await menu.openApp();
    await menu.navigate('Clearing', 'Generate Presentment Files');
    await expect(page).toHaveURL(/GenerateCaptureFile/);

    const presentment = new PresentmentPage(page);
    await presentment.expectLoaded();
    const message = await presentment.transmit('Cheques');
    test.info().annotations.push({ type: 'Transmit result', description: message });
    expect(message, 'Transmit failed. If it says "No records matching", no approved, untransmitted cheque exists '
      + '(approval may need an APPROVER_USERNAME different from the maker).').not.toMatch(/no records|fail|error/i);
  });

  const summary = await watch.expectNewFile();
  for (const c of approved) {
    const item = new RegExp(`<SerialNo>0*${c.chequeNumber}</SerialNo>\\s*<SortCode>${c.sortCode}</SortCode>`);
    expect.soft(summary.content, `Approved cheque ${c.chequeNumber} (${c.sortCode}) not in the file`).toMatch(item);
  }

  await watch.expectTransmitted(summary.file);
});
