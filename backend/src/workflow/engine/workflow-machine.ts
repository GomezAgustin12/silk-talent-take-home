import { setup, assign, fromPromise, AnyActorRef } from 'xstate';
import {
  Workflow,
  WorkflowStep,
  StepDefinition,
  ErrorType,
} from '../types/workflow.types';

// ── Helpers ──────────────────────────────────────────────

const FATAL_PATTERNS = [
  'INVALID_CREDENTIALS',
  'PERMISSION_DENIED',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'FATAL',
];

function classifyError(message: string): ErrorType {
  const upper = message.toUpperCase();
  return FATAL_PATTERNS.some((p) => upper.includes(p)) ? 'fatal' : 'transient';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Types ────────────────────────────────────────────────

export interface WorkflowMachineContext {
  workflow: Workflow;
  stepDefinitions: StepDefinition[];
  persistFn: (workflow: Workflow) => void;
}

type WorkflowMachineEvent =
  | { type: 'START' }
  | { type: 'STEP_COMPLETED'; output: Record<string, unknown> }
  | { type: 'STEP_FAILED'; error: Error };

// ── Step execution actor ─────────────────────────────────

const executeStep = fromPromise(
  async ({
    input,
  }: {
    input: {
      step: WorkflowStep;
      stepDef: StepDefinition;
    };
  }) => {
    const { step, stepDef } = input;

    for (let attempt = 0; attempt <= step.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          // Exponential backoff: 100ms, 200ms, 400ms...
          await delay(100 * Math.pow(2, attempt - 1));
        }

        const output = await stepDef.execute();
        return { output, retryCount: attempt };
      } catch (err) {
        const error = err as Error;
        const errorType = classifyError(error.message);

        if (errorType === 'fatal') {
          throw {
            message: error.message,
            type: 'fatal' as const,
            attempt,
          };
        }

        // Transient: retry unless we're at the last attempt
        if (attempt === step.maxRetries) {
          throw {
            message: error.message,
            type: 'transient' as const,
            attempt,
          };
        }

        // Continue to next retry attempt
      }
    }

    // Should never reach here, but TypeScript wants a return
    throw { message: 'Unexpected end of retry loop', type: 'fatal' as const, attempt: 0 };
  },
);

// ── Machine ──────────────────────────────────────────────

export const workflowMachine = setup({
  types: {
    context: {} as WorkflowMachineContext,
    input: {} as WorkflowMachineContext,
    events: {} as WorkflowMachineEvent,
  },
  actors: {
    executeStep,
  },
  actions: {
    persist: ({ context }) => {
      context.persistFn(context.workflow);
    },
    markWorkflowRunning: assign({
      workflow: ({ context }) => {
        const wf = { ...context.workflow };
        // Find resume point
        const resumeIndex = wf.steps.findIndex((s) => s.status !== 'completed');
        wf.status = 'running';
        wf.currentStepIndex = resumeIndex === -1 ? 0 : resumeIndex;
        wf.updatedAt = new Date().toISOString();
        return wf;
      },
    }),
    markStepInProgress: assign({
      workflow: ({ context }) => {
        const wf = { ...context.workflow };
        const step = wf.steps[wf.currentStepIndex];
        step.status = 'in_progress';
        step.startedAt = new Date().toISOString();
        wf.updatedAt = new Date().toISOString();
        return wf;
      },
    }),
    markStepCompleted: assign({
      workflow: ({ context, event }) => {
        const wf = { ...context.workflow };
        const step = wf.steps[wf.currentStepIndex];
        const output = (event as any).output;
        step.status = 'completed';
        step.completedAt = new Date().toISOString();
        step.output = output.output;
        step.retryCount = output.retryCount;
        step.error = null;
        wf.updatedAt = new Date().toISOString();
        return wf;
      },
    }),
    advanceToNextStep: assign({
      workflow: ({ context }) => {
        const wf = { ...context.workflow };
        wf.currentStepIndex += 1;
        wf.updatedAt = new Date().toISOString();
        return wf;
      },
    }),
    markWorkflowCompleted: assign({
      workflow: ({ context }) => {
        const wf = { ...context.workflow };
        wf.status = 'completed';
        wf.completedAt = new Date().toISOString();
        wf.updatedAt = new Date().toISOString();
        return wf;
      },
    }),
    markWorkflowFailed: assign({
      workflow: ({ context, event }) => {
        const wf = { ...context.workflow };
        const step = wf.steps[wf.currentStepIndex];
        const errData = (event as any).error;

        step.status = 'failed';
        step.retryCount = errData.attempt ?? 0;
        step.error = {
          message: errData.message ?? String(errData),
          type: errData.type ?? 'fatal',
          occurredAt: new Date().toISOString(),
          attempt: (errData.attempt ?? 0) + 1,
        };

        wf.status = 'failed';
        wf.error = `Step "${step.name}" failed: ${errData.type === 'fatal' ? '[FATAL] ' : 'Max retries exceeded. '}${errData.message}`;
        wf.updatedAt = new Date().toISOString();
        return wf;
      },
    }),
  },
  guards: {
    hasMoreSteps: ({ context }) => {
      return context.workflow.currentStepIndex < context.workflow.steps.length - 1;
    },
    isAlreadyCompleted: ({ context }) => {
      return context.workflow.steps.every((s) => s.status === 'completed');
    },
  },
}).createMachine({
  id: 'workflow',
  initial: 'idle',
  context: ({ input }) => input,
  states: {
    idle: {
      on: {
        START: [
          {
            guard: 'isAlreadyCompleted',
            target: 'completed',
            actions: ['markWorkflowCompleted', 'persist'],
          },
          {
            target: 'executingStep',
            actions: ['markWorkflowRunning', 'persist', 'markStepInProgress', 'persist'],
          },
        ],
      },
    },

    executingStep: {
      invoke: {
        src: 'executeStep',
        input: ({ context }) => {
          const step = context.workflow.steps[context.workflow.currentStepIndex];
          const stepDef = context.stepDefinitions.find((d) => d.id === step.id)!;
          return { step, stepDef };
        },
        onDone: {
          target: 'stepCompleted',
          actions: ['markStepCompleted', 'persist'],
        },
        onError: {
          target: 'failed',
          actions: ['markWorkflowFailed', 'persist'],
        },
      },
    },

    stepCompleted: {
      always: [
        {
          guard: 'hasMoreSteps',
          target: 'executingStep',
          actions: ['advanceToNextStep', 'markStepInProgress', 'persist'],
        },
        {
          target: 'completed',
          actions: ['markWorkflowCompleted', 'persist'],
        },
      ],
    },

    completed: {
      type: 'final',
    },

    failed: {
      type: 'final',
    },
  },
});
