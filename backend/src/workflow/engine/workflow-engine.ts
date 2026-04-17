import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createActor, waitFor } from 'xstate';
import { WorkflowPersistence } from './workflow-persistence';
import { workflowMachine, WorkflowMachineContext } from './workflow-machine';
import {
  Workflow,
  WorkflowStep,
  StepDefinition,
  StepStatus,
} from '../types/workflow.types';

@Injectable()
export class WorkflowEngine {
  private readonly logger = new Logger(WorkflowEngine.name);

  constructor(private readonly persistence: WorkflowPersistence) {}

  createWorkflow(name: string, stepDefinitions: StepDefinition[]): Workflow {
    const now = new Date().toISOString();
    const steps: WorkflowStep[] = stepDefinitions.map((def) => ({
      id: def.id,
      name: def.name,
      status: 'pending' as StepStatus,
      startedAt: null,
      completedAt: null,
      error: null,
      retryCount: 0,
      maxRetries: def.maxRetries,
      output: null,
    }));

    const workflow: Workflow = {
      id: randomUUID(),
      name,
      status: 'pending',
      currentStepIndex: 0,
      steps,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      error: null,
    };

    this.persistence.save(workflow);
    this.logger.log(`Created workflow "${name}" (${workflow.id}) with ${steps.length} steps`);
    return workflow;
  }

  async run(
    workflowId: string,
    stepDefinitions: StepDefinition[],
  ): Promise<Workflow> {
    const workflow = this.persistence.load(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const resumeIndex = workflow.steps.findIndex((s) => s.status !== 'completed');
    if (resumeIndex > 0) {
      this.logger.log(
        `Resuming workflow ${workflowId} from step ${resumeIndex} ("${workflow.steps[resumeIndex].name}")`,
      );
    }

    const input: WorkflowMachineContext = {
      workflow: { ...workflow },
      stepDefinitions,
      persistFn: (wf: Workflow) => {
        this.persistence.save(wf);
        this.logger.debug(`Persisted workflow ${wf.id} (status: ${wf.status})`);
      },
    };

    const actor = createActor(workflowMachine, { input });
    actor.start();
    actor.send({ type: 'START' });

    // Wait for the machine to reach a final state
    const snapshot = await waitFor(actor, (s) => s.status === 'done', {
      timeout: 120_000,
    });

    const finalWorkflow = snapshot.context.workflow;

    if (finalWorkflow.status === 'completed') {
      this.logger.log(`Workflow ${workflowId} completed successfully`);
    } else if (finalWorkflow.status === 'failed') {
      this.logger.error(`Workflow ${workflowId} failed: ${finalWorkflow.error}`);
    }

    return finalWorkflow;
  }
}
