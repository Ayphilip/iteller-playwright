import fs from 'fs';

/**
 * Follows a log file while a test step runs, keeping every line written since start(), even if
 * the writer empties the file in between (the InwardFilesService clears its Event_Log.txt
 * periodically, so reading it only at the end of a test can miss lines).
 */
export function followLog(file: string, intervalMs = 3_000) {
  let offset = size(file);
  let text = '';
  const read = () => {
    const now = size(file);
    if (now < offset) offset = 0; // emptied / recreated: read from the start
    if (now > offset) {
      try {
        const fd = fs.openSync(file, 'r');
        try {
          const buf = Buffer.alloc(now - offset);
          fs.readSync(fd, buf, 0, buf.length, offset);
          text += buf.toString('utf8');
        } finally {
          fs.closeSync(fd);
        }
        offset = now;
      } catch { /* locked by the writer: try again next tick */ }
    }
  };
  const timer = setInterval(read, intervalMs);
  return {
    /** Everything written since start (reads the latest bytes first). */
    text() { read(); return text; },
    stop() { clearInterval(timer); read(); return text; },
  };
}

function size(file: string) {
  try { return fs.statSync(file).size; } catch { return 0; }
}
