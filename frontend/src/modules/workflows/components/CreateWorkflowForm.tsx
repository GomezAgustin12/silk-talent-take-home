import { useState } from 'react';

interface CreateWorkflowFormProps {
  onCreate: (name: string) => Promise<void>;
}

export function CreateWorkflowForm({ onCreate }: CreateWorkflowFormProps) {
  const [name, setName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setIsCreating(true);
    try {
      await onCreate(trimmed);
      setName('');
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Interview — John Doe"
        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        disabled={isCreating}
      />
      <button
        type="submit"
        disabled={!name.trim() || isCreating}
        className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isCreating ? 'Creating...' : 'Create Workflow'}
      </button>
    </form>
  );
}
