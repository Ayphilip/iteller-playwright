import fs from 'fs';
import path from 'path';

/**
 * NEFT inward files (IPFData_<bank>_<ddmmyyyy>_<HHMM>_<msgId>_NGN.XML), as received from the clearing
 * house. The InwardFilesService Windows service (C:\Program Files (x86)\PFS\InwardFilesService) checks
 * its FilePath every 3 minutes, loads new "ipf" files through CustomerDetails (EventLog4NI) and moves
 * them to FileArchivePath.
 *
 * Folder: INWARD_FILE_DIR, else the service's configured FilePath, else E:\MyInward.
 */
const SERVICE_CONFIG = () => path.join(
  process.env.INWARD_SERVICE_DIR || 'C:/Program Files (x86)/PFS/InwardFilesService', 'InwardFilesService.exe.config');

function serviceSetting(name: string): string | undefined {
  try {
    const xml = fs.readFileSync(SERVICE_CONFIG(), 'utf8');
    return new RegExp(`<setting name="${name}"[^>]*>\\s*<value>([^<]*)</value>`).exec(xml)?.[1]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export const inwardDir = () => process.env.INWARD_FILE_DIR || serviceSetting('FilePath') || 'E:/MyInward';
export const inwardArchiveDir = () => serviceSetting('FileArchivePath') || path.join(inwardDir(), 'Archive');

export type InwardItem = {
  accountNo: string;
  beneficiary: string;
  amount: number;
  narration: string;
  itemSequenceNo: string;
  serialNo: string;
};

/** An item we presented (cheque or NEFT) that the other bank sends back in a return (IRF) file. */
export type ReturnedItem = {
  serialNo: string; sortCode: string; accountNo: string; tranCode: string; amount: number;
  presentingBankSortCode: string; presentmentDate: Date; returnReason: string;
  instrumentType: string; itemSequenceNo: string; expiryDate?: string; checkDigit?: string;
};

export type InwardFile = {
  /**
   * neft (default): NEFT credits, TranCode 20, no images. cheque: cheques drawn on our customers, with images.
   * return: our outward items returned by other banks (IRFData_..., <RFData>; uses `returns`, not `items`).
   */
  kind?: 'neft' | 'cheque' | 'return';
  returns?: ReturnedItem[];
  bankCode: string;
  msgId: string;
  settlement: Date; // settlement window (date + time)
  sortCode: string; // receiving branch sort code of the items
  items: InwardItem[];
};

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
/** 2026-11-06T09:37:00 (local, no zone, like the clearing files) */
export const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
/** "2026-11-06 09:37:00": how the app lists settlement windows */
export const windowLabel = (d: Date) => isoLocal(d).replace('T', ' ');

export function inwardFileName(f: InwardFile) {
  const d = f.settlement;
  // The service tells files apart by name: "irf" (ReturnIndicator) = returns, "ipf" = new inward items.
  if (f.kind === 'return') return `IRFData_${f.bankCode}_${pad(d.getDate())}${pad(d.getMonth() + 1)}${d.getFullYear()}_${pad(d.getHours())}${pad(d.getMinutes())}_${f.msgId}.XML`;
  return `IPFData_${f.bankCode}_${pad(d.getDate())}${pad(d.getMonth() + 1)}${d.getFullYear()}_${pad(d.getHours())}${pad(d.getMinutes())}_${f.msgId}${f.kind === 'cheque' ? '' : '_NGN'}.XML`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Same layout as the files in the inward Archive folder (NEFT credit, TranCode 20, no images). */
export function buildInwardXml(f: InwardFile): string {
  if (f.kind === 'return') return buildReturnXml(f);
  if (f.kind === 'cheque') return buildChequeInwardXml(f);
  const settlement = isoLocal(f.settlement);
  const day = `${isoLocal(f.settlement).slice(0, 10)}T00:00:00`;
  const total = f.items.reduce((s, i) => s + i.amount, 0);
  const item = (i: InwardItem) => `    <PFItemData>
      <ItemSequenceNo>${i.itemSequenceNo}</ItemSequenceNo>
      <SerialNo>${i.serialNo}</SerialNo>
      <SortCode>${f.sortCode}</SortCode>
      <AccountNo>${i.accountNo}</AccountNo>
      <TranCode>20</TranCode>
      <Amount>${i.amount.toFixed(4)}</Amount>
      <Currency>NGN</Currency>
      <PresentingBankSortCode>057990000</PresentingBankSortCode>
      <PresentmentDate>${day}</PresentmentDate>
      <PayerName>PLAYWRIGHT TEST PAYER</PayerName>
      <PayerAccountNo />
      <Beneficiary>${esc(i.beneficiary)}</Beneficiary>
      <BeneficiaryAccountNo />
      <BankOfFirstDepositSortCode>057990000</BankOfFirstDepositSortCode>
      <BankOfFirstDepositDate>${day}</BankOfFirstDepositDate>
      <CollectionType>71</CollectionType>
      <Images />
      <InstrumentType>CR</InstrumentType>
      <Narration>${esc(i.narration)}</Narration>
      <CycleNo>01</CycleNo>
      <ExpressClearing>false</ExpressClearing>
      <SpecialClearing>false</SpecialClearing>
      <BVNBeneficiary />
      <BVNPayer />
      <InstrumentDate>${settlement}</InstrumentDate>
      <UDField1 />
      <UDField2 />
      <UDField3 />
      <UDField4 />
      <UDField5 />
      <ChannelID />
      <MICRRepairInd />
      <CashValueInd>1</CashValueInd>
      <SettlementTime>${settlement}</SettlementTime>
    </PFItemData>`;
  return `<?xml version="1.0"?>
<PFData xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <BankCode>${f.bankCode}</BankCode>
  <MsgID>${f.msgId}</MsgID>
  <ItemCount>${f.items.length}</ItemCount>
  <TotalValue>${total.toFixed(4)}</TotalValue>
  <SettlementTime>${settlement}</SettlementTime>
  <Date>${settlement}</Date>
  <Item>
${f.items.map(item).join('\n')}
  </Item>
</PFData>
`;
}

/** Writes via a temp name and renames, so the service never reads a half-written file. */
export function dropInwardFile(f: InwardFile): string {
  const dir = inwardDir();
  const target = path.join(dir, inwardFileName(f));
  const tmp = `${target}.writing`;
  fs.writeFileSync(tmp, buildInwardXml(f));
  fs.renameSync(tmp, target);
  return target;
}

/** Archived copy of a picked-up file (the service may prefix it, e.g. "Processed"). */
export function findArchived(fileName: string): string | undefined {
  try {
    const dir = inwardArchiveDir();
    const hit = fs.readdirSync(dir).find((f) => f.toLowerCase().includes(fileName.toLowerCase()));
    return hit && path.join(dir, hit);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------------------------
// Cheque inward items (TranCode 02, InstrumentType DB, CollectionType 72, with images)
// ---------------------------------------------------------------------------------------------

export type ChequeImages = { front: string; rear: string; frontGray: string; source: string };

/**
 * Cheque images (base64 TIFF) taken from a real archived cheque inward file, so the test cheques
 * display like received ones. INWARD_CHEQUE_SAMPLE = a specific file; otherwise the newest file
 * with a <FrontImage> in the inward Archive folders.
 */
export function loadChequeImages(): ChequeImages {
  const explicit = process.env.INWARD_CHEQUE_SAMPLE;
  const candidates = explicit ? [explicit] : [inwardArchiveDir(), 'E:/MyInward/Archive', 'C:/MyInward/Archive']
    .flatMap((dir) => { try { return fs.readdirSync(dir).map((f) => path.join(dir, f)); } catch { return []; } })
    .filter((f) => /^IPFData_.*\.xml/i.test(path.basename(f)))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  for (const file of candidates) {
    let xml = '';
    try { xml = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const img = (tag: string) => new RegExp(`<${tag}>([^<]{100,})</${tag}>`).exec(xml)?.[1];
    const front = img('FrontImage');
    if (front) return { front, rear: img('RearImage') ?? front, frontGray: img('FrontImageGray') ?? front, source: file };
  }
  throw new Error('No archived cheque inward file with images found: set INWARD_CHEQUE_SAMPLE to one in .env');
}

export type ChequeItem = InwardItem & { tranCode?: string; payerAccountNo?: string };

function buildChequeInwardXml(f: InwardFile): string {
  const images = loadChequeImages();
  const settlement = isoLocal(f.settlement);
  const day = `${settlement.slice(0, 10)}T00:00:00`;
  const total = f.items.reduce((s, i) => s + i.amount, 0);
  const expiry = new Date(f.settlement.getFullYear() + 1, f.settlement.getMonth(), f.settlement.getDate());
  const expiryText = `${pad(expiry.getDate())}${pad(expiry.getMonth() + 1)}${expiry.getFullYear()}`;
  const item = (i: ChequeItem) => `    <PFItemData>
      <ItemSequenceNo>${i.itemSequenceNo}</ItemSequenceNo>
      <SerialNo>${i.serialNo}</SerialNo>
      <SortCode>${f.sortCode}</SortCode>
      <AccountNo>${i.accountNo}</AccountNo>
      <TranCode>${i.tranCode ?? '02'}</TranCode>
      <Amount>${i.amount.toFixed(4)}</Amount>
      <Currency>NGN</Currency>
      <PresentingBankSortCode>057150000</PresentingBankSortCode>
      <PresentmentDate>${day}</PresentmentDate>
      <PayerAccountNo>${i.payerAccountNo ?? ''}</PayerAccountNo>
      <Beneficiary>${esc(i.beneficiary)}</Beneficiary>
      <BeneficiaryAccountNo />
      <BankOfFirstDepositSortCode>057150000</BankOfFirstDepositSortCode>
      <BankOfFirstDepositDate>${day}</BankOfFirstDepositDate>
      <CollectionType>72</CollectionType>
      <Images>
        <FrontImage>${images.front}</FrontImage>
        <RearImage>${images.rear}</RearImage>
        <FrontImageGray>${images.frontGray}</FrontImageGray>
      </Images>
      <CautionNotices />
      <InstrumentType>DB</InstrumentType>
      <Narration>${esc(i.narration)}</Narration>
      <CycleNo>01</CycleNo>
      <ExpressClearing>false</ExpressClearing>
      <SpecialClearing>false</SpecialClearing>
      <BVNBeneficiary>0</BVNBeneficiary>
      <BVNPayer>0</BVNPayer>
      <InstrumentDate>${day}</InstrumentDate>
      <UDField1 />
      <UDField2 />
      <UDField3 />
      <UDField4 />
      <UDField5 />
      <ChannelID />
      <MICRRepairInd />
      <CashValueInd />
      <SettlementTime>${settlement}</SettlementTime>
      <ExpiryDate>${expiryText}</ExpiryDate>
      <CheckDigit>186</CheckDigit>
      <QRCode />
    </PFItemData>`;
  return `<?xml version="1.0"?>
<PFData xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <BankCode>${f.bankCode}</BankCode>
  <MsgID>${f.msgId}</MsgID>
  <ItemCount>${f.items.length}</ItemCount>
  <TotalValue>${total.toFixed(4)}</TotalValue>
  <SettlementTime>${settlement}</SettlementTime>
  <Date>${settlement}</Date>
  <Item>
${(f.items as ChequeItem[]).map(item).join('\n')}
  </Item>
</PFData>
`;
}

// ---------------------------------------------------------------------------------------------
// Return (IRF) files: RFData, same layout as the ORFData files we send (read into
// ReturnInwardFileFromECPIX / ReturnFileDetailsFromECPIX; log "N Returned Transaction(s) valued at ...").
// ---------------------------------------------------------------------------------------------

function buildReturnXml(f: InwardFile): string {
  const returns = f.returns ?? [];
  const settlement = isoLocal(f.settlement);
  const total = returns.reduce((s, i) => s + i.amount, 0);
  const day = (d: Date) => `${isoLocal(d).slice(0, 10)}T00:00:00`;
  const item = (r: ReturnedItem) => `    <RFItemData>
      <ItemSequenceNo>${esc(r.itemSequenceNo)}</ItemSequenceNo>
      <SerialNo>${esc(r.serialNo)}</SerialNo>
      <SortCode>${esc(r.sortCode)}</SortCode>
      <AccountNo>${esc(r.accountNo)}</AccountNo>
      <TranCode>${esc(r.tranCode)}</TranCode>
      <Amount>${r.amount.toFixed(2)}</Amount>
      <Currency>NGN</Currency>
      <PresentingBankSortCode>${esc(r.presentingBankSortCode)}</PresentingBankSortCode>
      <SessionID>1</SessionID>
      <PresentmentDate>${day(r.presentmentDate)}</PresentmentDate>
      <ReturnReason>${esc(r.returnReason)}</ReturnReason>
      <InstrumentType>${esc(r.instrumentType)}</InstrumentType>
      <SettlementTime>${settlement}</SettlementTime>
      <ExpiryDate>${esc(r.expiryDate ?? '')}</ExpiryDate>
      <CheckDigit>${esc(r.checkDigit ?? '')}</CheckDigit>
    </RFItemData>`;
  return `<?xml version="1.0"?>
<RFData xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <BankCode>${f.bankCode}</BankCode>
  <MsgID>${f.msgId}</MsgID>
  <ItemCount>${returns.length}</ItemCount>
  <TotalValue>${total.toFixed(2)}</TotalValue>
  <Date>${settlement}</Date>
  <SettlementTime>${settlement}</SettlementTime>
  <Item>
${returns.map(item).join('\n')}
  </Item>
</RFData>
`;
}
