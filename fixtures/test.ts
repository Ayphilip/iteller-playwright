import { test as base, expect, type Page } from '@playwright/test';
import fs from 'fs';
import { LogTracker } from './logTracker';
import { approverStorageState } from '../flows/approver';

/**
 * Use `import { test, expect } from '../fixtures/test'` in specs instead of '@playwright/test'.
 *
 * For every test, automatically attaches to the HTML report (and writes to the test's
 * output folder under test-results/):
 *   - backend-iteller-api.log       lines the iTeller Enterprise API wrote during the test
 *   - backend-customer-details-<type>.log  CustomerDetails EventLog / 4NO / 4OC / 4DbData / 4DE / other
 *   - logs-summary.txt              which backend logs changed (empty ones are not attached)
 *   - browser.log                   browser console, page errors, failed requests, API calls
 *                                   (lines tagged [maker] / [approver])
 * Disable with TRACK_LOGS=false in .env.
 *
 * Extra fixture:
 *   - approverPage  a second browser session for the approving user (maker-checker tests); sign it
 *                   in with signInApprover(). The default `page` keeps the maker's saved login.
 */
type Fixtures = { trackLogs: void; browserLog: string[]; approverPage: Page };

const enabled = () => process.env.TRACK_LOGS !== 'false';
const isApiCall = (type: string) => type === 'xhr' || type === 'fetch';

function recordBrowser(page: Page, lines: string[], who: string) {
  // Local time, to line up with the backend logs (which use local time).
  const ts = () => { const d = new Date(); return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0'); };
  const push = (s: string) => lines.push(`${ts()} [${who}] ${s}`);
  page.on('console', (m) => push(`[console.${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => push(`[request failed] ${r.method()} ${r.url()} - ${r.failure()?.errorText}`));
  page.on('response', async (r) => {
    const req = r.request();
    if (!isApiCall(req.resourceType())) return;
    let line = `[api] ${r.status()} ${req.method()} ${r.url()}`;
    if (r.status() >= 400) {
      const body = await r.text().catch(() => '');
      line += `\n    response: ${body.slice(0, 1000)}`;
    }
    push(line);
  });
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) push(`[navigate] ${f.url()}`); });
}

export const test = base.extend<Fixtures>({
  browserLog: async ({}, use) => { await use([]); },

  approverPage: async ({ browser, browserLog, baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, actionTimeout }, use, testInfo) => {
    const context = await browser.newContext({
      baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch,
      // The approver's session saved earlier in this run, else logged out (see flows/approver.ts).
      storageState: approverStorageState(testInfo),
    });
    context.setDefaultTimeout(actionTimeout || 15_000);
    context.setDefaultNavigationTimeout(0); // same as the default page: the dashboard loads slowly
    const page = await context.newPage();
    if (enabled()) recordBrowser(page, browserLog, 'approver');
    await use(page);
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach('approver-failure.png', { body: await page.screenshot().catch(() => Buffer.from('')), contentType: 'image/png' });
    }
    await context.close();
  },

  trackLogs: [async ({ page, browserLog }, use, testInfo) => {
    if (!enabled()) return use();

    const tracker = new LogTracker();
    tracker.snapshot();
    recordBrowser(page, browserLog, 'maker');

    await use();

    const attach = async (name: string, body: string) => {
      fs.writeFileSync(testInfo.outputPath(name), body);
      await testInfo.attach(name, { body, contentType: 'text/plain' });
    };
    const summary: string[] = [];
    for (const { name, dirs, text } of tracker.collect()) {
      if (text) {
        const lines = text.split('\n').filter((l) => l.trim() && !l.startsWith('===== ')).length;
        summary.push(`${name.padEnd(30)} ${lines} new line(s)`);
        await attach(`backend-${name}.log`, text);
      } else {
        summary.push(`${name.padEnd(30)} no new entries (${dirs.join(', ')})`);
      }
    }
    await attach('browser.log', browserLog.join('\n') || '(no browser activity recorded)');
    await attach('logs-summary.txt', summary.join('\n'));
  }, { auto: true }],
});

export { expect };
