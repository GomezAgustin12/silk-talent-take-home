import { WorkflowService } from '../workflow.service';
import { WorkflowPersistence } from '../engine/workflow-persistence';
import { StepDefinition } from '../types/workflow.types';
import { createInterviewStepDefinitions } from '../steps/interview-steps';

function withExecutionLog(
  stepDefs: StepDefinition[],
  log: string[],
): StepDefinition[] {
  return stepDefs.map((def) => ({
    ...def,
    execute: async () => {
      log.push(def.id);
      return def.execute();
    },
  }));
}

describe('Workflow Resume After Crash', () => {
  let persistence: WorkflowPersistence;
  let service: WorkflowService;

  beforeEach(() => {
    persistence = new WorkflowPersistence();
    service = new WorkflowService(persistence);
    persistence.clear();
  });

  afterAll(() => {
    persistence.clear();
  });

  it('should resume from the last completed step after a simulated crash', async () => {
    const firstRunLog: string[] = [];

    const initialSteps = createInterviewStepDefinitions();
    const workflow = service.createWorkflow('Interview Workflow', initialSteps);
    expect(workflow.steps).toHaveLength(5);
    expect(workflow.status).toBe('pending');

    const crashingSteps = withExecutionLog(
      createInterviewStepDefinitions({
        failAtStep: 'update-crm',
        failType: 'fatal',
      }),
      firstRunLog,
    );

    const crashedWorkflow = await service.run(workflow.id, crashingSteps);
    expect(crashedWorkflow.status).toBe('failed');
    expect(crashedWorkflow.steps[0].status).toBe('completed');
    expect(crashedWorkflow.steps[1].status).toBe('failed');
    expect(crashedWorkflow.steps[2].status).toBe('pending');
    expect(crashedWorkflow.steps[3].status).toBe('pending');
    expect(crashedWorkflow.steps[4].status).toBe('pending');
    expect(firstRunLog).toEqual(['check-calendar', 'update-crm']);

    const persisted = persistence.load(workflow.id);
    expect(persisted).not.toBeNull();
    expect(persisted!.steps[0].status).toBe('completed');
    expect(persisted!.steps[1].status).toBe('failed');

    const freshPersistence = new WorkflowPersistence();
    const freshService = new WorkflowService(freshPersistence);
    const recovered = freshPersistence.load(workflow.id);
    expect(recovered).not.toBeNull();

    for (const step of recovered!.steps) {
      if (step.status === 'failed' || step.status === 'in_progress') {
        step.status = 'pending';
        step.startedAt = null;
        step.error = null;
      }
    }
    freshPersistence.save(recovered!);

    const resumeLog: string[] = [];
    const cleanSteps = withExecutionLog(
      createInterviewStepDefinitions(),
      resumeLog,
    );
    const resumed = await freshService.run(workflow.id, cleanSteps);

    expect(resumed.status).toBe('completed');
    expect(resumed.steps.every((s) => s.status === 'completed')).toBe(true);
    expect(resumeLog).toEqual([
      'update-crm',
      'send-confirmation',
      'prepare-interview-kit',
      'notify-interviewer',
    ]);
  });

  it('should handle transient errors with retries', async () => {
    const steps = createInterviewStepDefinitions({
      failAtStep: 'check-calendar',
      failType: 'transient',
      transientFailCount: 2,
    });

    const workflow = service.createWorkflow('Retry Test', steps);
    const result = await service.run(workflow.id, steps);

    expect(result.status).toBe('completed');
    expect(result.steps[0].status).toBe('completed');
    expect(result.steps[0].retryCount).toBe(2);
  });

  it('should stop on fatal errors without retrying', async () => {
    const steps = createInterviewStepDefinitions({
      failAtStep: 'check-calendar',
      failType: 'fatal',
    });

    const workflow = service.createWorkflow('Fatal Test', steps);
    const result = await service.run(workflow.id, steps);

    expect(result.status).toBe('failed');
    expect(result.steps[0].status).toBe('failed');
    expect(result.steps[0].error?.type).toBe('fatal');
    expect(result.steps[0].retryCount).toBe(0);
  });

  it('should persist state after each step completion', async () => {
    const baseSteps = createInterviewStepDefinitions();

    const completedCountsPerSave: number[] = [];
    const originalSave = persistence.save.bind(persistence);
    jest.spyOn(persistence, 'save').mockImplementation((wf) => {
      completedCountsPerSave.push(
        wf.steps.filter((s) => s.status === 'completed').length,
      );
      originalSave(wf);
    });

    const workflow = service.createWorkflow('Persistence Test', baseSteps);
    completedCountsPerSave.length = 0;

    await service.run(workflow.id, baseSteps);

    const final = persistence.load(workflow.id);
    expect(final!.status).toBe('completed');
    for (const step of final!.steps) {
      expect(step.status).toBe('completed');
      expect(step.output).not.toBeNull();
    }

    expect(completedCountsPerSave).toEqual(
      expect.arrayContaining([1, 2, 3, 4, 5]),
    );
  });

  it('should run the full interview workflow in declared order', async () => {
    const log: string[] = [];
    const steps = withExecutionLog(createInterviewStepDefinitions(), log);

    const workflow = service.createWorkflow('Happy Path', steps);
    const result = await service.run(workflow.id, steps);

    expect(result.status).toBe('completed');
    expect(log).toEqual([
      'check-calendar',
      'update-crm',
      'send-confirmation',
      'prepare-interview-kit',
      'notify-interviewer',
    ]);
  });
});
