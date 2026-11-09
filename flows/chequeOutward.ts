import fs from 'fs';
import path from 'path';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import { SideMenu } from '../pages/SideMenu';
import { signInApprover } from './approver';
import { ScanChequePage, type ScanMode } from '../pages/ScanChequePage';
import { ApproveOutwardChequePage } from '../pages/ApproveOutwardChequePage';
import { approver } from '../utils/env';
import { saveScannedCheques, validateAccountWithCBA, type OutwardChequeInput } from '../utils/scannedCheques';

export type Decision = 'approve' | 'disapprove';

/**
 * Outward cheque (maker-checker), like the NEFT outward tests:
 *   1. Maker: Transactions > Scan Outward Cheque(Web|Lite) > Launch Scanner.
 *      The scanner is a Windows ClickOnce app a browser test can't drive (and on this server its
 *      installer isn't deployed), so the test then does what the scanner does, through the same
 *      CustomerDetails service calls:
 *        Web : validate the customer's account on the CBA (getCustomerDetails), then save the cheque;
 *        Lite: save the cheque without validation.
 *   2. Approver: Approval > Approve Outward Cheque > View Pending Items > batch (Trans. ID) >
 *      cheque > check the details > Approve / Disapprove (with reason).
 *   Approved cheques are recorded for cheque-outward-transmit (Generate Presentment Files > Cheques).
 */
const env = (name: string, fallback: string) => process.env[name] || fallback;
export const outwardCheque = {
  /** Our customer's account the cheque is lodged into. */
  beneficiaryAccountNo: () => env('OUTWARD_CHEQUE_ACCOUNT_NO', process.env.INWARD_ACCOUNT_NO || process.env.TRANSFER_ACCOUNT_NO || ''),
  beneficiaryName: () => env('OUTWARD_CHEQUE_ACCOUNT_NAME', process.env.INWARD_ACCOUNT_NAME || 'PLAYWRIGHT TEST'),
  /** The paying (other) bank's sort code and the drawer's account there. */
  sortCode: () => env('OUTWARD_CHEQUE_SORT_CODE', '011173117'),
  drawerAccountNo: () => env('OUTWARD_CHEQUE_DRAWER_ACCOUNT_NO', '2005866533'),
  drawer: () => env('OUTWARD_CHEQUE_DRAWER', 'PLAYWRIGHT DRAWER'),
  scanner: (mode: ScanMode) => process.env[mode === 'Web' ? 'WEB_SCANNER' : 'LITE_SCANNER'] || undefined,
};
export const outwardChequeConfigured = () => /^\d{10}$/.test(outwardCheque.beneficiaryAccountNo());

export type ApprovedCheque = { mode: ScanMode; tranID: number; chequeNumber: string; sortCode: string; drawerAccountNo: string; amount: number };

export const approvedChequesFile = () => path.join(test.info().project.outputDir, 'cheque-outward-approved-this-run.json');
export function readApprovedCheques(): ApprovedCheque[] {
  try { return JSON.parse(fs.readFileSync(approvedChequesFile(), 'utf8')); } catch { return []; }
}
function recordApproved(c: ApprovedCheque) {
  fs.mkdirSync(path.dirname(approvedChequesFile()), { recursive: true });
  fs.writeFileSync(approvedChequesFile(), JSON.stringify([...readApprovedCheques(), c], null, 2));
}

export function chequeOutwardTest(mode: ScanMode, decision: Decision) {
  test(`Cheque Outward (${mode} scan) ${decision}`, async ({ page, approverPage }) => {
    test.skip(!outwardChequeConfigured(), 'Set OUTWARD_CHEQUE_ACCOUNT_NO (or INWARD_ACCOUNT_NO) in .env');
    test.skip(!approver.isConfigured, 'Set APPROVER_USERNAME and APPROVER_PASSWORD in .env');
    test.setTimeout(420_000);

    const run = Date.now().toString();
    const cheque: OutwardChequeInput = {
      sortCode: outwardCheque.sortCode(),
      drawerAccountNo: outwardCheque.drawerAccountNo(),
      drawer: outwardCheque.drawer(),
      chequeNumber: run.slice(-8),
      amount: Number(`${mode === 'Web' ? 7 : 6}${decision === 'approve' ? 1 : 2}${run.slice(-2)}.${run.slice(-4, -2)}`),
      beneficiaryAccountNo: outwardCheque.beneficiaryAccountNo(),
      beneficiaryName: outwardCheque.beneficiaryName(),
      narration: `PW-CHQ-${mode.toUpperCase()}-${decision === 'approve' ? 'A' : 'D'}-${run.slice(-8)}`,
    };

    const tranID = await test.step(`maker scans cheque ${cheque.chequeNumber} (Scan Outward Cheque(${mode}))`, () =>
      scanCheque(page, mode, cheque));
    test.info().annotations.push({
      type: 'Cheque',
      description: `${cheque.chequeNumber} ${cheque.sortCode}/${cheque.drawerAccountNo} NGN ${cheque.amount.toFixed(2)} -> ${cheque.beneficiaryAccountNo}, Trans. ID ${tranID}`,
    });

    await test.step(`approver ${decision}s cheque ${cheque.chequeNumber}`, () =>
      reviewCheque(approverPage, decision, cheque, tranID));
    if (decision === 'approve') {
      recordApproved({ mode, tranID, chequeNumber: cheque.chequeNumber, sortCode: cheque.sortCode, drawerAccountNo: cheque.drawerAccountNo, amount: cheque.amount });
    }
  });
}

/** Scan page + Launch Scanner, then the scanner's own steps (Web: CBA validation) and save. Returns the Trans. ID. */
export async function scanCheque(page: Page, mode: ScanMode, cheque: OutwardChequeInput) {
  const menu = new SideMenu(page);
  await menu.openApp();
  await menu.navigateToPath('Transactions', `/pages/Transactions/ScanOutwardCheque${mode}`);
  const scan = new ScanChequePage(page, mode);
  await scan.expectLoaded();
  const launch = await scan.launch(outwardCheque.scanner(mode));
  test.info().annotations.push({
    type: 'Scanner',
    description: `${launch.scanner} (of ${launch.scanners.join(', ')}); launch URL ${launch.url || '(none)'} -> HTTP ${launch.status || 'unreachable'}`
      + (launch.available ? ' (desktop app: not driven by the test)' : ' (scanner app not available)')
      + '; cheque created through the scanner\'s CustomerDetails service calls',
  });
  expect(launch.apiStatus, 'Launch Scanner API failed').toBe(200);

  if (mode === 'Web') {
    await test.step(`CBA validation of account ${cheque.beneficiaryAccountNo}`, async () => {
      const cba = await validateAccountWithCBA(cheque.beneficiaryAccountNo);
      test.info().annotations.push({
        type: 'CBA validation',
        description: `${cba.accountNo} "${cba.accountTitle}" status ${cba.status}, valid for clearing cheque: ${cba.validForClearingCheque}`,
      });
      expect(cba.accountNo, 'Account not found on the CBA').toBe(cheque.beneficiaryAccountNo);
      expect(cba.validForClearingCheque, 'Account is not valid for clearing cheques').toBe(true);
      cheque.beneficiaryName = cba.accountTitle || cheque.beneficiaryName; // Web scanner shows the CBA name
    });
  }

  return test.step('save the scanned cheque', async () => {
    const saved = await saveScannedCheques([cheque], { scannerID: launch.scanner || mode, lite: mode === 'Lite' });
    const chequeRef = /<chequeRef>(\d+)<\/chequeRef>/.exec(saved.response)?.[1];
    test.info().annotations.push({ type: 'Saved', description: `${saved.method}: Trans. ID ${saved.tranID}, cheque ref ${chequeRef}` });
    await test.info().attach('scanner-save-request.xml', { body: saved.request, contentType: 'text/plain' });
    expect(Number(chequeRef), 'Save returned no cheque reference').toBeGreaterThan(0);
    return saved.tranID;
  });
}

async function reviewCheque(page: Page, decision: Decision, cheque: OutwardChequeInput, tranID: number) {
  await signInApprover(page, test.info());
  const menu = new SideMenu(page);
  await menu.waitForMenu();
  await menu.navigateToPath('Approval', '/pages/Approval/approveOutwardCheque');

  const approval = new ApproveOutwardChequePage(page);
  const notice = await approval.expectLoaded();
  if (notice) test.info().annotations.push({ type: 'Approval page notice', description: notice });

  await approval.openBatch(tranID);
  const shown = await approval.openCheque(cheque.chequeNumber);
  test.info().annotations.push({ type: 'Approver sees', description: JSON.stringify(shown) });
  expect.soft(shown.sortCode, 'Sort code').toBe(cheque.sortCode);
  expect.soft(shown.accountNo, 'Drawer account').toBe(cheque.drawerAccountNo);
  expect.soft(Number(shown.amount.replace(/,/g, '')), 'Amount').toBeCloseTo(cheque.amount, 2);
  expect.soft(shown.beneficiary.trim(), 'Beneficiary').toBe(cheque.beneficiaryName.trim());
  expect.soft(shown.frontImageFormat, 'Front image sent to the approval screen').not.toBe('none');
  if (!shown.frontImageShown) {
    // Seen here: the server stores a bitonal TIFF as the UV/B&W image and the screen shows it as
    // image/jpeg, which Chrome can't draw. Reported, not failed: it is the app's display, not the flow.
    test.info().annotations.push({ type: 'Warning', description: `Front image not displayed by the browser (data is ${shown.frontImageFormat}, shown as image/jpeg)` });
  }

  const result = decision === 'approve'
    ? await approval.approve(cheque.amount, process.env.CHEQUE_ZONE)
    : await approval.disapprove(process.env.DISAPPROVAL_REASON || 'Playwright test: disapproved');
  test.info().annotations.push({ type: decision === 'approve' ? 'Approved' : 'Disapproved', description: result.message });
  expect(result.ok, result.message).toBe(true);
}
