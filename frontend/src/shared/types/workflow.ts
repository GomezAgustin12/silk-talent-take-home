export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';

export type WorkflowStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused';

export type ErrorType = 'transient' | 'fatal';

export interface StepError {
  message: string;
  type: ErrorType;
  occurredAt: string;
  attempt: number;
}

export interface WorkflowStep {
  id: string;
  name: string;
  status: StepStatus;
  startedAt: string | null;
  completedAt: string | null;
  error: StepError | null;
  retryCount: number;
  maxRetries: number;
  output: Record<string, unknown> | null;
}

export interface Workflow {
  id: string;
  name: string;
  status: WorkflowStatus;
  currentStepIndex: number;
  steps: WorkflowStep[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  error: string | null;
}
