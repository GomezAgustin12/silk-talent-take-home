import {
  setup,
  assign,
  AnyActorLogic,
  ErrorActorEvent,
  DoneActorEvent,
} from "xstate";
import { Workflow } from "../types/workflow.types";
import { classifyError } from "./error-classifier";
import {
  applyStepStarted,
  applyStepCompleted,
  applyStepFailed,
  applyWorkflowCompleted,
} from "./workflow-projection";

export type StateName =
  | "checkCalendar"
  | "updateCrm"
  | "sendConfirmation"
  | "prepareKit"
  | "notifyInterviewer";

export const STEP_META: Record<
  StateName,
  { id: string; name: string; maxRetries: number; index: number }
> = {
  checkCalendar: {
    id: "check-calendar",
    name: "Check Calendar Availability",
    maxRetries: 3,
    index: 0,
  },
  updateCrm: {
    id: "update-crm",
    name: "Update CRM Record",
    maxRetries: 3,
    index: 1,
  },
  sendConfirmation: {
    id: "send-confirmation",
    name: "Send Confirmation Email",
    maxRetries: 2,
    index: 2,
  },
  prepareKit: {
    id: "prepare-interview-kit",
    name: "Prepare Interview Kit",
    maxRetries: 2,
    index: 3,
  },
  notifyInterviewer: {
    id: "notify-interviewer",
    name: "Notify Interviewer",
    maxRetries: 3,
    index: 4,
  },
};

export const STEP_META_BY_ID = new Map(
  (
    Object.entries(STEP_META) as [StateName, (typeof STEP_META)[StateName]][]
  ).map(([state, meta]) => [meta.id, { state, ...meta }]),
);

export interface ChartInput {
  workflow: Workflow;
  persist: (wf: Workflow) => void;
  startAt: StateName;
}

export interface ChartContext extends ChartInput {
  attempts: Record<string, number>;
}

type StepParams = { state: StateName };

function stepState<T extends StateName>(
  name: T,
  next: StateName | "completed",
) {
  return {
    entry: { type: "markStarted", params: { state: name } },
    invoke: {
      src: name,
      onDone: {
        target: next,
        actions: { type: "markCompleted", params: { state: name } },
      },
      onError: [
        {
          guard: { type: "canRetry", params: { state: name } },
          target: `#interviewWorkflow.${name}` as const,
          reenter: true,
          actions: { type: "bumpAttempt", params: { state: name } },
        },
        {
          target: "failed",
          actions: { type: "markFailed", params: { state: name } },
        },
      ],
    },
  } as const;
}

export function buildInterviewMachine(
  actors: Record<StateName, AnyActorLogic>,
) {
  return setup({
    types: {
      context: {} as ChartContext,
      input: {} as ChartInput,
    },
    actors,
    guards: {
      canRetry: ({ context, event }, params: StepParams) => {
        const err = (event as ErrorActorEvent).error;
        const message = err instanceof Error ? err.message : String(err ?? "");
        const attempts = context.attempts[params.state] ?? 0;
        return (
          classifyError(message) === "transient" &&
          attempts < STEP_META[params.state].maxRetries
        );
      },
      startsAt: ({ context }, params: StepParams) =>
        context.startAt === params.state,
    },
    actions: {
      markStarted: ({ context }, params: StepParams) => {
        applyStepStarted(context.workflow, STEP_META[params.state].index);
        context.persist(context.workflow);
      },
      markCompleted: ({ context, event }, params: StepParams) => {
        const output = (event as DoneActorEvent<Record<string, unknown>>)
          .output;
        const retryCount = context.attempts[params.state] ?? 0;
        applyStepCompleted(
          context.workflow,
          STEP_META[params.state].index,
          output,
          retryCount,
        );
        context.persist(context.workflow);
      },
      markFailed: ({ context, event }, params: StepParams) => {
        const err = (event as ErrorActorEvent).error;
        const message = err instanceof Error ? err.message : String(err ?? "");
        const attempts = context.attempts[params.state] ?? 0;
        applyStepFailed(context.workflow, STEP_META[params.state].index, {
          message,
          type: classifyError(message),
          attempt: attempts,
        });
        context.persist(context.workflow);
      },
      bumpAttempt: assign(({ context }, params: StepParams) => ({
        attempts: {
          ...context.attempts,
          [params.state]: (context.attempts[params.state] ?? 0) + 1,
        },
      })),
      markWorkflowCompleted: ({ context }) => {
        applyWorkflowCompleted(context.workflow);
        context.persist(context.workflow);
      },
    },
  }).createMachine({
    id: "interviewWorkflow",
    initial: "dispatch",
    context: ({ input }) => ({ ...input, attempts: {} }),
    states: {
      dispatch: {
        always: [
          {
            guard: { type: "startsAt", params: { state: "updateCrm" } },
            target: "updateCrm",
          },
          {
            guard: { type: "startsAt", params: { state: "sendConfirmation" } },
            target: "sendConfirmation",
          },
          {
            guard: { type: "startsAt", params: { state: "prepareKit" } },
            target: "prepareKit",
          },
          {
            guard: {
              type: "startsAt",
              params: { state: "notifyInterviewer" },
            },
            target: "notifyInterviewer",
          },
          { target: "checkCalendar" },
        ],
      },
      checkCalendar: stepState("checkCalendar", "updateCrm"),
      updateCrm: stepState("updateCrm", "sendConfirmation"),
      sendConfirmation: stepState("sendConfirmation", "prepareKit"),
      prepareKit: stepState("prepareKit", "notifyInterviewer"),
      notifyInterviewer: stepState("notifyInterviewer", "completed"),
      completed: { type: "final", entry: "markWorkflowCompleted" },
      failed: { type: "final" },
    },
  });
}

export type InterviewMachine = ReturnType<typeof buildInterviewMachine>;
