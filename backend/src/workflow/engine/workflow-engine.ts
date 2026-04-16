import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { WorkflowPersistence } from './workflow-persistence';
import {
  Workflow,
  WorkflowStep,
  StepDefinition,
  StepStatus,
  ErrorType,
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
    let workflow = this.persistence.load(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    // Find the first non-completed step to resume from
    const resumeIndex = workflow.steps.findIndex(
      (s) => s.status !== 'completed',
    );

    if (resumeIndex === -1) {
      this.logger.log(`Workflow ${workflowId} already completed`);
      return workflow;
    }

    if (resumeIndex > 0) {
      this.logger.log(
        `Resuming workflow ${workflowId} from step ${resumeIndex} ("${workflow.steps[resumeIndex].name}")`,
      );
    }

    workflow.status = 'running';
    workflow.currentStepIndex = resumeIndex;
    workflow.updatedAt = new Date().toISOString();
    this.persistence.save(workflow);

    for (let i = resumeIndex; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];
      const stepDef = stepDefinitions.find((d) => d.id === step.id);
      if (!stepDef) {
        throw new Error(`Step definition not found for "${step.id}"`);
      }

      workflow.currentStepIndex = i;
      step.status = 'in_progress';
      step.startedAt = new Date().toISOString();
      workflow.updatedAt = new Date().toISOString();
      this.persistence.save(workflow);

      const result = await this.executeStep(step, stepDef);

      if (result.success) {
        step.status = 'completed';
        step.completedAt = new Date().toISOString();
        step.output = result.output;
        step.error = null;
        workflow.updatedAt = new Date().toISOString();
        this.persistence.save(workflow);
        this.logger.log(`Step "${step.name}" completed`);
      } else {
        // Step failed fatally — stop workflow
        workflow.status = 'failed';
        workflow.error = `Step "${step.name}" failed: ${result.errorMessage}`;
        workflow.updatedAt = new Date().toISOString();
        this.persistence.save(workflow);
        this.logger.error(`Workflow ${workflowId} failed at step "${step.name}": ${result.errorMessage}`);
        return workflow;
      }
    }

    workflow.status = 'completed';
    workflow.completedAt = new Date().toISOString();
    workflow.updatedAt = new Date().toISOString();
    this.persistence.save(workflow);
    this.logger.log(`Workflow ${workflowId} completed successfully`);
    return workflow;
  }

  private async executeStep(
    step: WorkflowStep,
    stepDef: StepDefinition,
  ): Promise<{
    success: boolean;
    output: Record<string, unknown> | null;
    errorMessage: string | null;
  }> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= step.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          this.logger.warn(
            `Retrying step "${step.name}" (attempt ${attempt + 1}/${step.maxRetries + 1})`,
          );
          // Exponential backoff: 100ms, 200ms, 400ms...
          await this.delay(100 * Math.pow(2, attempt - 1));
        }

        step.retryCount = attempt;
        const output = await stepDef.execute();
        return { success: true, output, errorMessage: null };
      } catch (error) {
        lastError = error as Error;
        const errorType = this.classifyError(error as Error);

        step.error = {
          message: (error as Error).message,
          type: errorType,
          occurredAt: new Date().toISOString(),
          attempt: attempt + 1,
        };

        if (errorType === 'fatal') {
          this.logger.error(`Fatal error in step "${step.name}": ${(error as Error).message}`);
          step.status = 'failed';
          return {
            success: false,
            output: null,
            errorMessage: `[FATAL] ${(error as Error).message}`,
          };
        }

        this.logger.warn(
          `Transient error in step "${step.name}" (attempt ${attempt + 1}): ${(error as Error).message}`,
        );
      }
    }

    // All retries exhausted
    step.status = 'failed';
    return {
      success: false,
      output: null,
      errorMessage: `Max retries exceeded. Last error: ${lastError?.message}`,
    };
  }

  private classifyError(error: Error): ErrorType {
    const fatalPatterns = [
      'INVALID_CREDENTIALS',
      'PERMISSION_DENIED',
      'NOT_FOUND',
      'VALIDATION_ERROR',
      'FATAL',
    ];

    const message = error.message.toUpperCase();
    if (fatalPatterns.some((pattern) => message.includes(pattern))) {
      return 'fatal';
    }

    return 'transient';
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
