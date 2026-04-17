import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createActor, waitFor, fromPromise, AnyActorLogic } from 'xstate';
import { WorkflowPersistence } from './engine/workflow-persistence';
import {
  buildInterviewMachine,
  STEP_META,
  STEP_META_BY_ID,
  StateName,
} from './engine/workflow-chart';
import { createInterviewStepDefinitions } from './steps/interview-steps';
import {
  Workflow,
  WorkflowStep,
  StepDefinition,
  StepStatus,
  CreateWorkflowDto,
} from './types/workflow.types';

@Injectable()
export class WorkflowService {
  private readonly logger = new Logger(WorkflowService.name);

  constructor(private readonly persistence: WorkflowPersistence) {}

  create(dto: CreateWorkflowDto): Workflow {
    return this.createWorkflow(dto.name, createInterviewStepDefinitions());
  }

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
    this.logger.log(
      `Created workflow "${name}" (${workflow.id}) with ${steps.length} steps`,
    );
    return workflow;
  }

  async run(
    workflowId: string,
    stepDefinitions?: StepDefinition[],
  ): Promise<Workflow> {
    const workflow = this.persistence.load(workflowId);
    if (!workflow) {
      throw new NotFoundException(`Workflow ${workflowId} not found`);
    }

    if (workflow.status === 'completed') return workflow;

    const stepDefs = stepDefinitions ?? createInterviewStepDefinitions();
    const actors = this.buildActorMap(stepDefs);

    const firstPendingIndex = workflow.steps.findIndex(
      (s) => s.status !== 'completed',
    );
    if (firstPendingIndex === -1) return workflow;

    const startState = this.stateNameForIndex(firstPendingIndex);

    if (firstPendingIndex > 0) {
      this.logger.log(
        `Resuming workflow ${workflowId} from "${startState}" (step ${firstPendingIndex})`,
      );
    }

    const persist = (wf: Workflow) => this.persistence.save(wf);
    const machine = buildInterviewMachine(actors);

    const actor = createActor(machine, {
      input: { workflow, persist, startAt: startState },
    });
    actor.start();

    const finalSnapshot = await waitFor(actor, (s) => s.status === 'done', {
      timeout: 120_000,
    });

    const result = finalSnapshot.context.workflow;
    if (result.status === 'completed') {
      this.logger.log(`Workflow ${workflowId} completed`);
    } else {
      this.logger.error(`Workflow ${workflowId} failed: ${result.error}`);
    }

    return result;
  }

  async resume(workflowId: string): Promise<Workflow> {
    const workflow = this.persistence.load(workflowId);
    if (!workflow) {
      throw new NotFoundException(`Workflow ${workflowId} not found`);
    }

    if (workflow.status === 'completed') return workflow;

    for (const step of workflow.steps) {
      if (step.status === 'in_progress' || step.status === 'failed') {
        step.status = 'pending';
        step.startedAt = null;
        step.error = null;
      }
    }
    this.persistence.save(workflow);

    return this.run(workflowId);
  }

  findAll(): Workflow[] {
    return this.persistence.loadAll();
  }

  findOne(workflowId: string): Workflow {
    const workflow = this.persistence.load(workflowId);
    if (!workflow) {
      throw new NotFoundException(`Workflow ${workflowId} not found`);
    }
    return workflow;
  }

  remove(workflowId: string): void {
    if (!this.persistence.delete(workflowId)) {
      throw new NotFoundException(`Workflow ${workflowId} not found`);
    }
  }

  private buildActorMap(
    stepDefs: StepDefinition[],
  ): Record<StateName, AnyActorLogic> {
    const actors = {} as Record<StateName, AnyActorLogic>;
    const entries = Object.entries(STEP_META) as [
      StateName,
      (typeof STEP_META)[StateName],
    ][];
    for (const [stateName, meta] of entries) {
      const def = stepDefs.find((d) => d.id === meta.id);
      if (!def) {
        throw new Error(
          `Missing step definition for "${meta.id}" (state "${stateName}")`,
        );
      }
      actors[stateName] = fromPromise(async () => def.execute());
    }
    return actors;
  }

  private stateNameForIndex(index: number): StateName {
    for (const meta of STEP_META_BY_ID.values()) {
      if (meta.index === index) return meta.state;
    }
    throw new Error(`No chart state maps to step index ${index}`);
  }
}
