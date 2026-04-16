import { WorkflowCard, CreateWorkflowForm, useWorkflows } from '../modules/workflows';
import { Spinner } from '../shared/components/ui/Spinner';

export function WorkflowsPage() {
  const { workflows, isLoading, error, create, run, resume, remove } = useWorkflows();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Create Workflow</h2>
        <CreateWorkflowForm
          onCreate={async (name) => {
            await create(name);
          }}
        />
      </div>

      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">
          Workflows
          {workflows.length > 0 && (
            <span className="ml-2 text-sm font-normal text-gray-500">({workflows.length})</span>
          )}
        </h2>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Spinner className="h-8 w-8" />
          </div>
        )}

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            Failed to load workflows: {error}
          </div>
        )}

        {!isLoading && workflows.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <p className="text-4xl mb-2">📋</p>
            <p className="text-sm">No workflows yet. Create one above to get started.</p>
          </div>
        )}

        <div className="space-y-4">
          {workflows.map((workflow) => (
            <WorkflowCard
              key={workflow.id}
              workflow={workflow}
              onRun={run}
              onResume={resume}
              onDelete={remove}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
