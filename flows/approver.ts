import fs from 'fs';
import path from 'path';
import type { Page, TestInfo } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { AUTH_FILE } from '../playwright.config';
import { approver, credentials } from '../utils/env';
import { checkSession } from '../utils/session';

/**
 * The API allows only 5 logins per 15 minutes per machine (API appsettings IpRateLimiting, rule "*&#47;api/Login"), so
 * the approver signs in once per run and later tests reuse that session:
 *   - approver is the maker (same user and branch): the maker's saved login (AUTH_FILE) is reused;
 *   - otherwise: the first sign-in is saved in the run's output folder (emptied at every run).
 */
const sameUserAsMaker = () =>
  approver.username.toLowerCase() === credentials.username.toLowerCase() && approver.branch === credentials.branch;

export const approverSessionFile = (testInfo: TestInfo) =>
  sameUserAsMaker() ? AUTH_FILE : path.join(testInfo.project.outputDir, '.approver-session.json');

/** storageState for the approver's browser context: a saved session if there is one, else logged out. */
export function approverStorageState(testInfo: TestInfo) {
  const file = approverSessionFile(testInfo);
  return fs.existsSync(file) ? file : { cookies: [], origins: [] };
}

/**
 * Leaves `page` signed in as the approver on the dashboard.
 * Signs in only when the saved session is missing or no longer accepted.
 */
export async function signInApprover(page: Page, testInfo: TestInfo) {
  const file = approverSessionFile(testInfo);
  if (fs.existsSync(file)) {
    if ((await checkSession(page)) === 'valid') {
      testInfo.annotations.push({ type: 'Approver session', description: `reused (${path.basename(file)})` });
      return;
    }
  }
  await new LoginPage(page).login(approver.username, approver.password, { branch: approver.branch, otp: approver.otp });
  if (!sameUserAsMaker()) await page.context().storageState({ path: file });
  testInfo.annotations.push({ type: 'Approver session', description: 'signed in' });
}
