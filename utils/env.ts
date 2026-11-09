function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} — copy .env.example to .env and fill it in`);
  return value;
}

const optional = (name: string) => process.env[name] || undefined;

export const credentials = {
  get username() { return required('TEST_USERNAME'); },
  get password() { return required('TEST_PASSWORD'); },
  get branch() { return optional('TEST_BRANCH'); },
  get otp() { return optional('TEST_OTP'); },
};

/** Second user who reviews transfers under Approval > Pending Transfers. */
export const approver = {
  get username() { return required('APPROVER_USERNAME'); },
  get password() { return required('APPROVER_PASSWORD'); },
  get branch() { return optional('APPROVER_BRANCH') ?? optional('TEST_BRANCH'); },
  get otp() { return optional('APPROVER_OTP'); },
  get isConfigured() { return !!process.env.APPROVER_USERNAME && !!process.env.APPROVER_PASSWORD; },
};

export type TransferData = {
  accountNo: string;        // customer account on the main form
  bank?: string;            // bank name (or part of it) in the dropdown; first bank if empty
  counterpartyAccountNo: string; // beneficiary (CR) / payer (DR) 10-digit NUBAN
  amount: string;           // e.g. "1000"
  purpose: string;
};

/** Transfer(CR) test data. DR_* values fall back to the CR ones when not set. */
export const transferData = {
  get isConfigured() { return !!process.env.TRANSFER_ACCOUNT_NO && !!process.env.BENEFICIARY_ACCOUNT_NO; },
  get cr(): TransferData {
    return {
      accountNo: required('TRANSFER_ACCOUNT_NO'),
      bank: optional('BENEFICIARY_BANK'),
      counterpartyAccountNo: required('BENEFICIARY_ACCOUNT_NO'),
      amount: optional('TRANSFER_AMOUNT') ?? '1000',
      purpose: optional('TRANSFER_PURPOSE') ?? 'Playwright automated test',
    };
  },
  get dr(): TransferData {
    const cr = this.cr;
    return {
      accountNo: optional('DR_ACCOUNT_NO') ?? cr.accountNo,
      bank: optional('PAYER_BANK') ?? cr.bank,
      counterpartyAccountNo: optional('PAYER_ACCOUNT_NO') ?? cr.counterpartyAccountNo,
      amount: optional('DR_AMOUNT') ?? cr.amount,
      purpose: cr.purpose,
    };
  },
};

/**
 * Values the app keeps in localStorage for the logged-in maker (saved by auth.setup.ts in
 * playwright/.auth/user.json), e.g. SortCode = "103150019", BranchName = "HEAD OFFICE BRANCH".
 */
export function sessionValue(name: string): string | undefined {
  try {
    const file = require('path').join(__dirname, '..', 'playwright', '.auth', 'user.json');
    const state = JSON.parse(require('fs').readFileSync(file, 'utf8'));
    for (const origin of state.origins ?? []) {
      const hit = (origin.localStorage ?? []).find((e: { name: string }) => e.name === name);
      if (hit) return String(hit.value);
    }
  } catch { /* not logged in yet */ }
  return undefined;
}

/**
 * Bank code / receiving sort code for generated inward files: INWARD_SORT_CODE / INWARD_BANK_CODE
 * if set, else the logged-in branch's sort code (so items show up for that branch) and its first
 * 3 digits as the bank code.
 */
export const inwardSortCode = () => process.env.INWARD_SORT_CODE || sessionValue('SortCode') || '033150000';
export const inwardBankCode = () => process.env.INWARD_BANK_CODE || inwardSortCode().slice(0, 3);
