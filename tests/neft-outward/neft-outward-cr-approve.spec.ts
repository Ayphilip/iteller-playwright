import { neftOutwardTest } from '../../flows/neftOutward';

// Maker creates a NEFT Outward Transfer(CR); approver opens its Details under
// Approval > Pending Transfers and APPROVES it.
neftOutwardTest('CR', 'approve');
