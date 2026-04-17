import { Module } from '@nestjs/common';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';
import { WorkflowPersistence } from './engine/workflow-persistence';

@Module({
  controllers: [WorkflowController],
  providers: [WorkflowService, WorkflowPersistence],
  exports: [WorkflowService],
})
export class WorkflowModule {}
