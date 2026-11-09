import { test, expect } from '../../fixtures/test';
import { SideMenu } from '../../pages/SideMenu';
import { DoubleEntryNeftPage } from '../../pages/DoubleEntryNeftPage';
import { commitInward, inwardConfigured, openInwardItems, planInward, receiveInward } from '../../flows/neftInward';

/**
 * NEFT Inward - POSTING:
 *   1. Receive an inward file with 2 credits: a perfect match and a partial match.
 *   2. Clearing > NEFT Inward: Affirm the partial match (both are now lined up), Commit.
 *   3. Clearing > Double Entry Generation NEFT: window > Neft CR > Post > check count/amount > Proceed.
 * Logs: CustomerDetails EventLog4NI (inward), EventLog4DE (double entries), EventLog4DbData.
 */
test.describe.serial('NEFT Inward posting', () => {
  test.skip(!inwardConfigured(), 'Set INWARD_ACCOUNT_NO and INWARD_ACCOUNT_NAME in .env');
  test.describe.configure({ timeout: 600_000 });

  const plan = planInward('NIP', [
    { role: 'perfect match', expected: 'perfect', amount: 1001.11 },
    { role: 'partial match (to Affirm)', expected: 'partial', amount: 1002.22 },
  ]);
  const [perfect, partial] = plan.items;
  let committed = false;

  test('receive: InwardFilesService picks up the inward file', async () => {
    await receiveInward(plan);
  });

  test('treat: Clearing > NEFT Inward - affirm the partial match, commit', async ({ page }) => {
    const inward = await openInwardItems(page, plan);
    await test.step(`affirm the partial match (${partial.seq})`, () => inward.affirm(inward.row(partial.seq)));
    await commitInward(inward);
    committed = true;
    for (const p of [perfect, partial]) {
      expect.soft(await inward.cell(inward.row(p.seq), 'Status'), `${p.role} must not be marked for return`).not.toBe('R');
    }
  });

  test('post: Clearing > Double Entry Generation NEFT', async ({ page }) => {
    test.skip(!committed, 'Items were not committed in the previous step');
    const menu = new SideMenu(page);
    await menu.openApp();
    await menu.navigate('Clearing', 'Double Entry Generation NEFT');

    const de = new DoubleEntryNeftPage(page);
    await de.expectLoaded();
    await de.selectWindow(plan.window);
    await de.selectDirection('Neft CR');

    const summary = await de.post();
    test.info().annotations.push({ type: 'Post summary', description: JSON.stringify(summary) });
    if ('warning' in summary) throw new Error(`Nothing to post: ${summary.warning}`);
    expect.soft(summary.count, 'Items to post').toBe(plan.items.length);
    expect.soft(summary.amount, 'Amount to post').toBeCloseTo(plan.items.reduce((s, p) => s + p.amount, 0), 2);

    const result = await de.proceed();
    test.info().annotations.push({ type: 'Posting result', description: result.message });
    expect(result.ok, result.message).toBe(true);
  });
});
