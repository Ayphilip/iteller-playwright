import { test } from '../../fixtures/test';
import { findReturnableItems, planReturnInward, receiveReturnFile, treatReturnInward } from '../../flows/returnInward';

/**
 * Treat Return Inward - NEFT:
 *   1. Receive: an IRFData return file returning RETURN_INWARD_COUNT (default 1) of our transmitted
 *      outward NEFT items (neftdump, NGN) is read by the InwardFilesService.
 *   2. Clearing > Treat Return Inward: select that return settlement time, NEFT, Load Data,
 *      Generate CSV/POST (posts the return entries to the CBA).
 * Logs: InwardFilesService Event_Log.txt, iTeller API, CustomerDetails.
 */
test.describe.serial('Return Inward NEFT', () => {
  test.describe.configure({ timeout: 600_000 });
  const items = findReturnableItems('neft', Number(process.env.RETURN_INWARD_COUNT || 1));
  const plan = planReturnInward('neft', items);
  let received = false;

  test('receive: InwardFilesService reads the neft return (IRF) file', async () => {
    test.skip(!items.length, 'No transmitted neft item left to return (run the neft outward tests and transmit first)');
    test.info().annotations.push({
      type: 'Returning',
      description: items.map((i) => `${i.serialNo} ${i.sortCode}/${i.accountNo} TC${i.tranCode} NGN ${i.amount.toFixed(2)}`).join(', '),
    });
    await receiveReturnFile(plan);
    received = true;
  });

  test('treat: Clearing > Treat Return Inward - settlement date, Load Data, Generate CSV/POST', async ({ page }) => {
    test.skip(!received, 'Return file was not received');
    await treatReturnInward(page, plan);
  });
});
