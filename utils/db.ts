import { execFileSync } from 'child_process';
import fs from 'fs';

/**
 * Read-only lookups in the iTeller database through sqlcmd (Windows authentication), for test data
 * the app has no screen for (e.g. which transmitted items a return file can return).
 *   ITELLER_DB_SERVER (default ".") / ITELLER_DB_NAME (default iTELLEREnterprise) / SQLCMD (path).
 */
const SQLCMD_CANDIDATES = [
  'C:/Program Files/Microsoft SQL Server/Client SDK/ODBC/170/Tools/Binn/SQLCMD.EXE',
  'C:/Program Files/Microsoft SQL Server/Client SDK/ODBC/180/Tools/Binn/SQLCMD.EXE',
  'C:/Program Files/Microsoft SQL Server/160/Tools/Binn/SQLCMD.EXE',
];
const sqlcmd = () => process.env.SQLCMD || SQLCMD_CANDIDATES.find((p) => fs.existsSync(p)) || 'sqlcmd';

/** Runs a SELECT and returns its rows as objects (column -> trimmed text). */
export function query(sql: string): Record<string, string>[] {
  const out = execFileSync(sqlcmd(), [
    '-S', process.env.ITELLER_DB_SERVER || '.', '-E', '-d', process.env.ITELLER_DB_NAME || 'iTELLEREnterprise',
    '-W', '-s', '\t', '-b', '-Q', `SET NOCOUNT ON; ${sql}`,
  ], { encoding: 'utf8', timeout: 60_000 });
  const lines = out.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];
  const header = lines[0].split('\t').map((h) => h.trim());
  return lines.slice(2).map((l) => {
    const cells = l.split('\t');
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim() === 'NULL' ? '' : (cells[i] ?? '').trim()]));
  });
}
