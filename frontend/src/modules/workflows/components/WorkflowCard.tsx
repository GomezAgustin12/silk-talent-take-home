import { useState } from 'react';
import type { Workflow } from '../../../shared/types/workflow';
import { Badge } from '../../../shared/components/ui/Badge';
import { Spinner } from '../../../shared/components/ui/Spinner';
import { StepList } from './StepList';
import { timeAgo } from '../../../shared/utils/formatDate';

interface WorkflowCardProps {
  workflow: Workflow;
  onRun: (id: string) => Promise<void>;
  onResume: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function WorkflowCard({ workflow, onRun, onResume, onDelete }: WorkflowCardProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isActing, setIsActing] = useState(false);

  const completedSteps = workflow.steps.filter((s) => s.status === 'completed').length;
  const progress = Math.round((completedSteps / workflow.steps.length) * 100);

  async function handleAction(action: () => Promise<void>) {
    setIsActing(true);
    try {
      await action();
    } finally {
      setIsActing(false);
    }
  }

  const canRun = workflow.status === 'pending';
  const canResume = workflow.status === 'failed';

  return (
    <div className="border border-gray-200 rounded-xl bg-white shadow-sm overflow-hidden">
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-gray-900">{workflow.name}</h3>
              <Badge status={workflow.status} />
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              {completedSteps}/{workflow.steps.length} steps &middot; {timeAgo(workflow.updatedAt)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isActing && <Spinner />}

          {canRun && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleAction(() => onRun(workflow.id));
              }}
              disabled={isActing}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              Run
            </button>
          )}

          {canResume && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleAction(() => onResume(workflow.id));
              }}
              disabled={isActing}
              className="px-3 py-1.5 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
            >
              Resume
            </button>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              handleAction(() => onDelete(workflow.id));
            }}
            disabled={isActing}
            className="px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors"
          >
            Delete
          </button>

          <span className="text-gray-400 text-sm ml-1">{isExpanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-gray-100">
        <div
          className={`h-full transition-all duration-500 ${
            workflow.status === 'failed' ? 'bg-red-500' : workflow.status === 'completed' ? 'bg-green-500' : 'bg-blue-500'
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {isExpanded && (
        <div className="p-4 border-t border-gray-100">
          {workflow.error && (
            <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {workflow.error}
            </div>
          )}
          <StepList steps={workflow.steps} currentStepIndex={workflow.currentStepIndex} />
        </div>
      )}
    </div>
  );
}
