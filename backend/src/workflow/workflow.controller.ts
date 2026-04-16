import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import { CreateWorkflowDto, Workflow } from './types/workflow.types';

@Controller('workflows')
export class WorkflowController {
  constructor(private readonly service: WorkflowService) {}

  @Post()
  create(@Body() dto: CreateWorkflowDto): Workflow {
    return this.service.create(dto);
  }

  @Post(':id/run')
  @HttpCode(HttpStatus.OK)
  async run(@Param('id') id: string): Promise<Workflow> {
    return this.service.run(id);
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  async resume(@Param('id') id: string): Promise<Workflow> {
    return this.service.resume(id);
  }

  @Get()
  findAll(): Workflow[] {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string): Workflow {
    return this.service.findOne(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): void {
    this.service.remove(id);
  }
}
