import { neftOutwardTest } from '../../flows/neftOutward';

// Maker creates a NEFT Outward Transfer(DR); approver opens its Details under
// Approval > Pending Transfers and DISAPPROVES it.
neftOutwardTest('DR', 'disapprove');
