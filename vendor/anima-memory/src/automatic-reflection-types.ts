import { AUTOMATIC_REFLECTION_TIMEZONE, type AutomaticReflectionCursorPeriod } from "./reflection-calendar.ts";
import type { AutomaticReflectionKind } from "./reflection-calendar.ts";

export const AUTOMATIC_REFLECTION_SCHEDULE_VERSION = "v1" as const;
export const AUTOMATIC_REFLECTION_MAX_ATTEMPTS_PER_PROJECT_RUN = 128 as const;

export type AutomaticReflectionScheduleCursorProperty<K extends AutomaticReflectionKind = AutomaticReflectionKind> =
  K extends "daily"
    ? "next_daily_period"
    : K extends "weekly"
      ? "next_weekly_period"
      : K extends "monthly"
        ? "next_monthly_period"
        : never;

export interface AutomaticReflectionScheduleCursor {
  cursor_uid: string;
  project_uid: string;
  schedule_version: typeof AUTOMATIC_REFLECTION_SCHEDULE_VERSION;
  timezone: typeof AUTOMATIC_REFLECTION_TIMEZONE;
  next_daily_period: AutomaticReflectionCursorPeriod;
  next_weekly_period: AutomaticReflectionCursorPeriod;
  next_monthly_period: AutomaticReflectionCursorPeriod;
}

export interface RunDueAutomaticReflectionsInput {
  now: string;
  max_input_bytes: number;
  max_work_items_per_project?: number;
  max_concurrent_projects?: number;
}

export type AutomaticReflectionAttemptCode =
  | "invalid_timestamp"
  | "input_too_large"
  | "source_incomplete"
  | "identity_conflict"
  | "model_unavailable"
  | "model_failed"
  | "invalid_reflection"
  | "database_error";

export type AutomaticReflectionAttempt =
  | {
      project_uid: string;
      status: "blocked" | "failed";
      code: AutomaticReflectionAttemptCode;
      message: string;
    }
  | {
      project_uid: string;
      kind: AutomaticReflectionKind;
      period_key: string;
      status: "materialized" | "up_to_date";
      reflection_uid: string;
    }
  | {
      project_uid: string;
      kind: AutomaticReflectionKind;
      period_key: string;
      status: "empty_scope" | "already_processed";
    }
  | {
      project_uid: string;
      kind: AutomaticReflectionKind;
      period_key: string;
      status: "blocked" | "failed";
      code: AutomaticReflectionAttemptCode;
      message: string;
    };

export type RunDueAutomaticReflectionsResult =
  | {
      status: "completed" | "partial";
      now: string;
      attempts: readonly AutomaticReflectionAttempt[];
      has_more: boolean;
    }
  | {
      status: "failed";
      code: "invalid_input" | "core_degraded" | "core_closed" | "database_error" | "identity_conflict";
      message: string;
    };
