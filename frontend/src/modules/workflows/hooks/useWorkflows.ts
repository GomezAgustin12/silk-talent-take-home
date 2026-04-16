import { useState, useCallback } from 'react';
import { usePolling } from '../../../shared/hooks/usePolling';
import { workflowApi } from '../services/workflowApi';
import type { Workflow } from '../../../shared/types/workflow';

export function useWorkflows() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await workflowApi.getAll();
      setWorkflows(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  usePolling(refresh, 2000);

  const create = useCallback(async (name: string) => {
    const workflow = await workflowApi.create(name);
    setWorkflows((prev) => [...prev, workflow]);
    return workflow;
  }, []);

  const run = useCallback(async (id: string) => {
    await workflowApi.run(id);
    await refresh();
  }, [refresh]);

  const resume = useCallback(async (id: string) => {
    await workflowApi.resume(id);
    await refresh();
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    await workflowApi.remove(id);
    setWorkflows((prev) => prev.filter((w) => w.id !== id));
  }, []);

  return { workflows, isLoading, error, create, run, resume, remove, refresh };
}
