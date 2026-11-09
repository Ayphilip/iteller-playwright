import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Page object for lock_screen.html.
 *
 * Flow: lock icon -> modal (UserName/Password) -> PROCEED -> branch select -> SIGN IN
 * Optional extra steps: OTP modal (2FA) and "User Already Login" modal (force login).
 */
export class LoginPage {
  readonly page: Page;
  readonly unlockIcon: Locator;
  readonly loginModal: Locator;
  readonly username: Locator;
  readonly password: Locator;
  readonly proceedButton: Locator;
  readonly branchSelect: Locator;
  readonly signInButton: Locator;
  readonly errorAlert: Locator;
  readonly errorMessage: Locator;
  readonly otpModal: Locator;
  readonly otpInput: Locator;
  readonly otpSubmit: Locator;
  readonly alreadyLoggedInModal: Locator;
  readonly forceLoginButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.unlockIcon = page.locator('a[data-bs-target="#myModal"]');
    this.loginModal = page.locator('#myModal');
    this.username = page.locator('#email');
    this.password = page.locator('#password');
    this.proceedButton = page.locator('#login');
    this.branchSelect = page.locator('#branch-select');
    this.signInButton = page.locator('#login-final');
    this.errorAlert = page.locator('#alert');
    this.errorMessage = page.locator('#loginMessage');
    this.otpModal = page.locator('#tokenModal');
    this.otpInput = page.locator('#otp');
    this.otpSubmit = page.locator('#form-OTP');
    this.alreadyLoggedInModal = page.locator('#LoginModal');
    this.forceLoginButton = page.locator('#forceLogin');
  }

  async goto() {
    await this.page.goto('/lock_screen.html');
  }

  async openLoginModal() {
    await this.unlockIcon.click();
    await expect(this.username).toBeVisible();
  }

  async submitCredentials(username: string, password: string) {
    await this.username.fill(username);
    await this.password.fill(password);
    await this.proceedButton.click();
  }

  /** Full happy-path login. Lands on the dashboard ('../' relative to lock_screen.html). */
  async login(
    username: string,
    password: string,
    opts: { branch?: string; otp?: string; forceLogin?: boolean } = {},
  ) {
    await this.goto();
    await this.openLoginModal();
    await this.submitCredentials(username, password);

    // Branch step appears once credentials are accepted (branch list can take >10s to load).
    await expect(this.signInButton).toBeVisible({ timeout: 30_000 });
    if (opts.branch) {
      const options = (await this.branchSelect.locator('option').allTextContents()).map((o) => o.trim());
      if (!options.includes(opts.branch)) {
        throw new Error(`Branch "${opts.branch}" (TEST_BRANCH / APPROVER_BRANCH in .env) is not offered. `
          + `Available: ${options.slice(0, 15).join(' | ')}${options.length > 15 ? ' ...' : ''}`);
      }
      await this.branchSelect.selectOption({ label: opts.branch });
    }
    await this.signInButton.click();

    // Handle whichever optional step shows up, until we leave the lock screen.
    // SIGN IN waits 3s + several API calls before redirecting, and the dashboard is slow
    // to fire `load`, so resolve on URL commit and give every branch the same long timeout.
    // Optional-step waits never reject, so they can't fail the race before the redirect wins.
    const STEP_TIMEOUT = 45_000;
    const never = new Promise<never>(() => {});
    const leftLockScreen = this.page.waitForURL((url) => !url.pathname.includes('lock_screen'), {
      waitUntil: 'commit',
      timeout: STEP_TIMEOUT,
    });
    const appears = (locator: Locator) =>
      locator.waitFor({ state: 'visible', timeout: STEP_TIMEOUT }).catch(() => never);
    const step = await Promise.race([
      leftLockScreen.then(() => 'done' as const),
      appears(this.otpModal).then(() => 'otp' as const),
      appears(this.alreadyLoggedInModal).then(() => 'force' as const),
    ]);

    if (step === 'otp') {
      if (!opts.otp) throw new Error('OTP requested by app but TEST_OTP is not set in .env');
      await this.otpInput.fill(opts.otp);
      await this.otpSubmit.click();
    }

    if (step === 'force' || (step === 'otp' && (await this.alreadyLoggedInModal.isVisible()))) {
      if (opts.forceLogin === false) throw new Error('User is already logged in elsewhere');
      await this.forceLoginButton.click();
    }

    // Don't wait for the dashboard's load events here: it can take ~60s to parse.
    await leftLockScreen;
  }
}
