import { expect, test, type Locator, type Page } from '@playwright/test';
import type { TransferData } from '../utils/env';

export type NeftType = 'CR' | 'DR';

/**
 * Clearing > Transfers(CR) and Clearing > Transfers(DR) (NEFT outward).
 * Both screens share the same component; DR calls the list "Payers" instead of "Beneficiaries".
 *
 * Flow: Account No. (lookup on blur) -> Narration -> Add beneficiary/payer (modal, account
 * validated at 10 digits) -> Total Amount (must equal the auto-summed total) -> Save -> Proceed.
 */
export class NeftTransferPage {
  readonly heading: Locator;
  readonly accountNo: Locator;
  readonly customerName: Locator;
  readonly narration: Locator;
  readonly totalAmount: Locator;
  readonly summedTotal: Locator;
  readonly addButton: Locator;
  readonly saveButton: Locator;
  readonly accountCheckModal: Locator;
  readonly rows: Locator;

  // "New Beneficiary" modal
  readonly benModal: Locator;
  readonly benBank: Locator;
  readonly benAccountNo: Locator;
  readonly benName: Locator;
  readonly benVerifiedName: Locator;
  readonly benPurpose: Locator;
  readonly benChannel: Locator;
  readonly benAmount: Locator;
  readonly benSubmit: Locator;
  readonly benAddedFeedback: Locator;

  // Confirmation / result modals
  readonly confirmModal: Locator;
  readonly proceedButton: Locator;
  readonly finalConfirmModal: Locator;
  readonly finalProceedButton: Locator;
  readonly successModal: Locator;
  readonly successMessage: Locator;
  readonly amountMismatchModal: Locator;

  constructor(readonly page: Page, readonly type: NeftType) {
    const main = page.locator('main');
    this.heading = main.getByRole('heading', { name: `Transfers(${type})` });
    this.accountNo = main.locator('#txtAccNum');
    this.customerName = main.locator('#txtTitle');
    this.narration = main.locator('input[name="Narration"]');
    this.totalAmount = main.locator('#totalAmt');
    this.summedTotal = page.locator('#spnSummedDebit');
    this.addButton = page.locator('#btnManualBenfAdd');
    this.saveButton = page.locator('#btnSaveNEFT');
    this.accountCheckModal = page.locator('#checkAccModal');
    // Hidden modals on the page contain tables too; only count the visible beneficiaries table.
    this.rows = main.locator('.rdt_TableBody .rdt_TableRow').filter({ visible: true });

    this.benModal = page.locator('#newBenfModal');
    this.benBank = this.benModal.locator('#bkcode');
    this.benAccountNo = this.benModal.locator('#txtAcctNum');
    this.benName = this.benModal.locator('input[name="BeneficiaryName"]');
    this.benVerifiedName = this.benModal.locator('#lblVerifiedname');
    this.benPurpose = this.benModal.locator('input[name="Purpose"]');
    this.benChannel = this.benModal.locator('#trsChannel');
    this.benAmount = this.benModal.locator('input[name="Amount"]');
    this.benSubmit = this.benModal.locator('#btnSubmit');
    this.benAddedFeedback = this.benModal.locator('#feedbkSec');

    this.confirmModal = page.locator('#preSubmitNEFTModalWithDetails');
    this.proceedButton = this.confirmModal.locator('#btnProceedDetails');
    // Second "Are you sure you want to proceed?" dialog; its Proceed is what actually saves.
    this.finalConfirmModal = page.locator('#preProceedModal');
    this.finalProceedButton = this.finalConfirmModal.locator('#btnProceed');
    this.successModal = page.locator('#savedSuccessfullyModal');
    this.successMessage = this.successModal.locator('#bodyPara');
    this.amountMismatchModal = page.locator('#amtMismatchModal');
  }

  async expectLoaded() {
    await expect(this.heading).toBeVisible({ timeout: 60_000 });
  }

  /** Enters the customer account and waits for the name lookup. */
  async enterAccount(accountNo: string) {
    await this.accountNo.fill(accountNo);
    await this.accountNo.blur(); // lookup fires on blur
    await expect(this.customerName, `Account ${accountNo} lookup failed`).not.toHaveValue('', { timeout: 30_000 });
    // App glitch: the "Verifying Account Number.." modal sometimes stays open after a
    // successful lookup (hide() is ignored mid show-animation). Close it like a user would.
    try {
      await expect(this.accountCheckModal).toBeHidden({ timeout: 5_000 });
    } catch {
      test.info().annotations.push({
        type: 'app issue',
        description: `"Account Check" modal stayed open after successful lookup of ${accountNo}; closed manually`,
      });
      await this.accountCheckModal.locator('.btn-close').click();
      await expect(this.accountCheckModal).toBeHidden();
    }
  }

  async selectBank(bank?: string) {
    if (!bank) return; // keep the dropdown's first/default bank
    const options = await this.benBank.locator('option').allTextContents();
    // Ignore case, spaces and punctuation: "ACCESSBANK" matches "ACCESS BANK PLC".
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const wanted = norm(bank);
    const match = options.find((o) => norm(o) === wanted)
      ?? options.find((o) => norm(o).startsWith(wanted))
      ?? options.find((o) => norm(o).includes(wanted));
    if (!match) throw new Error(`Bank "${bank}" not found. Available: ${options.slice(0, 20).join(' | ')}...`);
    await this.benBank.selectOption({ label: match });
  }

  /** Adds one beneficiary (CR) / payer (DR) through the modal. */
  async addCounterparty(data: Pick<TransferData, 'bank' | 'counterpartyAccountNo' | 'amount' | 'purpose'>) {
    await expect(this.addButton).toBeEnabled();
    await this.addButton.click();
    await expect(this.benModal).toBeVisible();

    await this.selectBank(data.bank);
    // Validation is triggered on keyup when the 10th digit is typed.
    await this.benAccountNo.pressSequentially(data.counterpartyAccountNo);
    await expect(this.benVerifiedName, 'Beneficiary account name verification failed')
      .not.toHaveText('', { timeout: 30_000 });
    await expect(this.benName).not.toHaveValue('');

    await this.benPurpose.fill(data.purpose);
    await this.benAmount.pressSequentially(data.amount); // react-number-format input
    await expect(this.benSubmit).toBeEnabled();
    await this.benSubmit.click();
    await expect(this.benAddedFeedback).toBeVisible({ timeout: 30_000 });

    await this.benModal.locator('.btn-close').click();
    await expect(this.benModal).toBeHidden();
  }

  /** Types the total so it matches the auto-summed total the app validates against. */
  async enterTotalAmount(amount: string) {
    await this.totalAmount.fill('');
    await this.totalAmount.pressSequentially(amount);
    const summed = (await this.summedTotal.textContent())?.trim() ?? '';
    await expect(this.totalAmount, `Total amount must equal summed total "${summed}"`).toHaveValue(summed);
  }

  /** Save -> Proceed. Returns the Batch ID from the success message. */
  async save(): Promise<string> {
    await expect(this.saveButton).toBeEnabled();
    await this.saveButton.click();
    if (await this.amountMismatchModal.isVisible()) {
      throw new Error(`Save blocked: ${await this.amountMismatchModal.innerText()}`);
    }
    await expect(this.confirmModal).toBeVisible();
    await expect(this.confirmModal).toContainText(`NEFT TYPE: ${this.type === 'CR' ? 'CR' : 'DB'}`);
    await this.proceedButton.click();
    await expect(this.finalConfirmModal).toBeVisible();
    await this.finalProceedButton.click();

    await expect(this.successModal).toBeVisible({ timeout: 60_000 });
    await expect(this.successMessage).toContainText('successfully saved and awaiting approval');
    const text = await this.successMessage.innerText();
    const batchId = text.match(/Batch ID:\s*([^\]\s]+)/)?.[1];
    if (!batchId) throw new Error(`No Batch ID in success message: ${text}`);
    // Close it so the (now reset) form can be used for the next transfer.
    await this.successModal.locator('.btn-close').click();
    await expect(this.successModal).toBeHidden();
    return batchId;
  }

  /** Full creation flow for one counterparty. Returns the Batch ID. */
  async create(data: TransferData, narration: string): Promise<string> {
    await expect(this.rows, 'Form should be empty before a new transfer').toHaveCount(0, { timeout: 15_000 });
    await this.enterAccount(data.accountNo);
    await this.narration.fill(narration);
    await this.addCounterparty(data);
    await expect(this.rows).toHaveCount(1);
    // Row cells are editable inputs, so check their values rather than text.
    await expect.poll(() => this.rows.first().locator('input').evaluateAll((els) =>
      els.map((e) => (e as HTMLInputElement).value.trim()))).toContain(data.counterpartyAccountNo);
    await this.enterTotalAmount(data.amount);
    return this.save();
  }
}
