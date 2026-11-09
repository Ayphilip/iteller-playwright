import { test } from '../../fixtures/test';
import { receiveInward } from '../../flows/neftInward';
import { chequeConfigured, fullTreat, planChequeInward, postChequeDoubleEntries, preTreat } from '../../flows/chequeInward';

/**
 * Cheque Inward - POSTING (honour):
 *   1. Receive a cheque inward file (1 cheque drawn on INWARD_CHEQUE_ACCOUNT_NO, with images).
 *   2. Clearing > Inward Chq Pre Treatment: tick the settlement time, Details, Save.
 *   3. View > Double Entries: tick the settlement time + Cheques, Generate, Post Double Entry, Yes.
 *   4. Clearing > Inward Chq Full Treatment: Details, View Mandate for a few seconds, affirm,
 *      Honor, Save.
 * Logs: InwardFilesService Event_Log, CustomerDetails EventLog4CO (cheques), EventLogDE, EventLog4DbData.
 */
test.describe.serial('Cheque Inward posting', () => {
  test.skip(!chequeConfigured(), 'Set INWARD_CHEQUE_ACCOUNT_NO (or INWARD_ACCOUNT_NO) in .env');
  test.describe.configure({ timeout: 600_000 });

  const plan = planChequeInward('CIP', [{ role: 'cheque to honour', decision: 'honour', amount: 5001.11 }]);
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

  test('full treatment: Clearing > Inward Chq Full Treatment - view mandate, honour, save', async ({ page }) => {
    test.skip(step < 3, 'Double entries were not posted');
    await fullTreat(page, plan);
  });
});
