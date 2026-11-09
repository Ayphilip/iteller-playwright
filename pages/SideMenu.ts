import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Left sidebar navigation. Section headers are `<a href="javascript:;">`, pages are
 * `<a href="/pages/...">`. Labels start with an icon glyph, hence the \W* in the regex.
 */
export class SideMenu {
  constructor(private readonly page: Page) {}

  private label(text: string) {
    const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^\\W*${escaped}$`);
  }

  section(name: string) {
    return this.page.locator('aside a[href="javascript:;"]').filter({ hasText: this.label(name) });
  }

  item(name: string) {
    return this.page.locator('aside a[href^="/pages/"]').filter({ hasText: this.label(name) }).first();
  }

  /** Opens the dashboard without waiting for its (very slow) load events. */
  async openApp() {
    await this.page.goto('/', { waitUntil: 'commit' });
    await this.waitForMenu();
  }

  /**
   * The app keeps the browser's main thread busy for ~60s after a full page load
   * (DOMContentLoaded fires late even though the menu renders early); clicks made before
   * then hang. Wait for it once; in-app navigation afterwards is fast.
   */
  async waitForMenu() {
    await this.page.waitForLoadState('domcontentloaded', { timeout: 150_000 });
    await expect(this.section('Clearing')).toBeVisible({ timeout: 30_000 });
  }

  /** Menu link by its page address, ignoring case (menu mixes /pages/clearing and /pages/Clearing). */
  itemByPath(pagePath: string) {
    return this.page.locator(`aside a[href="${pagePath}" i]`).first();
  }

  /** e.g. navigateToPath('View', '/pages/View/DoubleEntries') */
  async navigateToPath(section: string, pagePath: string) {
    return this.open(section, this.itemByPath(pagePath));
  }

  /** e.g. navigate('Clearing', 'Transfers(CR)') */
  async navigate(section: string, item: string) {
    return this.open(section, this.item(item));
  }

  private async open(section: string, link: Locator) {
    // The accordion's state depends on the current page (an active section may show only its
    // active item, and clicking it collapses it), so toggle the section until the item shows.
    // The submenu slides open (it's greyed out while animating) and the page can still be busy,
    // so allow each attempt time to finish before toggling again.
    await expect(async () => {
      if (!(await link.isVisible())) await this.section(section).click({ timeout: 10_000 });
      await expect(link).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000, intervals: [1_000, 2_000, 3_000] });
    await link.scrollIntoViewIfNeeded();
    await link.click();
  }
}
