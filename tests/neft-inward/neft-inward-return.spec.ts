import { test, expect } from '../../fixtures/test';
import { SideMenu } from '../../pages/SideMenu';
import { ReturnRequestTransmissionPage } from '../../pages/ReturnRequestTransmissionPage';
import { commitInward, inwardConfigured, inwardPickupWaitSeconds, openInwardItems, planInward, receiveInward } from '../../flows/neftInward';
import { pickupWaitSeconds, watchOutwardFiles } from '../../flows/transmitter';
import { isoLocal } from '../../utils/inwardFiles';

/**
 * NEFT Inward - RETURN:
 *   1. Receive an inward file with 1 credit that does not match the account name (red).
 *   2. Clearing > NEFT Inward: tick it, select a return reason, Commit (status R).
 *   3. Clearing > Return Request File Transmission: tick the window under "Posting File ID",
 *      Neft, Transmit -> E:\MyOutward\ORFData_<bank>_<date>_<msgId>.xml containing the item ->
 *      iTeller Transmitter archives it and sends it to the switch.
 * Logs: EventLog4NI, EventLog4DbData, and the Transmitter logs.
 *
 * WARNING: Transmit may include other items awaiting return, not only this test's item.
 */
test.describe.serial('NEFT Inward return', () => {
  test.skip(!inwardConfigured(), 'Set INWARD_ACCOUNT_NO and INWARD_ACCOUNT_NAME in .env');
  test.describe.configure({ timeout: 600_000 });

  const plan = planInward('NIR', [{ role: 'no match (to Return)', expected: 'none', amount: 1003.33 }]);
  const [item] = plan.items;
  let returned = false;

  test('receive: InwardFilesService picks up the inward file', async () => {
    test.setTimeout(inwardPickupWaitSeconds() * 1000 + 60_000);
    await receiveInward(plan);
  });

  test('treat: Clearing > NEFT Inward - return the item with a reason, commit', async ({ page }) => {
    const inward = await openInwardItems(page, plan);
    const reason = await test.step(`mark ${item.seq} for return`, () =>
      inward.markForReturn(inward.row(item.seq), process.env.INWARD_RETURN_REASON));
    test.info().annotations.push({ type: 'Return reason', description: `${item.seq}: ${reason}` });
    await commitInward(inward);
    await expect.poll(() => inward.cell(inward.row(item.seq), 'Status'), { timeout: 30_000 }).toBe('R');
    returned = true;
  });

  test('transmit: Clearing > Return Request File Transmission', async ({ page }) => {
    test.skip(!returned, 'Item was not returned in the previous step');
    test.setTimeout(600_000 + pickupWaitSeconds() * 1000 + 240_000);
    const watch = watchOutwardFiles('ORFData');

    const menu = new SideMenu(page);
    await menu.openApp();
    await menu.navigate('Clearing', 'Return Request File Transmission');

    const rt = new ReturnRequestTransmissionPage(page);
    await rt.expectLoaded();
    const [date, time] = isoLocal(plan.file.settlement).split('T');
    await rt.selectFileId({ date, time });
    await rt.selectTypes({ neft: true });
    const result = await rt.transmit();
    test.info().annotations.push({ type: 'Transmit result', description: result.message });
    expect(result.ok, result.message).toBe(true);

    const summary = await watch.expectNewFile();
    expect(summary.content, `Returned item ${item.seq} not in the return file`).toContain(item.seq);
    await watch.expectTransmitted(summary.file);
  });
});
