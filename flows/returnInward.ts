import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import { SideMenu } from '../pages/SideMenu';
import { TreatReturnInwardPage } from '../pages/TreatReturnInwardPage';
import { isoLocal, windowLabel, type InwardFile, type ReturnedItem } from '../utils/inwardFiles';
import { inwardBankCode } from '../utils/env';
import { query } from '../utils/db';
import { receiveInward } from './neftInward';

/**
 * Treat Return Inward (cheque and NEFT): other banks return items WE presented, in an "irf" file
 * read by the same InwardFilesService as the inward files.
 *   1. Pick outward items we have transmitted and not had returned yet (iTeller database, read-only):
 *        cheque: ChequeDump (approved, processed) + chq_bene; NEFT: neftdump (NGN, TranCode 20/21).
 *      The app matches a return to them on serial no. + sort code + account no. + tran code.
 *   2. Write IRFData_<bank>_<ddmmyyyy>_<HHMM>_<msgId>.XML (own settlement time) into the inward folder;
 *      the service reads it ("N Returned Transaction(s) valued at ...") and archives it.
 *   3. Clearing > Treat Return Inward: that settlement time, Cheque|Neft, Load Data, Generate CSV/POST.
 */
export type ReturnKind = 'cheque' | 'neft';

export const returnReason = () => process.env.RETURN_INWARD_REASON || '02'; // 02 = Account Closed

/** Most recent transmitted items of this kind that no return file has returned yet. */
export function findReturnableItems(kind: ReturnKind, count: number): ReturnedItem[] {
  const notReturned = (alias: string, serial: string) =>
    `NOT EXISTS (SELECT 1 FROM ReturnFileDetailsFromECPIX r WHERE r.SerialNumber = ${alias}.${serial}
       AND r.PayBankRoutNo = ${alias}.SortCode AND r.AccountNumber = ${alias}.AccNumber AND r.TransactionCode = ${alias}.TranType)`;
  const rows = kind === 'cheque'
    ? query(`SELECT TOP ${count} c.ChequeNumber, c.SortCode, RTRIM(c.AccNumber) AccNumber, c.TranType, c.Amount,
          c.PresentingBankSortcode, CONVERT(varchar(10), ISNULL(c.CaptureFileDate, c.scandate), 120) PresentmentDate,
          'DB' InstrumentType, c.ExpiryDate, c.CheckDigit
        FROM ChequeDump c JOIN chq_bene cb ON cb.cheque_ref = c.idfield
        WHERE c.approved = 2 AND c.Processed = 1 AND c.TranType NOT IN ('20','21') AND ${notReturned('c', 'ChequeNumber')}
          AND c.idfield = (SELECT MAX(idfield) FROM ChequeDump d WHERE d.ChequeNumber = c.ChequeNumber AND d.SortCode = c.SortCode
                           AND d.AccNumber = c.AccNumber AND d.TranType = c.TranType)
        ORDER BY c.idfield DESC`)
    : query(`SELECT TOP ${count} n.ChequeNumber, n.SortCode, RTRIM(n.AccNumber) AccNumber, n.TranType, n.Amount,
          n.PresentingBankSortcode, CONVERT(varchar(10), ISNULL(n.CaptureFileDate, n.scandate), 120) PresentmentDate,
          RTRIM(n.InstrumentType) InstrumentType, '' ExpiryDate, '' CheckDigit
        FROM neftdump n JOIN Currency cur ON cur.Code = n.currencyCode
        WHERE cur.Abbrev = 'NGN' AND n.approved = 2 AND n.Processed = 1 AND n.TranType IN ('20','21') AND ${notReturned('n', 'ChequeNumber')}
        ORDER BY n.idfield DESC`);
  return rows.map((r, i) => ({
    serialNo: r.ChequeNumber,
    sortCode: r.SortCode,
    accountNo: r.AccNumber,
    tranCode: r.TranType,
    amount: Number(r.Amount),
    presentingBankSortCode: r.PresentingBankSortcode,
    presentmentDate: new Date(`${r.PresentmentDate}T00:00:00`),
    returnReason: returnReason(),
    instrumentType: r.InstrumentType || 'DB',
    itemSequenceNo: `7${String(Date.now()).slice(-8)}${i + 1}`,
    expiryDate: r.ExpiryDate,
    checkDigit: r.CheckDigit,
  }));
}

export type ReturnPlan = { kind: ReturnKind; file: InwardFile; window: string; settlement: { date: string; time: string }; items: ReturnedItem[] };

/** One return file on its own settlement time (today, current minute). */
export function planReturnInward(kind: ReturnKind, items: ReturnedItem[]): ReturnPlan {
  const settlement = new Date();
  settlement.setSeconds(0, 0);
  const [date, time] = isoLocal(settlement).split('T');
  return {
    kind,
    items,
    window: windowLabel(settlement),
    settlement: { date, time: time.slice(0, 5) },
    file: { kind: 'return', bankCode: inwardBankCode(), msgId: `7${String(Date.now()).slice(-7)}`, settlement, sortCode: '', items: [], returns: items },
  };
}

/** The InwardFilesService reads the IRF file (same checks as the inward files). */
export const receiveReturnFile = (plan: ReturnPlan) => receiveInward(plan);

/** Clearing > Treat Return Inward: settlement time, type, Load Data, check the items, Generate CSV/POST. */
export async function treatReturnInward(page: Page, plan: ReturnPlan) {
  const menu = new SideMenu(page);
  await menu.openApp();
  await menu.navigateToPath('Clearing', '/pages/Clearing/returnInward');
  const screen = new TreatReturnInwardPage(page);
  await screen.expectLoaded();

  await test.step(`select return settlement ${plan.window} (${plan.kind === 'cheque' ? 'Cheque' : 'Neft'})`, async () => {
    await screen.selectSession(plan.settlement);
    await screen.selectType(plan.kind === 'cheque' ? 'Cheque' : 'Neft');
  });

  const loaded = await test.step('Load Data', async () => {
    const data = await screen.loadData();
    test.info().annotations.push({ type: 'Loaded', description: `${data.items.length} returned item(s)` });
    await test.info().attach('return-inward-items.json', { body: JSON.stringify(data.items, null, 2), contentType: 'application/json' });
    for (const item of plan.items) {
      const hit = data.items.find((r) => String(r.SerialNumber).trim() === item.serialNo && String(r.PayBankRoutNo).trim() === item.sortCode);
      expect(hit, `Returned ${plan.kind} ${item.serialNo} (${item.sortCode}/${item.accountNo}) not loaded: `
        + 'not matched to an outward item, or already posted').toBeTruthy();
      expect.soft(Number(hit!.ItemAmount), `Amount of ${item.serialNo}`).toBeCloseTo(item.amount, 2);
      expect.soft(String(hit!.ReturnReason).trim(), `Return reason of ${item.serialNo}`).toBe(item.returnReason);
      await expect.soft(screen.row(hit!.RecordId), `Row for ${item.serialNo}`).toBeVisible();
      test.info().annotations.push({
        type: `Return ${item.serialNo}`,
        description: `record ${hit!.RecordId}: NGN ${item.amount.toFixed(2)}, reason ${hit!.reasonDescription ?? item.returnReason}, `
          + `credited back to ${hit!.acct_no ?? '?'} (${hit!.beneficiary ?? ''})`,
      });
    }
    return data;
  });

  await test.step('Generate CSV/POST', async () => {
    const others = loaded.items.length - plan.items.length;
    if (others > 0) test.info().annotations.push({ type: 'Note', description: `${others} other returned item(s) in this settlement are posted too` });
    const result = await screen.generateAndPost();
    test.info().annotations.push({ type: 'Generate/Post result', description: result.message });
    expect(result.ok, result.message).toBe(true);
  });
}
