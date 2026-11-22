import { logger } from '../config/logger';

export interface Notifier {
  sendEmail(to: string, subject: string, body: string): Promise<void>;
}

// Console-backed implementation. Swap for a real provider (SES/Postgres-backed
// outbox/Resend/etc.) by implementing the same Notifier interface — nothing
// else in the codebase depends on this file beyond the interface.
export const notifier: Notifier = {
  async sendEmail(to, subject, body) {
    logger.info({ to, subject, body }, '📧 email dispatched (console-backed notifier)');
  },
};
