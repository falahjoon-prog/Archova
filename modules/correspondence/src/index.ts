// Public interface of @archova/mod-correspondence.
export { createCorrespondenceModule, type CorrespondenceModule } from './module';
export { CORRESPONDENCE_PERMISSIONS } from './permissions';
export { claimItemEmails, finishItemEmails, type QueuedItemEmail } from './application/emails';
