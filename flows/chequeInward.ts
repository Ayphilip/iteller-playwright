import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import { SideMenu } from '../pages/SideMenu';
import { ChequeTreatmentPage } from '../pages/ChequeTreatmentPage';
import { ChequeDoubleEntryPage } from '../pages/ChequeDoubleEntryPage';
import { isoLocal, windowLabel, type InwardFile } from '../utils/inwardFiles';
import { inwardBankCode, inwardSortCode } from '../utils/env';

/**
 * Shared steps of the cheque inward tests (posting = honour, return):
 *   receive file -> Pre Treatment (Details, Save) -> View > Double Entries (Generate, Post)
 *   -> Full Treatment (Details, View Mandate for a few seconds, affirm, Honor/Return, Save).
 * Logs: CustomerDetails EventLog4CO (cheques), EventLogDE (double entries), EventLog4DbData.
 */
export const chequeAccount = () =>
  process.env.INWARD_CHEQUE_ACCOUNT_NO || process.env.INWARD_ACCOUNT_NO || process.env.TRANSFER_ACCOUNT_NO || '';
export const chequeConfigured = () => !!chequeAccount();
export const mandateViewSeconds = () => Number(process.env.MANDATE_VIEW_SECONDS ?? 5);

export type ChequeDecision = 'honour' | 'return';
export type PlannedCheque = { role: string; decision: ChequeDecision; amount: number; serialNo: string; seq: string };
export type ChequePlan = {
  file: InwardFile; window: string; settlement: { date: string; time: string }; items: PlannedCheque[];
};

/** One cheque inward file, drawn on CHEQUE account, on its own settlement time (today, current minute). */
export function planChequeInward(tag: string, items: { role: string; decision: ChequeDecision; amount: number }[]): ChequePlan {
  const settlement = new Date();
  settlement.setSeconds(0, 0);
  const run = String(Date.now()).slice(-7);
  const planned = items.map((p, i) => ({ ...p, serialNo: `${run.slice(-6)}${i + 1}`.padStart(8, '0'), seq: `8${run}${i + 1}` }));
  const [date, time] = isoLocal(settlement).split('T');
  return {
    window: windowLabel(settlement),
    settlement: { date, time: time.slice(0, 5) },
    items: planned,
    file: {
      kind: 'cheque',
      bankCode: inwardBankCode(),
      msgId: `8${run}`,
      settlement,
      sortCode: inwardSortCode(),
      items: planned.map((p) => ({
        accountNo: chequeAccount(),
        beneficiary: 'PLAYWRIGHT TEST PAYEE',
        amount: p.amount,
        narration: `PW-${tag}-${run}`,
        itemSequenceNo: p.seq,
        serialNo: p.serialNo,
      })),
    },
  };
}

async function openTreatment(page: Page, mode: 'Pre' | 'Full', plan: ChequePlan) {
  const menu = new SideMenu(page);
  await menu.openApp();
  await menu.navigateToPath('Clearing', `/pages/Clearing/InwardChq${mode}Trmt`);
  const screen = new ChequeTreatmentPage(page, mode);
  await screen.expectLoaded();
  await screen.selectSettlement(plan.settlement);
  return screen;
}

/** Clearing > Inward Chq Pre Treatment: open each cheque's Details and Save the captured details. */
export async function preTreat(page: Page, plan: ChequePlan) {
  const screen = await openTreatment(page, 'Pre', plan);
  for (const c of plan.items) {
    await test.step(`pre-treat cheque ${c.serialNo} (${c.role})`, async () => {
      await screen.openDetails(c.serialNo);
      const result = await screen.save();
      test.info().annotations.push({ type: `Pre treatment ${c.serialNo}`, description: result.message });
      expect(result.ok, result.message).toBe(true);
    });
  }
}

/** View > Double Entries: the window + Cheques -> Generate -> Post Double Entry -> Yes. */
export async function postChequeDoubleEntries(page: Page, plan: ChequePlan) {
  const menu = new SideMenu(page);
  await menu.openApp();
  await menu.navigateToPath('View', '/pages/View/DoubleEntries');
  const de = new ChequeDoubleEntryPage(page);
  await de.expectLoaded();
  await de.select(plan.window);
  const zone = await de.selectZone(process.env.CHEQUE_ZONE);
  if (zone) test.info().annotations.push({ type: 'Cheque zone', description: zone });

  const summary = await de.generate();
  test.info().annotations.push({ type: 'Double entry summary', description: JSON.stringify(summary) });
  const total = plan.items.reduce((s, c) => s + c.amount, 0);
  expect.soft(summary.cheques.count, 'Cheques in the summary').toBe(plan.items.length);
  expect.soft(summary.cheques.amount, 'Cheque amount in the summary').toBeCloseTo(total, 2);

  const result = await de.post();
  test.info().annotations.push({ type: 'Double entry posting', description: result.message });
  expect(result.ok, result.message).toBe(true);
}

/**
 * Clearing > Inward Chq Full Treatment: for each cheque open Details, View Mandate for
 * MANDATE_VIEW_SECONDS (default 5), affirm, Honor or Return (with reason), Save.
 */
export async function fullTreat(page: Page, plan: ChequePlan) {
  const screen = await openTreatment(page, 'Full', plan);
  for (const c of plan.items) {
    await test.step(`${c.decision} cheque ${c.serialNo} (${c.role})`, async () => {
      await screen.openDetails(c.serialNo);
      await screen.viewMandate(mandateViewSeconds());
      await screen.affirm();
      let reason = '';
      if (c.decision === 'honour') await screen.honour();
      else reason = await screen.markReturn(process.env.CHEQUE_RETURN_REASON);
      const result = await screen.save();
      test.info().annotations.push({
        type: `Full treatment ${c.serialNo}`,
        description: `${c.decision}${reason ? ` (${reason})` : ''}: ${result.message}`,
      });
      expect(result.ok, result.message).toBe(true);
      expect.soft(result.status, 'Saved status').toBe(c.decision === 'honour' ? 'H' : 'R');
    });
  }
}
