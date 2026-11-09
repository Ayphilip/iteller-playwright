import fs from 'fs';
import path from 'path';
import { test, expect } from '../fixtures/test';
import { LogTracker, transmitterSentSource } from '../fixtures/logTracker';
import { listOutwardFiles, newOutwardFiles, outwardDir, readOutwardFile, type OutwardKind } from '../utils/outwardFiles';

/** Seconds to wait for the iTellerTransmitter to pick a file up (0 = stop once the file is generated). */
export const pickupWaitSeconds = () => Number(process.env.PICKUP_WAIT_SECONDS ?? 180);

/** Last line of the Transmitter's iTELLERCHLogs\errors.txt (e.g. "Could not connect to net.tcp://..."). */
export function lastTransmitterError() {
  const file = path.join(transmitterSentSource().dirs[0], 'errors.txt');
  try {
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    return lines[lines.length - 1].slice(0, 300);
  } catch {
    return `(cannot read ${file})`;
  }
}

/**
 * Call BEFORE the action that generates the file (Transmit). Then:
 *   const file = await watch.expectNewFile();      // new OPFData_/ORFData_ file in E:\MyOutward
 *   await watch.expectTransmitted(file);           // archived + "sent to Server" + "Response received"
 */
export function watchOutwardFiles(kind: OutwardKind) {
  const before = listOutwardFiles(kind);
  const transmitterLog = new LogTracker([transmitterSentSource()]);
  transmitterLog.snapshot();
  const hint = () => `Last Transmitter error: ${lastTransmitterError()}`;

  return {
    /** Waits for the generated file, attaches it to the report and returns its summary. */
    async expectNewFile() {
      return test.step(`new ${kind} file in ${outwardDir()}`, async () => {
        let files: string[] = [];
        await expect.poll(() => (files = newOutwardFiles(before, kind)).length,
          { message: `No new ${kind} file in ${outwardDir()}`, timeout: 60_000 }).toBeGreaterThan(0);
        const summary = readOutwardFile(files[files.length - 1]);
        test.info().annotations.push({
          type: `${kind} file`,
          description: `${summary.file} - bank ${summary.bankCode}, MsgID ${summary.msgId}, ${summary.itemCount} item(s), total ${summary.totalValue}`,
        });
        await test.info().attach(`${kind}.xml`, { body: summary.content, contentType: 'text/plain' });
        expect(summary.itemCount, 'File has no items').toBeGreaterThan(0);
        return summary;
      });
    },

    /** The iTellerTransmitter archives the file and logs it as sent and answered by the switch. */
    async expectTransmitted(file: string) {
      const wait = pickupWaitSeconds();
      if (wait <= 0) return;
      const id = String(Number(readOutwardFile(file).msgId)); // log writes MsgID:2700

      await test.step(`iTeller Transmitter picks up ${path.basename(file)} (within ${wait}s)`, async () => {
        await expect.poll(() => fs.existsSync(file), {
          message: `${file} is still in ${outwardDir()} after ${wait}s (is the iTellerTransmitter service running?). ${hint()}`,
          timeout: wait * 1000, intervals: [5_000],
        }).toBe(false);
        const archived = path.join(outwardDir(), 'Archive', path.basename(file));
        expect.soft(fs.existsSync(archived), `Expected the file to be moved to ${archived}`).toBe(true);
      });

      await test.step(`Transmitter sends MsgID ${id} to the switch and gets a response`, async () => {
        const sentText = () => transmitterLog.collect()[0].text;
        await expect.poll(() => new RegExp(`sent to Server\\..*MsgID:\\s*${id}\\b`).test(sentText()), {
          message: `No "... sent to Server ... MsgID:${id}" in the Transmitter log. ${hint()}`,
          timeout: 120_000, intervals: [5_000],
        }).toBe(true);
        await expect.poll(() => new RegExp(`Response received from Server\\. MsgID:\\s*${id}\\b`).test(sentText()), {
          message: `Switch did not respond for MsgID:${id}. ${hint()}`,
          timeout: 120_000, intervals: [5_000],
        }).toBe(true);
        test.info().annotations.push({
          type: 'Transmitted',
          description: sentText().split('\n').filter((l) => l.includes(`MsgID:${id}`)).join(' | '),
        });
      });
    },
  };
}
