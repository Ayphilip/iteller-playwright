import { test, expect } from '../fixtures/test';
import { LoginPage } from '../pages/LoginPage';
import { credentials } from '../utils/env';

test.describe('Login (lock screen)', () => {
  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    await loginPage.goto();
  });

  test('page loads with title and unlock icon', async ({ page }) => {
    await expect(page).toHaveTitle(/iTeller/i);
    await expect(loginPage.unlockIcon).toBeVisible();
  });

  test('clicking unlock opens the login modal', async () => {
    await loginPage.openLoginModal();
    await expect(loginPage.password).toBeVisible();
    await expect(loginPage.proceedButton).toBeVisible();
  });

  test('invalid credentials show an error', async () => {
    await loginPage.openLoginModal();
    await loginPage.submitCredentials('invalid.user', 'wrong-password');
    await expect(loginPage.errorAlert).toBeVisible({ timeout: 30_000 });
    await expect(loginPage.errorMessage).not.toBeEmpty();
  });

  test('valid credentials log the user in', async ({ page }) => {
    await loginPage.login(credentials.username, credentials.password, {
      branch: credentials.branch,
      otp: credentials.otp,
    });
    await expect(page).not.toHaveURL(/lock_screen/);
  });
});
