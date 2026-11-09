import { test, expect } from '../../fixtures/test';
import { SideMenu } from '../../pages/SideMenu';
import { PresentmentPage, type PresentmentTransType } from '../../pages/PresentmentPage';
import { readApproved } from '../../flows/neftOutward';
import { pickupWaitSeconds, watchOutwardFiles } from '../../flows/transmitter';

/**
 * Outward transmission, after the NEFT outward transfers have been created and approved.
 * (File name sorts after the cr-/dr- tests, so in a full run of tests/neft-outward it runs last.)
 *
 *   1. Clearing > Generate Presentment Files > Trans Type NEFT > Transmit.
 *   2. A new OPFData_<bank>_<date>_<msgId>.xml appears in E:\MyOutward (OUTWARD_FILE_DIR).
 *      Any transfers approved earlier in this run must be in it.
 *   3. The iTellerTransmitter Windows service (C:\Program Files (x86)\PFS\iTeller Transmitter,
 *      checks every minute) moves the file to E:\MyOutward\Archive within PICKUP_WAIT_SECONDS
 *      (default 180; 0 = stop after step 2), then logs in iTELLERCHLogs\log1.txt
 *      "Outward Presentment Items sent to Server ... MsgID:<n>" and "Response received from Server. MsgID:<n>".
 *
 * WARNING: Transmit sends every approved, untransmitted item for all branches, not only the
 * items this test suite created. Run it only on a test environment.
 */
const transType = (process.env.PRESENTMENT_TRANS_TYPE || 'NEFT') as PresentmentTransType;

test('NEFT Outward transmission: Generate Presentment Files > Transmit', async ({ page }) => {
  test.setTimeout(900_000 + pickupWaitSeconds() * 1000 + 240_000);
  const approved = readApproved();
  test.info().annotations.push({
    type: 'Approved in this run',
    description: approved.length
      ? approved.map((a) => `${a.type} batch ${a.batchId} (${a.narration})`).join(', ')
      : 'none (transmitting whatever approved items already exist)',
  });

  const watch = watchOutwardFiles('OPFData');

  await test.step(`transmit ${transType}`, async () => {
    const menu = new SideMenu(page);
    await menu.openApp();
    await menu.navigate('Clearing', 'Generate Presentment Files');
    await expect(page).toHaveURL(/GenerateCaptureFile/);

    const presentment = new PresentmentPage(page);
    await presentment.expectLoaded();
    const message = await presentment.transmit(transType);
    test.info().annotations.push({ type: 'Transmit result', description: message });
    expect(message, 'Transmit failed. If it says "No records matching", nothing was approved and untransmitted '
      + '(approval needs an APPROVER_USERNAME different from the maker).').not.toMatch(/no records|fail|error/i);
  });

  const summary = await watch.expectNewFile();
  for (const a of approved) {
    expect.soft(summary.content, `Approved ${a.type} batch ${a.batchId} (beneficiary/payer ${a.counterpartyAccountNo}) not in file`)
      .toContain(a.counterpartyAccountNo);
  }

  await watch.expectTransmitted(summary.file);
});
