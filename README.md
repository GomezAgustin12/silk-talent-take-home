# Resilient Workflow Engine

A React + NestJS application that runs multi-step async workflows with crash recovery, retry logic, and real-time status monitoring.

## Quick Start

### Backend

```bash
cd backend
npm install
npm run start:dev
# API running on http://localhost:3310
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# UI running on http://localhost:3300
```

### Run Tests

```bash
cd backend
npm test
```

---

## Data Model

### Workflow

```typescript
interface Workflow {
  id: string;              // UUID, generated on creation
  name: string;            // Human-readable label (e.g. "Interview — John Doe")
  status: WorkflowStatus;  // pending | running | completed | failed
  currentStepIndex: number;// Tracks which step is executing
  steps: WorkflowStep[];   // Ordered list of steps
  createdAt: string;       // ISO timestamp
  updatedAt: string;       // Updated after every state change
  completedAt: string | null;
  error: string | null;    // Top-level error message if workflow failed
}
```

### WorkflowStep

```typescript
interface WorkflowStep {
  id: string;              // Stable identifier (e.g. "check-calendar")
  name: string;            // Display name
  status: StepStatus;      // pending | in_progress | completed | failed
  startedAt: string | null;
  completedAt: string | null;
  error: StepError | null; // Last error with type classification
  retryCount: number;      // How many retries were attempted
  maxRetries: number;      // Max retries allowed for this step
  output: Record<string, unknown> | null; // Step result data
}
```

### StepError

```typescript
interface StepError {
  message: string;         // Error message
  type: ErrorType;         // "transient" | "fatal"
  occurredAt: string;      // When the error happened
  attempt: number;         // Which attempt triggered this error
}
```

### Why This Structure

**Flat step array with index tracking** — Steps are stored as an ordered array inside the workflow, with `currentStepIndex` tracking progress. This makes resume trivial: find the first non-completed step and continue from there. No need for a separate execution pointer table or linked list.

**Error classification at the step level** — Each step carries its own error with a `type` field (`transient` vs `fatal`). The engine uses pattern matching on error messages to classify: known fatal patterns (INVALID_CREDENTIALS, PERMISSION_DENIED, NOT_FOUND, VALIDATION_ERROR) stop execution immediately, everything else is treated as transient and retried with exponential backoff.

**Per-step persistence** — State is written to disk after every step transition (pending → in_progress, in_progress → completed/failed). If the process crashes mid-workflow, the JSON file on disk reflects the exact last known state. On resume, in_progress steps are reset to pending (since we can't know if the step completed or not), and execution continues from the first non-completed step.

**JSON file per workflow** — Each workflow gets its own file (`data/workflow-{id}.json`). This avoids contention on a single file and makes inspection/debugging easy — just `cat` the file to see the full state.

**Step definitions are separate from step state** — The `StepDefinition` (with the `execute` function) lives in code, while `WorkflowStep` (state) lives in the JSON file. This separation means the persisted state is pure data with no serialized functions, and step logic can be updated without migrating existing workflow files.

---

## Architecture

```
┌─────────────┐     HTTP      ┌─────────────────┐
│   React UI  │ ◄───────────► │   NestJS API    │
│  (Vite)     │   polling     │                 │
│  port 3300  │               │  port 3310      │
└─────────────┘               └────────┬────────┘
                                       │
                              ┌────────▼────────┐
                              │ Workflow Engine  │
                              │                 │
                              │ - Create        │
                              │ - Run (step by  │
                              │   step)         │
                              │ - Resume        │
                              │ - Retry/Fatal   │
                              └────────┬────────┘
                                       │
                              ┌────────▼────────┐
                              │  JSON Files     │
                              │  (data/*.json)  │
                              └─────────────────┘
```

### Backend (NestJS)

- **WorkflowEngine** — Core execution logic. Creates workflows, runs steps sequentially, handles retries with exponential backoff, classifies errors, persists state after every transition.
- **WorkflowPersistence** — Reads/writes workflow state to JSON files in the `data/` directory.
- **WorkflowService** — NestJS service that orchestrates engine + persistence. Handles resume by resetting `in_progress` steps before re-running.
- **WorkflowController** — REST endpoints for CRUD + run/resume operations.
- **Interview Steps** — Mock step definitions simulating a real interview workflow (calendar check, CRM update, email, interview kit, notification).

### Frontend (React 19 + Vite + TypeScript)

- **shared/modules architecture** — Reusable UI in `shared/`, feature code in `modules/workflows/`
- **Polling** — `usePolling` hook refreshes workflow list every 2 seconds for near real-time updates
- **WorkflowCard** — Shows workflow status, progress bar, expandable step list with error details

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/workflows` | Create a new workflow |
| `GET` | `/workflows` | List all workflows |
| `GET` | `/workflows/:id` | Get workflow by ID |
| `POST` | `/workflows/:id/run` | Run a pending workflow |
| `POST` | `/workflows/:id/resume` | Resume a failed workflow |
| `DELETE` | `/workflows/:id` | Delete a workflow |

---

## Error Handling Strategy

| Error Type | Behavior | Example |
|------------|----------|---------|
| **Transient** | Retry with exponential backoff (100ms, 200ms, 400ms...) up to `maxRetries` | Timeout, rate limit, connection lost |
| **Fatal** | Stop immediately, mark workflow as failed | Invalid credentials, permission denied, not found |

The engine classifies errors by pattern matching on the error message. Keywords like `INVALID_CREDENTIALS`, `PERMISSION_DENIED`, `NOT_FOUND`, `VALIDATION_ERROR`, and `FATAL` trigger fatal classification. Everything else is transient.

---

## Resume / Crash Recovery

1. State is persisted to disk after **every step transition**
2. If the server crashes mid-step, the step stays as `in_progress` in the JSON file
3. On resume, `in_progress` steps are reset to `pending` (we can't assume the step completed)
4. The engine finds the first non-completed step and continues from there
5. Already-completed steps are never re-executed

The test suite (`workflow-resume.spec.ts`) proves this by:
- Running a workflow that crashes at step 2
- Creating a fresh engine instance (simulating server restart)
- Loading state from disk
- Resuming and verifying step 1 was NOT re-executed

---

## What I'd Add With More Time

- **WebSocket/SSE** — Replace polling with real-time push updates for step progress
- **BullMQ integration** — Use Redis-backed job queue instead of in-process execution for horizontal scaling and proper job isolation
- **Parallel steps** — Support DAG-based workflows where independent steps run concurrently
- **Step timeout** — Kill steps that hang beyond a configurable duration
- **Audit log** — Append-only event log for every state transition (useful for debugging and compliance)
- **Workflow templates** — Define reusable workflow templates with parameterized steps
- **Authentication** — JWT-based auth to scope workflows to users/teams
- **Database persistence** — Replace JSON files with PostgreSQL for production use (concurrent access, transactions, queries)
- **Metrics/observability** — Track step duration, retry rates, failure rates per step type
- **UI improvements** — Workflow detail page, step output viewer, timeline visualization, dark mode
