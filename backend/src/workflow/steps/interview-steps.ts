import { StepDefinition } from '../types/workflow.types';

/**
 * Simulates the multi-step workflow that runs during a live interview.
 * Each step mocks real async work (API calls, CRM updates, etc.)
 * with configurable delays and failure modes for testing.
 */

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createInterviewStepDefinitions(options?: {
  failAtStep?: string;
  failType?: 'transient' | 'fatal';
  transientFailCount?: number;
}): StepDefinition[] {
  let transientAttempts = 0;

  return [
    {
      id: 'check-calendar',
      name: 'Check Calendar Availability',
      maxRetries: 3,
      execute: async () => {
        await delay(300);
        if (options?.failAtStep === 'check-calendar') {
          if (options.failType === 'fatal') {
            throw new Error('PERMISSION_DENIED: No access to calendar API');
          }
          transientAttempts++;
          if (transientAttempts <= (options.transientFailCount ?? 1)) {
            throw new Error('Calendar API timeout');
          }
        }
        return {
          available: true,
          nextSlot: '2025-01-15T14:00:00Z',
          timezone: 'America/New_York',
        };
      },
    },
    {
      id: 'update-crm',
      name: 'Update CRM Record',
      maxRetries: 3,
      execute: async () => {
        await delay(400);
        if (options?.failAtStep === 'update-crm') {
          if (options.failType === 'fatal') {
            throw new Error('VALIDATION_ERROR: Missing required field "email"');
          }
          transientAttempts++;
          if (transientAttempts <= (options.transientFailCount ?? 1)) {
            throw new Error('CRM database connection lost');
          }
        }
        return {
          crmRecordId: 'CRM-2024-1234',
          status: 'interview_scheduled',
          updatedFields: ['status', 'next_interview_date', 'interviewer'],
        };
      },
    },
    {
      id: 'send-confirmation',
      name: 'Send Confirmation Email',
      maxRetries: 2,
      execute: async () => {
        await delay(350);
        if (options?.failAtStep === 'send-confirmation') {
          if (options.failType === 'fatal') {
            throw new Error('INVALID_CREDENTIALS: SMTP auth failed');
          }
          transientAttempts++;
          if (transientAttempts <= (options.transientFailCount ?? 1)) {
            throw new Error('SMTP server temporarily unavailable');
          }
        }
        return {
          emailId: 'msg-abc123',
          recipient: 'candidate@example.com',
          template: 'interview-confirmation',
          sentAt: new Date().toISOString(),
        };
      },
    },
    {
      id: 'prepare-interview-kit',
      name: 'Prepare Interview Kit',
      maxRetries: 2,
      execute: async () => {
        await delay(500);
        if (options?.failAtStep === 'prepare-interview-kit') {
          if (options.failType === 'fatal') {
            throw new Error('NOT_FOUND: Interview template does not exist');
          }
          transientAttempts++;
          if (transientAttempts <= (options.transientFailCount ?? 1)) {
            throw new Error('Document generation service unavailable');
          }
        }
        return {
          kitId: 'kit-xyz789',
          documents: ['resume.pdf', 'job-description.pdf', 'scorecard.pdf'],
          interviewGuide: 'behavioral-senior-engineer-v2',
        };
      },
    },
    {
      id: 'notify-interviewer',
      name: 'Notify Interviewer',
      maxRetries: 3,
      execute: async () => {
        await delay(250);
        if (options?.failAtStep === 'notify-interviewer') {
          if (options.failType === 'fatal') {
            throw new Error('FATAL: Notification service is down');
          }
          transientAttempts++;
          if (transientAttempts <= (options.transientFailCount ?? 1)) {
            throw new Error('Slack API rate limited');
          }
        }
        return {
          notificationId: 'notif-456',
          channel: 'slack',
          interviewer: 'john.doe@silkchart.com',
          sentAt: new Date().toISOString(),
        };
      },
    },
  ];
}
