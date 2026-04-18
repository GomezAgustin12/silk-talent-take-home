# Resilient Workflow Engine

A React + NestJS application that runs multi-step async workflows with crash recovery, retry logic, and real-time status monitoring. The workflow engine models the **interview flow as a declarative XState chart** — each interview step is a named state with its own invoke, retry policy, and transitions.

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
  currentStepIndex: number;// Index of the step currently executing / about to execute
  steps: WorkflowStep[];   // Ordered list of steps
  createdAt: string;       // ISO timestamp
  updatedAt: string;       // Updated after every state-chart transition
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

**The Workflow JSON is the single source of truth.** The state chart's internal context is never persisted separately — every meaningful transition mutates the `Workflow` object via pure projection functions (`applyStepStarted`, `applyStepCompleted`, `applyStepFailed`) and then saves it. Resume reads the `Workflow`, computes the first non-completed step, and starts a fresh actor at that state. No XState snapshot blob; no risk of snapshot/chart drift after a code change.

**Flat step array with index tracking** — Steps are stored as an ordered array, and `currentStepIndex` always reflects which step the chart is inside. The frontend reads `currentStepIndex` and `steps[]` directly — the declarative chart refactor left the REST contract untouched.

**Error classification at the step level** — Each step carries its own error with a `type` field (`transient` vs `fatal`). A shared classifier (`error-classifier.ts`) matches known fatal patterns (`INVALID_CREDENTIALS`, `PERMISSION_DENIED`, `NOT_FOUND`, `VALIDATION_ERROR`, `FATAL`) — the chart's `canRetry` guard uses this to decide whether to self-loop or jump to `failed`.

**Per-transition persistence** — Every chart action that mutates the workflow (step started, step completed, step failed, workflow completed) ends with `persist(workflow)`. Persistence can't be forgotten because it's part of the action definition, not a per-call responsibility.

**JSON file per workflow** — Each workflow gets its own file (`data/workflow-{id}.json`). No contention on a single file; `cat` the file to inspect full state.

**Step definitions are separate from step state** — The `StepDefinition` (with the `execute` function) lives in code, while `WorkflowStep` (state) lives in the JSON file. Step logic can be updated without migrating existing workflow files.

---

## Why XState — declaratively

An earlier iteration used XState as a generic step-iterator (`idle → executingStep → stepCompleted → executingStep → ...`, with steps as data iterated by `currentStepIndex`). That approach worked but turned XState into a wrapper around a `for` loop — it didn't buy anything you couldn't do with `try/catch`.

The current chart treats **the interview workflow itself as the state chart**. The five interview steps (`checkCalendar`, `updateCrm`, `sendConfirmation`, `prepareKit`, `notifyInterviewer`) are named states. Transitions between them are declared on the chart edges, not computed at runtime. The chart IS the domain.

### What that buys you

| Concern | Generic iterator | Declarative chart |
|---------|------------------|-------------------|
| **Reading the code** | One generic state; you have to read `stepDefinitions[]` separately to understand the flow | The chart file is the workflow — five states, transitions between them, visible at a glance |
| **Retry policy** | Loop counter + manual classification inside the iterator | `onError` guard (`canRetry`) self-targets the same state; per-state `maxRetries` declared via params |
| **Branching** | Would require intrusive changes to the iterator | Each step can have its own `onDone`/`onError` targets — trivial to add compensating transitions, skip logic, or parallel regions |
| **Visualization** | Nothing useful — the chart is a generic loop | Paste the machine into [stately.ai/viz](https://stately.ai/viz) and you see the real interview flow |
| **Testability** | End-to-end tests only | Actors are injected via `setup({ actors })`; tests swap them per scenario without touching the chart |

### State Chart

```
                     ┌─────────────┐
            (fresh)  │  dispatch   │
         ┌──────────►│ (initial)   │
         │           └──────┬──────┘
         │     always guards: startAt ∈ context.input
         │                  │
         │     ┌────────────┼────────────┬────────────┬─────────────────┐
         │     ▼            ▼            ▼            ▼                 ▼
         │ ┌────────┐  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐
         │ │ check  │  │ update  │  │   send   │  │ prepare  │  │   notify     │
         │ │Calendar├─►│  Crm    ├─►│Confirmat.├─►│   Kit    ├─►│ Interviewer  │
         │ └───┬────┘  └────┬────┘  └────┬─────┘  └────┬─────┘  └──────┬───────┘
         │     │            │            │            │                │
         │     │ onError    │ onError    │ onError    │ onError        │ onError
         │     │ [canRetry] │            │            │                │
         │     └─── self ───┘            │            │                │
         │          (reenter)            │            │                │
         │                               ▼            ▼                ▼
         │                           ┌─────────────────────────┐  ┌──────────┐
         │                           │         failed          │  │completed │
         └───────── resume ──────────│         (final)         │  │ (final)  │
                                     └─────────────────────────┘  └──────────┘
```

Each step state has the same shape (produced by a `stepState(name, next)` helper):

```ts
{
  entry: { type: 'markStarted', params: { state: name } },
  invoke: {
    src: name,                              // registered in setup({ actors })
    onDone:  { target: next,   actions: { type: 'markCompleted', params: { state: name } } },
    onError: [
      { guard: { type: 'canRetry', params: { state: name } },
        target: `#interviewWorkflow.${name}`, reenter: true,
        actions: { type: 'bumpAttempt', params: { state: name } } },
      { target: 'failed', actions: { type: 'markFailed', params: { state: name } } },
    ],
  },
}
```

### States

- `dispatch` — Initial state for every actor. Uses `always` guards to jump to the correct starting step based on `input.startAt`. Fresh runs start at `checkCalendar`; resumed runs jump to the first non-completed step.
- `checkCalendar` → `updateCrm` → `sendConfirmation` → `prepareKit` → `notifyInterviewer` — the five interview steps. Each one invokes its registered actor via `fromPromise`. On success, transition to the next step. On error, evaluate `canRetry`: if transient and attempts < maxRetries, self-loop; otherwise fall through to `failed`.
- `completed` — Final state. Entry action sets `workflow.status = 'completed'` and persists.
- `failed` — Final state. The failing state's `markFailed` action set the workflow error before transitioning here.

### Why `dispatch` instead of snapshot restoration

XState v5's `resolveState({ value })` produces a snapshot of a state, but when you feed that snapshot into `createActor(machine, { snapshot }).start()` the invokes of the resolved state are **not** re-activated — the actor resumes "inside" the state as if the invoke had already fired. That hangs the machine.

The `dispatch` state sidesteps this entirely: every actor starts fresh from `dispatch` with `input.startAt` set to the target state, and `always` transitions fire immediately on entry, landing the actor in a state it's truly *entering* — so the `entry` action runs, the `invoke` kicks off, and the chart proceeds normally. It also keeps resume logic 100% declarative (no snapshot reconstitution on the service side).

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
                              │ WorkflowService │
                              │                 │
                              │ build actorMap  │
                              │ createActor()   │
                              │ waitFor(done)   │
                              └────────┬────────┘
                                       │
            ┌──────────────────────────┼──────────────────────────┐
            │                          │                          │
   ┌────────▼────────┐       ┌─────────▼────────┐        ┌────────▼────────┐
   │  workflow-chart │       │   Persistence    │        │   Step Defs     │
   │  (state chart + │       │  (JSON files)    │        │  (interview)    │
   │  actions/guards)│       └──────────────────┘        └─────────────────┘
   └────────┬────────┘
            │
   ┌────────▼────────┐         ┌──────────────────┐
   │  projection     │         │ error-classifier │
   │  (pure fns that │         │ (fatal pattern   │
   │  mutate         │         │  matching)       │
   │  Workflow REST) │         └──────────────────┘
   └─────────────────┘
```

### Backend (NestJS)

- **`engine/workflow-chart.ts`** — XState v5 state chart. `buildInterviewMachine(actors)` registers the five step actors via `setup({ actors })` and returns a fresh machine. `STEP_META` maps state names to step metadata (id, name, maxRetries, index). All guards and actions are declared here; the chart is self-contained.
- **`engine/workflow-projection.ts`** — Pure functions that mutate the `Workflow` REST shape: `applyStepStarted`, `applyStepCompleted`, `applyStepFailed`, `applyWorkflowCompleted`. The chart's actions delegate to these, so the chart file stays focused on structure while the projection file owns the data shape.
- **`engine/error-classifier.ts`** — `classifyError(message)` returns `"fatal"` or `"transient"` based on substring matches. Used by the `canRetry` guard in the chart and by `markFailed` to tag the persisted error.
- **`engine/workflow-persistence.ts`** — Reads/writes workflow state to JSON files in `data/`.
- **`workflow.service.ts`** — Orchestrates everything. For each `run()`: loads the `Workflow` from disk, builds the actor map from `StepDefinition[]` (wrapping each `execute` in `fromPromise`), computes `startAt` as the first non-completed step, creates the actor with `{ input: { workflow, persist, startAt } }`, starts it, and `waitFor`s the final state.
- **`workflow.controller.ts`** — REST endpoints for CRUD + run/resume.
- **`steps/interview-steps.ts`** — Mock step definitions simulating a real interview flow (calendar check, CRM update, confirmation email, interview kit, interviewer notification). Each has configurable fail modes for tests.

### Frontend (React 19 + Vite + TypeScript)

- **shared/modules architecture** — Reusable UI in `shared/`, feature code in `modules/workflows/`.
- **Polling** — `usePolling` hook refreshes the workflow list every 2 seconds for near real-time updates.
- **WorkflowCard** — Shows workflow status, progress bar (derived from `steps.filter(completed).length / steps.length`), expandable step list with error details.

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
| **Transient** | Retry up to `maxRetries` by self-looping the step state (`onError → canRetry → reenter`) | Timeout, rate limit, connection lost |
| **Fatal** | Stop immediately, transition to `failed`, mark workflow as failed | Invalid credentials, permission denied, not found, validation error |

The `canRetry` guard reads the failing event's error, runs `classifyError()`, and checks the per-state `attempts` counter against `STEP_META[state].maxRetries`. Transient + attempts-left → self-loop with `bumpAttempt`. Fatal or retries exhausted → `target: 'failed'`.

---

## Resume / Crash Recovery

1. Every chart action (`markStarted`, `markCompleted`, `markFailed`, `markWorkflowCompleted`) calls `persist(workflow)` after mutating. The JSON file on disk always reflects the last chart transition.
2. If the server crashes mid-step, the step stays `in_progress` in the JSON file.
3. On resume, the service resets any `in_progress` or `failed` steps to `pending` (we can't assume they completed) and saves.
4. `run()` recomputes `startAt` as the first non-completed step's state name and creates a fresh actor with that input.
5. The actor enters `dispatch`, whose `always` transitions route it to the correct step state. `entry: markStarted` fires on that state (workflow step goes `pending → in_progress`), the invoke runs, and the chart proceeds normally.
6. Already-completed steps are never re-executed.

The test suite (`workflow-resume.spec.ts`) exercises this by:
- Running a workflow that fails fatally at `update-crm`
- Creating a fresh `WorkflowService` + `WorkflowPersistence` (simulating server restart)
- Loading state from disk, resetting failed/in_progress steps to pending
- Resuming, and asserting that `check-calendar` does NOT appear in the execution log while `update-crm`, `send-confirmation`, `prepare-interview-kit`, and `notify-interviewer` do

---

## What I'd Add With More Time

- **Stately Studio visualization** — Export the machine for visual editing and team collaboration at [stately.ai](https://stately.ai).
- **WebSocket/SSE** — Replace polling with real-time push updates as the chart transitions.
- **BullMQ integration** — Use a Redis-backed job queue instead of in-process execution for horizontal scaling and proper job isolation.
- **Parallel steps** — XState's parallel states could model independent steps (e.g. "send confirmation email" and "prepare interview kit" don't depend on each other) as concurrent regions.
- **Step timeouts** — XState's `after` delays model step timeouts declaratively — useful for steps like `notify-interviewer` where a stuck Slack call shouldn't hang the whole workflow.
- **Exponential backoff between retries** — The current chart self-loops immediately on transient errors. Adding a per-state `retryDelay` intermediate state with `after` would reintroduce backoff declaratively.
- **Compensating transitions** — When `update-crm` fails, a real system would want to roll back the `check-calendar` reservation. The chart could model that as a compensating transition instead of a hard `failed`.
- **Audit log** — Subscribe to actor state changes for an append-only event log of every transition.
- **Workflow templates** — Define reusable workflow templates with parameterized steps (e.g. different chart shapes for screening vs. technical vs. onsite interviews).
- **Authentication** — JWT-based auth to scope workflows to users/teams.
- **Database persistence** — Replace JSON files with PostgreSQL for production use.
- **Metrics/observability** — Track step duration, retry rates, failure rates per step type.
- **UI improvements** — Workflow detail page, step output viewer, timeline visualization, dark mode.
