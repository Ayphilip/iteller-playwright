import { test, expect } from '../../fixtures/test';
import { SideMenu } from '../../pages/SideMenu';
import { ReturnRequestTransmissionPage } from '../../pages/ReturnRequestTransmissionPage';
import { receiveInward } from '../../flows/neftInward';
import { chequeConfigured, fullTreat, planChequeInward, postChequeDoubleEntries, preTreat } from '../../flows/chequeInward';
import { pickupWaitSeconds, watchOutwardFiles } from '../../flows/transmitter';

/**
 * Cheque Inward - RETURN:
 *   1. Receive a cheque inward file (1 cheque).
 *   2. Clearing > Inward Chq Pre Treatment: Details, Save.
 *   3. View > Double Entries: Generate, Post Double Entry.
 *   4. Clearing > Inward Chq Full Treatment: Details, View Mandate for a few seconds, Return with a
 *      reason (CHEQUE_RETURN_REASON or the first listed), Save ("Return").
 *   5. Clearing > Return Request File Transmission: tick the settlement time, Cheque, Transmit ->
 *      E:\MyOutward\ORFData_<bank>_<date>_<msgId>.xml with the cheque -> iTeller Transmitter sends it.
 *
 * WARNING: Transmit may include other items awaiting return, not only this test's cheque.
 */
test.describe.serial('Cheque Inward return', () => {
  test.skip(!chequeConfigured(), 'Set INWARD_CHEQUE_ACCOUNT_NO (or INWARD_ACCOUNT_NO) in .env');
  test.describe.configure({ timeout: 600_000 });

  const plan = planChequeInward('CIR', [{ role: 'cheque to return', decision: 'return', amount: 5002.22 }]);
  const [cheque] = plan.items;
  let step = 0;

  test('receive: InwardFilesService picks up the cheque inward file', async () => {
    await receiveInward(plan);
    step = 1;
  });

  test('pre treatment: Clearing > Inward Chq Pre Treatment - details, save', async ({ page }) => {
    test.skip(step < 1, 'File was not received');
    await preTreat(page, plan);
    step = 2;
  });

  test('double entries: View > Double Entries - generate, post', async ({ page }) => {
    test.skip(step < 2, 'Pre treatment did not complete');
    await postChequeDoubleEntries(page, plan);
    step = 3;
  });

  test('full treatment: Clearing > Inward Chq Full Treatment - view mandate, return, save', async ({ page }) => {
    test.skip(step < 3, 'Double entries were not posted');
    await fullTreat(page, plan);
    step = 4;
  });

  test('transmit: Clearing > Return Request File Transmission (Cheque)', async ({ page }) => {
    test.skip(step < 4, 'Cheque was not returned');
    test.setTimeout(600_000 + pickupWaitSeconds() * 1000 + 240_000);
    const watch = watchOutwardFiles('ORFData');

    const menu = new SideMenu(page);
    await menu.openApp();
    await menu.navigate('Clearing', 'Return Request File Transmission');
    const rt = new ReturnRequestTransmissionPage(page);
    await rt.expectLoaded();
    await rt.selectFileId(plan.settlement);
    await rt.selectTypes({ cheque: true });
    const result = await rt.transmit();
    test.info().annotations.push({ type: 'Transmit result', description: result.message });
    expect(result.ok, result.message).toBe(true);

    const summary = await watch.expectNewFile();
    expect(summary.content, `Returned cheque ${cheque.serialNo} not in the return file`).toContain(cheque.seq);
    await watch.expectTransmitted(summary.file);
  });
});
