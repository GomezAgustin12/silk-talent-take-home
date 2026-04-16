import { WorkflowEngine } from '../engine/workflow-engine';
import { WorkflowPersistence } from '../engine/workflow-persistence';
import { StepDefinition } from '../types/workflow.types';
import * as fs from 'fs';
import * as path from 'path';

describe('Workflow Resume After Crash', () => {
  let persistence: WorkflowPersistence;
  let engine: WorkflowEngine;
  const dataDir = path.join(process.cwd(), 'data');

  beforeEach(() => {
    persistence = new WorkflowPersistence();
    engine = new WorkflowEngine(persistence);
    persistence.clear();
  });

  afterAll(() => {
    persistence.clear();
  });

  function createTestSteps(options?: {
    executionLog?: string[];
    crashAtStep?: string;
  }): StepDefinition[] {
    const log = options?.executionLog ?? [];

    return [
      {
        id: 'step-1',
        name: 'Check Calendar',
        maxRetries: 0,
        execute: async () => {
          log.push('step-1');
          return { done: true };
        },
      },
      {
        id: 'step-2',
        name: 'Update CRM',
        maxRetries: 0,
        execute: async () => {
          if (options?.crashAtStep === 'step-2') {
            throw new Error('SIMULATED CRASH');
          }
          log.push('step-2');
          return { done: true };
        },
      },
      {
        id: 'step-3',
        name: 'Send Email',
        maxRetries: 0,
        execute: async () => {
          log.push('step-3');
          return { done: true };
        },
      },
    ];
  }

  it('should resume from the last completed step after a simulated crash', async () => {
    const executionLog: string[] = [];

    // 1. Create a workflow
    const stepsForCreate = createTestSteps();
    const workflow = engine.createWorkflow('Test Interview', stepsForCreate);
    expect(workflow.steps).toHaveLength(3);
    expect(workflow.status).toBe('pending');

    // 2. Run the workflow but simulate a crash at step-2
    const crashSteps = createTestSteps({
      executionLog,
      crashAtStep: 'step-2',
    });

    // The engine will catch the crash as a fatal error and stop
    const crashedWorkflow = await engine.run(workflow.id, crashSteps);
    expect(crashedWorkflow.status).toBe('failed');
    expect(crashedWorkflow.steps[0].status).toBe('completed');
    expect(crashedWorkflow.steps[1].status).toBe('failed');
    expect(crashedWorkflow.steps[2].status).toBe('pending');
    expect(executionLog).toEqual(['step-1']); // Only step-1 ran successfully

    // 3. Verify state was persisted to disk
    const persisted = persistence.load(workflow.id);
    expect(persisted).not.toBeNull();
    expect(persisted!.steps[0].status).toBe('completed');
    expect(persisted!.steps[1].status).toBe('failed');

    // 4. Simulate server restart: create fresh engine instances
    const freshPersistence = new WorkflowPersistence();
    const freshEngine = new WorkflowEngine(freshPersistence);

    // 5. Load the workflow from disk (as would happen after a crash/restart)
    const recoveredWorkflow = freshPersistence.load(workflow.id);
    expect(recoveredWorkflow).not.toBeNull();

    // 6. Reset failed step and resume
    for (const step of recoveredWorkflow!.steps) {
      if (step.status === 'failed' || step.status === 'in_progress') {
        step.status = 'pending';
        step.startedAt = null;
        step.error = null;
      }
    }
    freshPersistence.save(recoveredWorkflow!);

    // 7. Resume with working steps (no crash this time)
    const resumeLog: string[] = [];
    const resumeSteps = createTestSteps({ executionLog: resumeLog });
    const resumedWorkflow = await freshEngine.run(workflow.id, resumeSteps);

    // 8. Verify: step-1 was NOT re-executed, only step-2 and step-3 ran
    expect(resumedWorkflow.status).toBe('completed');
    expect(resumedWorkflow.steps[0].status).toBe('completed');
    expect(resumedWorkflow.steps[1].status).toBe('completed');
    expect(resumedWorkflow.steps[2].status).toBe('completed');
    expect(resumeLog).toEqual(['step-2', 'step-3']); // step-1 was skipped!
  });

  it('should handle transient errors with retries', async () => {
    let attempt = 0;

    const steps: StepDefinition[] = [
      {
        id: 'flaky-step',
        name: 'Flaky API Call',
        maxRetries: 3,
        execute: async () => {
          attempt++;
          if (attempt <= 2) {
            throw new Error('Connection timeout'); // transient
          }
          return { attempt };
        },
      },
    ];

    const workflow = engine.createWorkflow('Retry Test', steps);
    const result = await engine.run(workflow.id, steps);

    expect(result.status).toBe('completed');
    expect(result.steps[0].status).toBe('completed');
    expect(result.steps[0].retryCount).toBe(2); // succeeded on 3rd attempt
  });

  it('should stop on fatal errors without retrying', async () => {
    const steps: StepDefinition[] = [
      {
        id: 'fatal-step',
        name: 'Bad Credentials',
        maxRetries: 3,
        execute: async () => {
          throw new Error('INVALID_CREDENTIALS: API key is invalid');
        },
      },
    ];

    const workflow = engine.createWorkflow('Fatal Test', steps);
    const result = await engine.run(workflow.id, steps);

    expect(result.status).toBe('failed');
    expect(result.steps[0].status).toBe('failed');
    expect(result.steps[0].error?.type).toBe('fatal');
    expect(result.steps[0].retryCount).toBe(0); // no retries for fatal
  });

  it('should persist state after each step completion', async () => {
    const steps: StepDefinition[] = [
      {
        id: 'step-a',
        name: 'Step A',
        maxRetries: 0,
        execute: async () => ({ result: 'a' }),
      },
      {
        id: 'step-b',
        name: 'Step B',
        maxRetries: 0,
        execute: async () => {
          // Check that step-a was already persisted
          const saved = persistence.load(workflow.id);
          expect(saved!.steps[0].status).toBe('completed');
          return { result: 'b' };
        },
      },
    ];

    const workflow = engine.createWorkflow('Persistence Test', steps);
    await engine.run(workflow.id, steps);

    const final = persistence.load(workflow.id);
    expect(final!.status).toBe('completed');
    expect(final!.steps[0].output).toEqual({ result: 'a' });
    expect(final!.steps[1].output).toEqual({ result: 'b' });
  });
});
