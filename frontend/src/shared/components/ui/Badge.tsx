import type { StepStatus, WorkflowStatus } from "../../types/workflow";

type BadgeVariant =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "in_progress"
  | "skipped";

const variantClasses: Record<BadgeVariant, string> = {
  pending: "bg-gray-100 text-gray-700",
  running: "bg-blue-100 text-blue-700",
  in_progress: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  skipped: "bg-gray-100 text-gray-500",
};

interface BadgeProps {
  status: StepStatus | WorkflowStatus;
}

export function Badge({ status }: BadgeProps) {
  const classes = variantClasses[status] ?? variantClasses.pending;
  const label = status.replace(/_/g, " ").toUpperCase();

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${classes}`}
    >
      {label}
    </span>
  );
}
