import { chequeOutwardTest } from '../../flows/chequeOutward';

// Maker scans an outward cheque via Transactions > Scan Outward Cheque(Lite) (no validation);
// approver opens it under Approval > Approve Outward Cheque and APPROVES it.
chequeOutwardTest('Lite', 'approve');
