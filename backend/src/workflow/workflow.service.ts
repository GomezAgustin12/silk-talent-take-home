import { Injectable, NotFoundException } from '@nestjs/common';
import { WorkflowEngine } from './engine/workflow-engine';
import { WorkflowPersistence } from './engine/workflow-persistence';
import { createInterviewStepDefinitions } from './steps/interview-steps';
import { Workflow, CreateWorkflowDto } from './types/workflow.types';

@Injectable()
export class WorkflowService {
  constructor(
    private readonly engine: WorkflowEngine,
    private readonly persistence: WorkflowPersistence,
  ) {}

  create(dto: CreateWorkflowDto): Workflow {
    const stepDefs = createInterviewStepDefinitions();
    return this.engine.createWorkflow(dto.name, stepDefs);
  }

  async run(workflowId: string): Promise<Workflow> {
    const stepDefs = createInterviewStepDefinitions();
    return this.engine.run(workflowId, stepDefs);
  }

  async resume(workflowId: string): Promise<Workflow> {
    const workflow = this.persistence.load(workflowId);
    if (!workflow) {
      throw new NotFoundException(`Workflow ${workflowId} not found`);
    }

    if (workflow.status === 'completed') {
      return workflow;
    }

    // Reset any in_progress steps back to pending (crash recovery)
    for (const step of workflow.steps) {
      if (step.status === 'in_progress') {
        step.status = 'pending';
        step.startedAt = null;
      }
    }
    this.persistence.save(workflow);

    const stepDefs = createInterviewStepDefinitions();
    return this.engine.run(workflowId, stepDefs);
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
    const deleted = this.persistence.delete(workflowId);
    if (!deleted) {
      throw new NotFoundException(`Workflow ${workflowId} not found`);
    }
  }
}
