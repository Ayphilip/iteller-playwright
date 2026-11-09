import { chequeOutwardTest } from '../../flows/chequeOutward';

// Maker scans an outward cheque via Transactions > Scan Outward Cheque(Web) (account validated on the CBA);
// approver opens it under Approval > Approve Outward Cheque and DISAPPROVES it.
chequeOutwardTest('Web', 'disapprove');
