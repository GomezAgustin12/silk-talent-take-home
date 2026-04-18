import { apiClient } from "../../../api/client";
import type { Workflow } from "../../../shared/types/workflow";

export const workflowApi = {
  getAll: () => apiClient.get<Workflow[]>("/workflows"),

  getById: (id: string) => apiClient.get<Workflow>(`/workflows/${id}`),

  create: (name: string) => apiClient.post<Workflow>("/workflows", { name }),

  run: (id: string) => apiClient.post<Workflow>(`/workflows/${id}/run`),

  resume: (id: string) => apiClient.post<Workflow>(`/workflows/${id}/resume`),

  remove: (id: string) => apiClient.delete<void>(`/workflows/${id}`),
};
