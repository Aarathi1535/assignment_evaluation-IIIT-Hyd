/**
 * Email Adapter and Stub Implementation (AE-192)
 *
 * Provides a lightweight email dispatch interface for student notifications.
 * In environments where external SMTP or cloud mailing infrastructure (e.g., SES, SendGrid)
 * is not configured, StubEmailAdapter records sent emails in-memory and succeeds gracefully.
 */

export interface SendEmailPayload {
    to: string;
    subject: string;
    text: string;
    html?: string;
}

export interface EmailAdapter {
    sendMail(payload: SendEmailPayload): Promise<{ success: boolean; messageId?: string }>;
}

export class StubEmailAdapter implements EmailAdapter {
    private sentEmails: SendEmailPayload[] = [];
    private sentCount = 0;

    async sendMail(payload: SendEmailPayload): Promise<{ success: boolean; messageId?: string }> {
        if (!payload.to) {
            throw new Error('Recipient email address is required');
        }

        this.sentCount++;
        // Retain email payloads in memory only in test environment for assertion verification
        if (process.env.NODE_ENV === 'test') {
            this.sentEmails.push({ ...payload });
        }

        return {
            success: true,
            messageId: `stub-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        };
    }

    getSentEmails(): SendEmailPayload[] {
        return [...this.sentEmails];
    }

    getSentCount(): number {
        return this.sentCount;
    }

    clear(): void {
        this.sentEmails = [];
        this.sentCount = 0;
    }
}

export const emailAdapter = new StubEmailAdapter();
export default emailAdapter;

