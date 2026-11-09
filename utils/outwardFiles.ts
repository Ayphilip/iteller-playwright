import fs from 'fs';
import path from 'path';

/**
 * Files CustomerDetails writes for the iTeller Transmitter to send (Web.config):
 *   OutwardFilePath4iTeller       = E:\MyOutward\OPFData -> E:\MyOutward\OPFData_<bank>_<date>_<msgId>.xml (outward presentment)
 *   OutwardReturnFilePath4iTeller = E:\MyOutward\ORFData -> E:\MyOutward\ORFData_<bank>_<date>_<msgId>.xml (returns of inward items)
 * The iTellerTransmitter service picks them up, sends them, and moves them to E:\MyOutward\Archive.
 */
export type OutwardKind = 'OPFData' | 'ORFData';

export const outwardDir = () => process.env.OUTWARD_FILE_DIR || 'E:/MyOutward';

export function listOutwardFiles(kind: OutwardKind = 'OPFData', dir = outwardDir()): Map<string, number> {
  const re = new RegExp(`^${kind}_.*\\.xml$`, 'i');
  try {
    return new Map(fs.readdirSync(dir).filter((f) => re.test(f))
      .map((f) => { const p = path.join(dir, f); return [p, fs.statSync(p).mtimeMs] as const; }));
  } catch {
    throw new Error(`Cannot read outward file folder ${dir} (set OUTWARD_FILE_DIR in .env)`);
  }
}

/** Files that are new, or rewritten, since `before`. */
export function newOutwardFiles(before: Map<string, number>, kind: OutwardKind = 'OPFData', dir = outwardDir()): string[] {
  return [...listOutwardFiles(kind, dir)].filter(([f, m]) => before.get(f) !== m).map(([f]) => f);
}

export type OutwardFileSummary = {
  file: string; bankCode?: string; msgId?: string; itemCount?: number; totalValue?: string; content: string;
};

/** Header values plus the file text with base64 images removed (for the report). */
export function readOutwardFile(file: string): OutwardFileSummary {
  const xml = fs.readFileSync(file, 'utf8');
  const tag = (name: string) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1];
  const count = tag('ItemCount');
  return {
    file,
    bankCode: tag('BankCode'),
    msgId: tag('MsgID'),
    itemCount: count === undefined ? undefined : Number(count),
    totalValue: tag('TotalValue'),
    content: xml.replace(/(<(FrontImage|RearImage)>)[^<]*(<\/\2>)/g, '$1[image removed]$3'),
  };
}
