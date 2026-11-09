import fs from 'fs';
import path from 'path';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import { SideMenu } from '../pages/SideMenu';
import { NeftTransferPage, type NeftType } from '../pages/NeftTransferPage';
import { PendingTransfersPage } from '../pages/PendingTransfersPage';
import { signInApprover } from './approver';
import { approver, transferData, type TransferData } from '../utils/env';

export type Decision = 'approve' | 'disapprove';

export type ApprovedTransfer = {
  type: NeftType; batchId: string; narration: string; accountNo: string; counterpartyAccountNo: string; amount: string;
};

/**
 * Transfers approved during this run, for the transmission test to look for in the outward file.
 * Kept in the output folder (test-results/), which Playwright empties at the start of every run.
 */
export const approvedFile = () => path.join(test.info().project.outputDir, 'neft-approved-this-run.json');

export function readApproved(): ApprovedTransfer[] {
  try { return JSON.parse(fs.readFileSync(approvedFile(), 'utf8')); } catch { return []; }
}

function recordApproved(t: ApprovedTransfer) {
  fs.mkdirSync(path.dirname(approvedFile()), { recursive: true });
  fs.writeFileSync(approvedFile(), JSON.stringify([...readApproved(), t], null, 2));
}

/**
 * Defines one end-to-end NEFT Outward maker-checker test:
 *   1. Maker (TEST_USERNAME, saved login): Clearing > Transfers(CR|DR) > create one transfer.
 *   2. Approver (APPROVER_USERNAME, own browser session): Approval > Pending Transfers >
 *      Details > check the details > Approve or Disapprove > check it left the pending list.
 */
export function neftOutwardTest(type: NeftType, decision: Decision) {
  const title = `NEFT Outward ${type} ${decision}`;

  test(title, async ({ page, approverPage }) => {
    test.skip(!transferData.isConfigured, 'Set TRANSFER_ACCOUNT_NO and BENEFICIARY_ACCOUNT_NO in .env');
    test.skip(!approver.isConfigured, 'Set APPROVER_USERNAME and APPROVER_PASSWORD in .env');
    test.setTimeout(300_000); // two logins + slow page loads

    const data = type === 'CR' ? transferData.cr : transferData.dr;
    // e.g. PW-CR-A-12345678 (approve) / PW-DR-D-12345678 (disapprove)
    const narration = `PW-${type}-${decision === 'approve' ? 'A' : 'D'}-${Date.now().toString().slice(-8)}`;

    const batchId = await test.step(`maker creates Transfer(${type}) ${narration}`, () =>
      createTransfer(page, type, data, narration));
    test.info().annotations.push({ type: 'Batch ID', description: `${type} ${batchId} (${narration})` });

    await test.step(`approver ${decision}s batch ${batchId}`, () =>
      reviewTransfer(approverPage, type, decision, data, narration, batchId));
  });
}

async function createTransfer(page: Page, type: NeftType, data: TransferData, narration: string) {
  const menu = new SideMenu(page);
  await menu.openApp();
  await menu.navigate('Clearing', `Transfers(${type})`);
  await expect(page).toHaveURL(type === 'CR' ? /TransfersCR/ : /TransfersDB/);

  const form = new NeftTransferPage(page, type);
  await form.expectLoaded();
  return form.create(data, narration);
}

async function reviewTransfer(
  page: Page, type: NeftType, decision: Decision, data: TransferData, narration: string, batchId: string,
) {
  await signInApprover(page, test.info());
  const menu = new SideMenu(page);
  await menu.waitForMenu();
  await menu.navigate('Approval', 'Pending Transfers');
  await expect(page).toHaveURL(/NeftOutwardPending/);

  const pending = new PendingTransfersPage(page);
  await pending.expectLoaded();

  // Details: check what the approver sees before acting. Values come back padded with spaces.
  await pending.openDetails(narration);
  await expect(pending.detailsModal).toContainText(`Batch ID: ${batchId}`);
  await expect(pending.detailsModal).toContainText(type === 'CR' ? 'NEFT CREDIT' : 'NEFT DEBIT');
  await expect(pending.detailsAccountNo).toHaveValue(new RegExp(`^\\s*${data.accountNo}\\s*$`));
  await expect(pending.detailsNarration).toHaveValue(new RegExp(`^\\s*${narration}\\s*$`));
  await expect(pending.detailsRows).toHaveCount(1);
  await expect(pending.detailsRows.first()).toContainText(data.counterpartyAccountNo);

  const result = decision === 'approve'
    ? await pending.approve()
    : await pending.disapprove(process.env.DISAPPROVAL_REASON);
  test.info().annotations.push({
    type: decision === 'approve' ? 'Approved' : 'Disapproved',
    description: `${type} batch ${batchId}: ${result.header} - ${result.message}`,
  });
  expect(result.header, result.message)
    .toMatch(decision === 'approve' ? /Approved Succes/i : /Disapproved Succes/i);
  if (decision === 'approve') {
    recordApproved({ type, batchId, narration, accountNo: data.accountNo, counterpartyAccountNo: data.counterpartyAccountNo, amount: data.amount });
  }

  // It must leave the pending list.
  await pending.filter.fill(narration);
  await expect(pending.rowFor(narration)).toHaveCount(0, { timeout: 30_000 });
}
