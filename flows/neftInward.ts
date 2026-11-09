import fs from 'fs';
import path from 'path';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import { SideMenu } from '../pages/SideMenu';
import { NeftInwardPage, type MatchType } from '../pages/NeftInwardPage';
import {
  dropInwardFile, findArchived, inwardArchiveDir, inwardDir, inwardFileName, windowLabel, type InwardFile,
} from '../utils/inwardFiles';
import { followLog } from '../utils/logFollower';
import { inwardBankCode, inwardSortCode } from '../utils/env';

/** Shared steps of the NEFT inward tests (posting and return). */
export const inwardAccount = () => process.env.INWARD_ACCOUNT_NO || process.env.TRANSFER_ACCOUNT_NO || '';
export const inwardAccountName = () => process.env.INWARD_ACCOUNT_NAME || '';
export const inwardConfigured = () => !!inwardAccount() && !!inwardAccountName();
export const inwardPickupWaitSeconds = () => Number(process.env.INWARD_PICKUP_WAIT_SECONDS ?? 420);

export type PlannedItem = { role: string; expected: MatchType; seq: string; beneficiary: string; amount: number };
export type InwardPlan = { file: InwardFile; window: string; items: PlannedItem[] };

/**
 * One inward file with the given items (all NEFT credits to INWARD_ACCOUNT_NO), on its own
 * settlement time (today, current minute) so the test's items are kept apart from others.
 * Beneficiary names: perfect = the account's name, partial = its first name + another word,
 * none = unrelated name.
 */
export function planInward(tag: string, items: { role: string; expected: MatchType; amount: number }[]): InwardPlan {
  const settlement = new Date();
  settlement.setSeconds(0, 0);
  const run = String(Date.now()).slice(-7);
  const name = inwardAccountName();
  const first = name.trim().split(/\s+/)[0].toUpperCase();
  const beneficiary = (m: MatchType) =>
    m === 'perfect' ? name.toUpperCase() : m === 'partial' ? `${first} PLAYWRIGHT` : 'ZZQX NOMATCH TESTER';
  const planned = items.map((p, i) => ({ ...p, beneficiary: beneficiary(p.expected), seq: `9${run}${i + 1}` }));
  return {
    window: windowLabel(settlement),
    items: planned,
    file: {
      bankCode: inwardBankCode(),
      msgId: `9${run}`,
      settlement,
      sortCode: inwardSortCode(),
      items: planned.map((p, i) => ({
        accountNo: inwardAccount(),
        beneficiary: p.beneficiary,
        amount: p.amount,
        narration: `PW-${tag}-${run}-${i + 1}`,
        itemSequenceNo: p.seq,
        serialNo: `00${run}${i + 1}`,
      })),
    },
  };
}

/** InwardFilesService log, e.g. "3 New Inward Transaction(s) valued at 3,006.66 Successfully read from File:IPFData_....XML"
 * (return files: "1 Returned Transaction(s) valued at ... File:IRFData_....XML"). */
const inwardServiceLog = () =>
  path.join(process.env.INWARD_SERVICE_DIR || 'C:/Program Files (x86)/PFS/InwardFilesService', 'Event_Log.txt');

/**
 * Receive: write the inward file; the InwardFilesService (every 3 min) reads it, logs it in its
 * Event_Log.txt and archives it. Checks the service's log line for this file (item count, value)
 * and reports any errors it logged meanwhile.
 */
export async function receiveInward(plan: { file: InwardFile; window: string; items: { amount: number }[] }) {
  const wait = inwardPickupWaitSeconds();
  test.setTimeout(wait * 1000 + 120_000);
  const fileName = inwardFileName(plan.file);
  const serviceLog = followLog(inwardServiceLog());
  try {
    const written = dropInwardFile(plan.file);
    test.info().annotations.push({ type: 'Inward file', description: `${written} (window ${plan.window}, MsgID ${plan.file.msgId})` });
    await test.info().attach('inward-file.xml', {
      body: fs.readFileSync(written, 'utf8').replace(/(<(FrontImage|RearImage|FrontImageGray)>)[^<]*(<\/\2>)/g, '$1[image removed]$3'),
      contentType: 'text/plain',
    });

    await test.step(`InwardFilesService picks up ${fileName} (within ${wait}s)`, async () => {
      await expect.poll(() => fs.existsSync(written), {
        message: `${fileName} still in ${inwardDir()} after ${wait}s: is the InwardFilesService running and watching this folder?`,
        timeout: wait * 1000, intervals: [10_000],
      }).toBe(false);
      const archived = findArchived(fileName);
      test.info().annotations.push({ type: 'Archived as', description: archived ?? `(not found in ${inwardArchiveDir()})` });
    });

    await test.step('InwardFilesService log: file read successfully', async () => {
      const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // e.g. "3 New Inward Transaction(s) valued at 3,006.66 Successfully read from File:<name>"
      const readLine = new RegExp(`^.*?(\\d+) (?:New Inward|Returned)[^\\n]*?valued at ([\\d,.]+)[^\\n]*?${escaped}.*$`, 'mi');
      let match: RegExpExecArray | null = null;
      await expect.poll(() => (match = readLine.exec(serviceLog.text())) !== null, {
        message: `No "... Successfully read from File:${fileName}" in ${inwardServiceLog()}`,
        timeout: 60_000, intervals: [3_000],
      }).toBe(true);
      const [line, count, value] = match!;
      test.info().annotations.push({ type: 'Inward service', description: line.trim() });
      const total = plan.items.reduce((s, p) => s + p.amount, 0);
      expect.soft(Number(count), 'Items read by the service').toBe(plan.items.length);
      expect.soft(Number(value.replace(/,/g, '')), 'Value read by the service').toBeCloseTo(total, 2);
    });
  } finally {
    const text = serviceLog.stop();
    const errors = text.split(/\r?\n/).filter((l) => /error|fail|exception/i.test(l));
    if (errors.length) test.info().annotations.push({ type: 'Inward service errors', description: errors.join(' | ') });
    await test.info().attach('inward-files-service.log', { body: text || '(nothing logged)', contentType: 'text/plain' });
  }
}

/** Clearing > NEFT Inward > Settlement Window > (plan's window) > Load Items; checks the match colours. */
export async function openInwardItems(page: Page, plan: InwardPlan) {
  const menu = new SideMenu(page);
  await menu.openApp();
  await menu.navigate('Clearing', 'NEFT Inward');
  await expect(page).toHaveURL(/Clearing\/neftInward/);

  const inward = new NeftInwardPage(page);
  await inward.expectLoaded();
  await inward.loadWindow(plan.window, { msgId: plan.file.msgId, itemCount: plan.items.length });

  await test.step('items arrive with the expected match colours', async () => {
    for (const p of plan.items) {
      const row = inward.row(p.seq);
      await expect(row, `${p.role} item ${p.seq} not loaded`).toHaveCount(1, { timeout: 30_000 });
      expect.soft(await inward.match(row), `${p.role}: beneficiary "${p.beneficiary}" vs account name "${inwardAccountName()}"`)
        .toBe(p.expected);
    }
  });
  return inward;
}

/** Commit, record the result, fail on an error toast. */
export async function commitInward(inward: NeftInwardPage) {
  await test.step('commit', async () => {
    const result = await inward.commit();
    test.info().annotations.push({ type: 'Commit result', description: result.message });
    expect(result.ok, result.message).toBe(true);
  });
}
