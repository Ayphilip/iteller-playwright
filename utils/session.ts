import type { Page } from '@playwright/test';

/**
 * Opens the dashboard with whatever session the page's context has and reports whether it is
 * still accepted: 'valid' once the side menu shows, 'expired' if the app sends the browser to
 * lock_screen.html (or nothing shows within the timeout).
 */
export async function checkSession(page: Page, timeout = 150_000): Promise<'valid' | 'expired'> {
  await page.goto('/', { waitUntil: 'commit' });
  const menu = page.locator('aside a[href="javascript:;"]').filter({ hasText: /^\W*Clearing$/ });
  return Promise.race([
    page.waitForURL(/lock_screen/, { timeout }).then(() => 'expired' as const, () => 'expired' as const),
    menu.waitFor({ state: 'visible', timeout }).then(() => 'valid' as const, () => 'expired' as const),
  ]);
}
