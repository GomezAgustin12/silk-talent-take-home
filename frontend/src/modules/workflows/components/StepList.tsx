import type { WorkflowStep } from '../../../shared/types/workflow';
import { Badge } from '../../../shared/components/ui/Badge';
import { formatDate } from '../../../shared/utils/formatDate';

interface StepListProps {
  steps: WorkflowStep[];
  currentStepIndex: number;
}

const stepIcons: Record<string, string> = {
  'check-calendar': '📅',
  'update-crm': '📝',
  'send-confirmation': '📧',
  'prepare-interview-kit': '📋',
  'notify-interviewer': '🔔',
};

export function StepList({ steps, currentStepIndex }: StepListProps) {
  return (
    <div className="space-y-1">
      {steps.map((step, index) => (
        <div
          key={step.id}
          className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
            index === currentStepIndex && step.status === 'in_progress'
              ? 'border-blue-300 bg-blue-50'
              : step.status === 'completed'
                ? 'border-green-200 bg-green-50/50'
                : step.status === 'failed'
                  ? 'border-red-200 bg-red-50/50'
                  : 'border-gray-200 bg-white'
          }`}
        >
          <span className="text-lg w-8 text-center flex-shrink-0">
            {stepIcons[step.id] ?? '⚙️'}
          </span>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm text-gray-900">{step.name}</span>
              <Badge status={step.status} />
            </div>

            {step.retryCount > 0 && step.status === 'completed' && (
              <p className="text-xs text-amber-600 mt-0.5">
                Succeeded after {step.retryCount} {step.retryCount === 1 ? 'retry' : 'retries'}
              </p>
            )}

            {step.error && (
              <p className="text-xs text-red-600 mt-0.5 truncate">
                <span className={`font-medium ${step.error.type === 'fatal' ? 'text-red-700' : 'text-amber-600'}`}>
                  [{step.error.type}]
                </span>{' '}
                {step.error.message}
              </p>
            )}

            {step.completedAt && (
              <p className="text-xs text-gray-500 mt-0.5">
                Completed: {formatDate(step.completedAt)}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
