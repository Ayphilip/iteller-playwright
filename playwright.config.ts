import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: path.resolve(__dirname, '.env') });

export const AUTH_FILE = path.join(__dirname, 'playwright/.auth/user.json');

guardAgainstParallelRuns();

/**
 * Two runs at once wipe each other's test-results folder (ENOENT on traces) and act on the same
 * test-environment data. The first run writes playwright/.run.lock; a second run started while
 * it is alive stops here, before touching test-results. Listing tests (--list, IDE) is allowed.
 */
function guardAgainstParallelRuns() {
  if (process.argv.includes('--list') || process.env.PW_ALLOW_PARALLEL_RUNS === 'true') return;
  const lock = path.join(__dirname, 'playwright/.run.lock');
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  let owner = 0;
  try { owner = Number(fs.readFileSync(lock, 'utf8')); } catch { /* no lock */ }
  // Workers load this config too: their parent (process.ppid) is the run that owns the lock.
  if (owner && owner !== process.pid && owner !== process.ppid && alive(owner)) {
    throw new Error(`Another Playwright run (process ${owner}) is in progress in this folder. `
      + `Wait for it to finish, or delete ${lock} if it is stale.`);
  }
  if (!process.env.TEST_WORKER_INDEX && owner !== process.pid) {
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(lock, String(process.pid));
    process.on('exit', () => { try { if (Number(fs.readFileSync(lock, 'utf8')) === process.pid) fs.unlinkSync(lock); } catch { /* ignore */ } });
  }
}

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  // Safety net: a frozen browser once hung a run for 3.5h while closing. Stop any run after 2h.
  globalTimeout: 2 * 60 * 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:8010',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
  },
  projects: [
    // Logs in once and saves the session (localStorage tokens) for other tests.
    { name: 'setup', testMatch: /.*\.setup\.ts/ },

    // Tests for the login page itself — run without a saved session.
    {
      name: 'login',
      testMatch: /login\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },

    // All other tests start already logged in.
    {
      name: 'chromium',
      testIgnore: /login\.spec\.ts|.*\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: AUTH_FILE },
      dependencies: ['setup'],
    },
  ],
});
