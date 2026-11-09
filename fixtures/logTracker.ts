import fs from 'fs';
import path from 'path';

/**
 * Captures what backend services append to their log files while a test runs.
 *
 * snapshot() records the size of every matching file in each log directory; collect() then
 * returns only the bytes written since — including files created after the snapshot
 * (daily roll-over, or CustomerDetails renaming EventLog.txt to EventLog_<ts>.txt when full).
 */
export type LogSource = { name: string; dirs: string[]; match: (fileName: string) => boolean };

const apiDir = () => process.env.ITELLER_API_LOG_DIR || 'C:/inetpub/wwwroot/iTellerEnterpriseAPI/logs';
const cdsRoot = () => process.env.CUSTOMER_DETAILS_DIR || 'C:/inetpub/wwwroot/CustomerDetailsservicechEnterprise';
// CustomerDetails writes EventLog*.txt both in its root folder and in Logs/ (rotated copies are
// named like EventLog4NO_<timestamp>.txt), so watch both.
const cdsDirs = () => [cdsRoot(), path.join(cdsRoot(), 'Logs')];

/** CustomerDetails log types: EventLog<suffix>[_<rotation stamp>].txt */
const CDS_TYPES: Record<string, string> = {
  '': 'general',           // EventLog        - general events for all processes
  '4NO': 'neft-outward',   // EventLog4NO     - NEFT outward
  '4NI': 'neft-inward',    // EventLog4NI     - NEFT inward
  '4OR': 'outward-return', // EventLog4OR     - returns of inward items (return request posting/file)
  '4OC': 'cheque',         // EventLog4OC     - cheques (on disk the file is EventLog4CO)
  '4CO': 'cheque',
  '4DBDATA': 'db-queries', // EventLog4DbData - database queries
  '4DE': 'double-entry',   // EventLog4DE     - double entry postings (on disk: EventLogDE, no "4")
  'DE': 'double-entry',
};

/**
 * EventLog[4]<TYPE>[<rotation stamp>].txt -> type name. Rotated copies look like
 * EventLog_09_09_2025_6_37_14_PM.txt, EventLog4NI_12_09_2025_3_01_00_PM.txt, EventLog4DbData22_09_2025.txt.
 * Unlisted types go to "other" so nothing written during a test is missed.
 */
export function customerDetailsType(file: string): string | undefined {
  const m = /^EventLog(4?[a-z]+)?[^.]*\.txt$/i.exec(file);
  if (!m) return undefined;
  return CDS_TYPES[(m[1] ?? '').toUpperCase()] ?? 'other';
}

const cdsSource = (type: string): LogSource => ({
  name: `customer-details-${type}`,
  dirs: cdsDirs(),
  match: (f) => customerDetailsType(f) === type,
});

// iTeller Transmitter Windows service (picks up E:\MyOutward\OPFData_*.xml and sends it to the
// clearing switch). iTELLERCHLogs\log1.txt = items sent / responses, errors.txt = errors (rotated to
// errors_<dd_mm_yyyy_h_mm_ss_AM>.txt at ~300KB). E:\TransmiterLog = service timer log + its errors.
const transmitterDir = () => process.env.TRANSMITTER_DIR || 'C:/Program Files (x86)/PFS/iTeller Transmitter';
const transmitterChLogs = () => path.join(transmitterDir(), 'iTELLERCHLogs');
const transmitterServiceLogs = () => process.env.TRANSMITTER_LOG_DIR || 'E:/TransmiterLog';

export const transmitterSentSource = (): LogSource =>
  ({ name: 'transmitter-sent', dirs: [transmitterChLogs()], match: (f) => /^log\d*(_.*)?\.txt$/i.test(f) });

export const logSources = (): LogSource[] => [
  { name: 'iteller-api', dirs: [apiDir()], match: (f) => /^log-\d{8}\.txt$/i.test(f) },
  ...['general', 'neft-outward', 'neft-inward', 'outward-return', 'cheque', 'db-queries', 'double-entry', 'other'].map(cdsSource),
  transmitterSentSource(),
  { name: 'transmitter-errors', dirs: [transmitterChLogs()], match: (f) => /^errors(_.*)?\.txt$/i.test(f) },
  { name: 'inward-files-service', dirs: [process.env.INWARD_SERVICE_DIR || 'C:/Program Files (x86)/PFS/InwardFilesService'], match: (f) => /^Event_Log.*\.txt$/i.test(f) },
  { name: 'transmitter-service', dirs: [transmitterServiceLogs()], match: (f) => /^(log|errors)(_.*)?\.txt$/i.test(f) },
];

type Snapshot = Map<string, number>; // file path -> size

const MAX_BYTES_PER_FILE = 5 * 1024 * 1024;

function listFiles(source: LogSource): string[] {
  return source.dirs.flatMap((dir) => {
    try {
      return fs.readdirSync(dir)
        .filter((f) => source.match(f))
        .map((f) => path.join(dir, f));
    } catch {
      return []; // directory missing or not readable: nothing to track
    }
  });
}

function sizeOf(file: string): number {
  try { return fs.statSync(file).size; } catch { return 0; }
}

/** Reads [from, end) without locking out the writer (log files are open by the services). */
function readFrom(file: string, from: number): string {
  const size = sizeOf(file);
  if (size <= from) return '';
  const start = Math.max(from, size - MAX_BYTES_PER_FILE);
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const prefix = start > from ? `[... ${start - from} earlier bytes truncated ...]\n` : '';
    return prefix + buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

export class LogTracker {
  private snapshots = new Map<string, Snapshot>();

  constructor(private readonly sources = logSources()) {}

  snapshot() {
    for (const source of this.sources) {
      this.snapshots.set(source.name, new Map(listFiles(source).map((f) => [f, sizeOf(f)])));
    }
  }

  /** Returns the new log text per source (empty string when nothing was written). */
  collect(): { name: string; dirs: string[]; text: string }[] {
    return this.sources.map((source) => {
      const before = this.snapshots.get(source.name) ?? new Map<string, number>();
      const parts: string[] = [];
      // Only files that are new or changed size (some folders hold thousands of rotated logs).
      const changed = listFiles(source)
        .map((file) => { try { const s = fs.statSync(file); return { file, size: s.size, mtime: s.mtimeMs }; } catch { return undefined; } })
        .filter((f): f is { file: string; size: number; mtime: number } => !!f && before.get(f.file) !== f.size)
        .sort((a, b) => a.mtime - b.mtime);
      for (const { file, size } of changed) {
        const prev = before.get(file);
        // New file -> whole file. Shrunk file (truncated/recreated) -> whole file. Else the tail.
        const from = prev === undefined || size < prev ? 0 : prev;
        const text = readFrom(file, from);
        if (text.trim()) parts.push(`===== ${file} =====\n${text}`);
      }
      return { name: source.name, dirs: source.dirs, text: parts.join('\n') };
    });
  }
}
