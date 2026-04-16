import { Module } from '@nestjs/common';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';
import { WorkflowEngine } from './engine/workflow-engine';
import { WorkflowPersistence } from './engine/workflow-persistence';

@Module({
  controllers: [WorkflowController],
  providers: [WorkflowService, WorkflowEngine, WorkflowPersistence],
  exports: [WorkflowService],
})
export class WorkflowModule {}
