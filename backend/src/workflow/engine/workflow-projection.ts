import { Workflow, StepError, ErrorType } from '../types/workflow.types';

function now(): string {
  return new Date().toISOString();
}

export function applyStepStarted(wf: Workflow, stepIndex: number): void {
  wf.status = 'running';
  wf.currentStepIndex = stepIndex;
  const step = wf.steps[stepIndex];
  step.status = 'in_progress';
  step.startedAt = now();
  step.error = null;
  wf.updatedAt = now();
}

export function applyStepCompleted(
  wf: Workflow,
  stepIndex: number,
  output: Record<string, unknown>,
  retryCount: number,
): void {
  const step = wf.steps[stepIndex];
  step.status = 'completed';
  step.completedAt = now();
  step.output = output;
  step.retryCount = retryCount;
  step.error = null;
  wf.updatedAt = now();
}

export function applyStepFailed(
  wf: Workflow,
  stepIndex: number,
  err: { message: string; type: ErrorType; attempt: number },
): void {
  const step = wf.steps[stepIndex];
  step.status = 'failed';
  step.retryCount = err.attempt;
  const error: StepError = {
    message: err.message,
    type: err.type,
    occurredAt: now(),
    attempt: err.attempt + 1,
  };
  step.error = error;
  wf.status = 'failed';
  wf.error = `Step "${step.name}" failed: ${err.type === 'fatal' ? '[FATAL] ' : 'Max retries exceeded. '}${err.message}`;
  wf.updatedAt = now();
}

export function applyWorkflowCompleted(wf: Workflow): void {
  wf.status = 'completed';
  wf.completedAt = now();
  wf.updatedAt = now();
}
