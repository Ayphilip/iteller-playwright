import { loadChequeImages } from './inwardFiles';
import { sessionValue } from './env';

/**
 * Stand-in for the cheque scanner (a Windows ClickOnce app launched from Transactions >
 * Scan Outward Cheque (Web / Lite), which a browser test cannot drive). It calls the same
 * CustomerDetails SOAP methods the scanner calls:
 *   Web : getCustomerDetails(beneficiary account) -> CBA validation, then saveScannedChequesUV
 *   Lite: saveScannedChequesUV straight away (no validation)
 * The cheque then waits in Approvals > Approve Outward Cheque like a scanned one.
 */
export const customerDetailsUrl = () => process.env.CUSTOMER_DETAILS_URL
  || 'http://localhost/CustomerDetailsservicechEnterprise/DepotelCustomerDetails.asmx';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pad = (n: number) => String(n).padStart(2, '0');
const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

export async function soap(method: string, body: string) {
  const envelope = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"`
    + ` xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">`
    + `<soap:Body><${method} xmlns="http://tempuri.org/">${body}</${method}></soap:Body></soap:Envelope>`;
  const res = await fetch(customerDetailsUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"http://tempuri.org/${method}"` },
    body: envelope,
  });
  const text = await res.text();
  const fault = /<faultstring>([\s\S]*?)<\/faultstring>/.exec(text)?.[1];
  if (!res.ok || fault) throw new Error(`${method} failed (${res.status}): ${fault ?? text.slice(0, 500)}`);
  return text;
}

const tag = (xml: string, name: string) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1] ?? '';

/** CBA lookup the Web scanner does for the account being credited. */
export async function validateAccountWithCBA(accountNo: string) {
  const xml = await soap('getCustomerDetails', `<accountNumber>${esc(accountNo)}</accountNumber>`);
  return {
    accountNo: tag(xml, 'accountNumber'),
    accountTitle: tag(xml, 'accountTitle'),
    status: tag(xml, 'accountStatus'),
    validForClearingCheque: tag(xml, 'validForClearingCheque') === 'true',
    xml: xml.replace(/<signature>[\s\S]*?<\/signature>/, ''),
  };
}

export type OutwardChequeInput = {
  /** Paying (drawee) bank's sort code and the drawer's account there. */
  sortCode: string; drawerAccountNo: string; drawer: string;
  chequeNumber: string; amount: number;
  /** Our customer's account being credited. */
  beneficiaryAccountNo: string; beneficiaryName: string;
  narration: string; depositor?: string; phoneNo?: string; tranCode?: string; checkDigit?: string;
};

export type SavedOutwardCheque = { tranID: number; scannerID: string; method: string; request: string; response: string };

/** getTranID + saveScannedChequesUV: one deposit (tranID) with the given cheques. */
export async function saveScannedCheques(cheques: OutwardChequeInput[], opts: { scannerID: string; lite: boolean }) {
  const tranID = Number(tag(await soap('getTranID', ''), 'getTranIDResult'));
  if (!tranID) throw new Error('getTranID returned no transaction id');
  const images = loadChequeImages();
  const now = new Date();
  const expiry = new Date(now.getFullYear(), now.getMonth() + 6, now.getDate());
  const expiryText = `${pad(expiry.getDate())}${pad(expiry.getMonth() + 1)}${expiry.getFullYear()}`;
  const first = cheques[0];
  // B/W TIFFs go to chequeImageBW, which Generate Presentment Files requires (it joins on it).
  // SCANNER_BW_IMAGES=false leaves them out: only for a database with stale chequeImageBW rows at the
  // next cheque_ref, where the clash fails the save half-way ("...scanned today").
  const bw = process.env.SCANNER_BW_IMAGES !== 'false';
  const details = cheques.map((c) => `<chequeDetails>
<ISOCurrencyCode>566</ISOCurrencyCode>
<accountNumber>${esc(c.drawerAccountNo)}</accountNumber>
<amount>${c.amount.toFixed(2)}</amount>
<beneficiary>${esc(c.beneficiaryName)}</beneficiary>
<cautionReasons />
<chequeDate>${isoLocal(now)}</chequeDate>
<chequeNumber>${esc(c.chequeNumber)}</chequeNumber>
<chequeRef>0</chequeRef>
<chequetype>${c.tranCode ?? '02'}</chequetype>
<frontGrayTIFF>${images.frontGray}</frontGrayTIFF>
<frontImage>${images.front}</frontImage>
<frontImageBWTIFF>${bw ? images.front : ''}</frontImageBWTIFF>
<frontImageUV>${images.front}</frontImageUV>
<rearImage>${images.rear}</rearImage>
<rearImageBWTIFF>${bw ? images.rear : ''}</rearImageBWTIFF>
<rearImageUV>${images.rear}</rearImageUV>
<scannerID>${esc(opts.scannerID)}</scannerID>
<sortCode>${esc(c.sortCode)}</sortCode>
<tranCode>${c.tranCode ?? '02'}</tranCode>
<valueDate>${isoLocal(now)}</valueDate>
<narration>${esc(c.narration)}</narration>
<floatDays>0</floatDays>
<Drawer>${esc(c.drawer)}</Drawer>
<BVN>00000000000</BVN>
<MICRRepair>0000000</MICRRepair>
<expiryDate>${expiryText}</expiryDate>
<checkDigit>${c.checkDigit ?? '28'}</checkDigit>
</chequeDetails>`).join('');
  const body = `<tranID>${tranID}</tranID><transDetails>${details}</transDetails>`
    + `<_presentingBankSortCode>${esc(sessionValue('SortCode') ?? '')}</_presentingBankSortCode>`
    + `<beneficiaryAccountNo>${esc(first.beneficiaryAccountNo)}</beneficiaryAccountNo>`
    + `<accountTitle>${esc(first.beneficiaryName)}</accountTitle>`
    + `<_servicePoint>${esc(sessionValue('BranchCode') ?? '')}</_servicePoint>`
    + `<_autoApprove>false</_autoApprove>`
    + `<_userID>${esc(sessionValue('UserId') ?? process.env.TEST_USERNAME ?? '')}</_userID>`
    + `<Depositor>${esc(first.depositor ?? first.beneficiaryName)}</Depositor>`
    + `<PhoneNo>${esc(first.phoneNo ?? '08000000000')}</PhoneNo>`
    + `<currencycode>566</currencycode>`;
  // The UV scanners call saveScannedChequesUV, others saveScannedCheques (SCANNER_SAVE_METHOD=uv|standard).
  // Don't fall back from one to the other: a failed UV save may already have stored part of the
  // batch, and the retry is then refused as "scanned today".
  const method = (process.env.SCANNER_SAVE_METHOD ?? 'standard').toLowerCase() === 'uv'
    ? 'saveScannedChequesUV' : 'saveScannedCheques';
  const response = await soap(method, method === 'saveScannedCheques' ? `${body}<BVN>00000000000</BVN>` : body);
  const request = body.replace(/(<(front|rear)[A-Za-z]*>)[^<]{100,}/g, '$1[image]');
  return { tranID, scannerID: opts.scannerID, method, request, response: response.replace(/>[A-Za-z0-9+/=]{200,}</g, '>[image]<') } as SavedOutwardCheque;
}
