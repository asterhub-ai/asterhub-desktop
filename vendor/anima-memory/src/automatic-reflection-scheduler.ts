import { formatUtcInstant, nextAutomaticBoundary, parseInstant } from "./reflection-calendar.ts";
import type {
  RunDueAutomaticReflectionsInput,
  RunDueAutomaticReflectionsResult,
} from "./automatic-reflection-types.ts";

const MAX_INPUT_BYTES = 1_048_576;

export type AutomaticReflectionSchedulerRun = (input: RunDueAutomaticReflectionsInput) => Promise<RunDueAutomaticReflectionsResult>;
export type AutomaticReflectionSchedulerTimer = unknown;
export type AutomaticReflectionSchedulerSetTimeout = (callback: () => void, delayMs: number) => AutomaticReflectionSchedulerTimer;
export type AutomaticReflectionSchedulerClearTimeout = (timer: unknown) => void;

export interface AutomaticReflectionSchedulerClock {
  now?: () => number;
  setTimeout?: AutomaticReflectionSchedulerSetTimeout;
  clearTimeout?: AutomaticReflectionSchedulerClearTimeout;
}

export interface AutomaticReflectionSchedulerOptions extends AutomaticReflectionSchedulerClock {
  max_input_bytes: number;
  run: AutomaticReflectionSchedulerRun;
}
function validateMaxInputBytes(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > MAX_INPUT_BYTES) {
    throw new TypeError("max_input_bytes must be a positive safe integer no greater than 1 MiB.");
  }
}

function validateClockNow(value: number): number {
  if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
    throw new TypeError("scheduler clock must return a safe integer.");
  }
  return value;
}

/**
 * Drives automatic reflection runs from fixed Shanghai-local calendar boundaries.
 * The scheduler owns no persistence state; every run delegates catch-up to the store.
 */
export class AutomaticReflectionScheduler {
  private readonly maxInputBytes: number;
  private readonly run: AutomaticReflectionSchedulerRun;
  private readonly now: () => number;
  private readonly setTimer: AutomaticReflectionSchedulerSetTimeout;
  private readonly clearTimer: AutomaticReflectionSchedulerClearTimeout;
  private started = false;
  private closed = false;
  private running = false;
  private timer: AutomaticReflectionSchedulerTimer | undefined;

  constructor(options: AutomaticReflectionSchedulerOptions) {
    validateMaxInputBytes(options.max_input_bytes);
    const callback = options.run;
    if (typeof callback !== "function") throw new TypeError("run must be a function.");

    this.maxInputBytes = options.max_input_bytes;
    this.run = callback;
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setTimeout ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimer = options.clearTimeout ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  }

  start(): void {
    if (this.started || this.closed) return;
    this.started = true;
    void this.executeRun();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.started = false;
    this.cancelTimer();
  }

  private currentNow(): number {
    return validateClockNow(this.now());
  }

  private cancelTimer(): void {
    if (this.timer === undefined) return;
    const timer = this.timer;
    this.timer = undefined;
    try {
      this.clearTimer(timer);
    } catch {
      // A failing timer cancellation cannot revive a closed scheduler.
    }
  }

  private async executeRun(): Promise<void> {
    if (!this.started || this.closed || this.running) return;

    this.running = true;
    this.cancelTimer();

    let startedAt: number;
    let formattedNow: string;
    try {
      startedAt = this.currentNow();
      formattedNow = formatUtcInstant(startedAt);
    } catch {
      this.running = false;
      return;
    }

    let boundary: number | undefined;
    try {
      boundary = parseInstant(nextAutomaticBoundary(startedAt));
    } catch {
      // A missing next boundary only prevents rearming after this run.
    }

    let result: RunDueAutomaticReflectionsResult | undefined;
    try {
      result = await this.run({
        now: formattedNow,
        max_input_bytes: this.maxInputBytes,
      });
    } catch {
      // A rejected run must not prevent the scheduler from rearming.
    } finally {
      this.running = false;
    }

    if (!this.started || this.closed) return;

    if (
      result !== undefined &&
      (result.status === "completed" || result.status === "partial") &&
      result.has_more
    ) {
      try {
        this.timer = this.setTimer(() => {
          this.timer = undefined;
          if (!this.started || this.closed || this.running) return;
          void this.executeRun();
        }, 0);
      } catch {
        // Timer installation is an optional scheduling mechanism; a failed installation
        // must not turn the detached scheduler task into an unhandled rejection.
      }
      return;
    }

    if (boundary === undefined) return;

    let now: number;
    try {
      now = this.currentNow();
    } catch {
      // A broken injected clock cannot safely arm a timer, so scheduling stops without
      // turning the detached scheduler task into an unhandled rejection.
      return;
    }

    if (now >= boundary) {
      void this.executeRun();
      return;
    }

    const delayMs = Math.max(0, boundary - now);
    try {
      this.timer = this.setTimer(() => {
        this.timer = undefined;
        if (!this.started || this.closed || this.running) return;
        void this.executeRun();
      }, delayMs);
    } catch {
      // Timer installation is an optional scheduling mechanism; a failed installation
      // must not turn the detached scheduler task into an unhandled rejection.
    }
  }
}

export const AUTOMATIC_REFLECTION_MAX_INPUT_BYTES = MAX_INPUT_BYTES;
