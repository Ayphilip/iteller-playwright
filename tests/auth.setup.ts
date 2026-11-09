import fs from 'fs';
import { test as setup } from '../fixtures/test';
import { LoginPage } from '../pages/LoginPage';
import { AUTH_FILE } from '../playwright.config';
import { credentials } from '../utils/env';
import { checkSession } from '../utils/session';

setup('authenticate', async ({ browser, page, baseURL }) => {
  // The API allows only 5 logins per 15 minutes, so keep the saved session while it still works.
  if (fs.existsSync(AUTH_FILE) && process.env.FORCE_LOGIN !== 'true') {
    const context = await browser.newContext({ baseURL, storageState: AUTH_FILE });
    const probe = await context.newPage();
    const sentToLogin = (await checkSession(probe)) === 'expired';
    if (!sentToLogin) await context.storageState({ path: AUTH_FILE }); // keep refreshed tokens
    await context.close();
    if (!sentToLogin) {
      setup.info().annotations.push({ type: 'Session', description: 'saved login still valid: reused' });
      return;
    }
  }

  const loginPage = new LoginPage(page);
  await loginPage.login(credentials.username, credentials.password, {
    branch: credentials.branch,
    otp: credentials.otp,
  });
  // Tokens live in localStorage, which storageState captures.
  await page.context().storageState({ path: AUTH_FILE });
});
