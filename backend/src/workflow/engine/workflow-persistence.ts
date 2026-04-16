import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Workflow } from '../types/workflow.types';

@Injectable()
export class WorkflowPersistence {
  private readonly logger = new Logger(WorkflowPersistence.name);
  private readonly dataDir: string;

  constructor() {
    this.dataDir = path.join(process.cwd(), 'data');
    this.ensureDataDir();
  }

  private ensureDataDir(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private filePath(workflowId: string): string {
    return path.join(this.dataDir, `workflow-${workflowId}.json`);
  }

  save(workflow: Workflow): void {
    const file = this.filePath(workflow.id);
    fs.writeFileSync(file, JSON.stringify(workflow, null, 2), 'utf-8');
    this.logger.debug(`Persisted workflow ${workflow.id} to ${file}`);
  }

  load(workflowId: string): Workflow | null {
    const file = this.filePath(workflowId);
    if (!fs.existsSync(file)) {
      return null;
    }
    const raw = fs.readFileSync(file, 'utf-8');
    return JSON.parse(raw) as Workflow;
  }

  loadAll(): Workflow[] {
    this.ensureDataDir();
    const files = fs.readdirSync(this.dataDir).filter((f: string) => f.startsWith('workflow-') && f.endsWith('.json'));
    return files.map((f: string) => {
      const raw = fs.readFileSync(path.join(this.dataDir, f), 'utf-8');
      return JSON.parse(raw) as Workflow;
    });
  }

  delete(workflowId: string): boolean {
    const file = this.filePath(workflowId);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      return true;
    }
    return false;
  }

  clear(): void {
    this.ensureDataDir();
    const files = fs.readdirSync(this.dataDir).filter((f: string) => f.startsWith('workflow-') && f.endsWith('.json'));
    files.forEach((f: string) => fs.unlinkSync(path.join(this.dataDir, f)));
  }
}
