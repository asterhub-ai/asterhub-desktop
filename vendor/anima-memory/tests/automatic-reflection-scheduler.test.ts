import { describe, expect, test } from "vitest";
import { AutomaticReflectionScheduler } from "../src/automatic-reflection-scheduler.ts";
import type {
  RunDueAutomaticReflectionsInput,
  RunDueAutomaticReflectionsResult,
} from "../src/automatic-reflection-types.ts";

function epoch(value: string): number {
  return Date.parse(value);
}

class FakeClock {
  nowMs: number;
  readonly timers: Array<{ at: number; callback: () => void; cancelled: boolean }> = [];

  constructor(now: string) {
    this.nowMs = epoch(now);
  }

  now = (): number => this.nowMs;

  setTimeout = (callback: () => void, delayMs: number): number => {
    this.timers.push({ at: this.nowMs + delayMs, callback, cancelled: false });
    return this.timers.length - 1;
  };

  clearTimeout = (timer: unknown): void => {
    if (typeof timer !== "number" || !Number.isSafeInteger(timer) || timer < 0) return;
    const item = this.timers[timer];
    if (item !== undefined) item.cancelled = true;
  };

  async fireNext(): Promise<void> {
    const pending = this.timers
      .map((timer, index) => ({ timer, index }))
      .filter(({ timer }) => !timer.cancelled)
      .sort((left, right) => left.timer.at - right.timer.at)[0];
    if (pending === undefined) return;
    this.nowMs = pending.timer.at;
    pending.timer.cancelled = true;
    pending.timer.callback();
    await Promise.resolve();
    await Promise.resolve();
  }
}
type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}


async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function runInputs(clock: FakeClock): { inputs: RunDueAutomaticReflectionsInput[]; run: (input: RunDueAutomaticReflectionsInput) => Promise<RunDueAutomaticReflectionsResult> } {
  const inputs: RunDueAutomaticReflectionsInput[] = [];
  return {
    inputs,
    run: async (input) => {
      inputs.push(input);
      return { status: "completed", now: input.now, attempts: [], has_more: false };
    },
  };
}

describe("AutomaticReflectionScheduler", () => {
  test("starts one immediate run and arms the exact next daily boundary", async () => {
    const clock = new FakeClock("2026-09-20T16:00:00.000Z");
    const { inputs, run } = runInputs(clock);
    const scheduler = new AutomaticReflectionScheduler({
      max_input_bytes: 65_536,
      run,
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    });

    scheduler.start();
    scheduler.start();
    await flush();

    expect(inputs).toEqual([{ now: "2026-09-20T16:00:00.000Z", max_input_bytes: 65_536 }]);
    expect(clock.timers.filter((timer) => !timer.cancelled).map((timer) => timer.at)).toEqual([epoch("2026-09-20T16:05:00.000Z")]);
  });

  test("uses exact Monday weekly and month-start boundaries", async () => {
    const weeklyClock = new FakeClock("2026-08-30T16:00:00.000Z");
    const weekly = runInputs(weeklyClock);
    const weeklyScheduler = new AutomaticReflectionScheduler({
      max_input_bytes: 1,
      run: weekly.run,
      now: weeklyClock.now,
      setTimeout: weeklyClock.setTimeout,
      clearTimeout: weeklyClock.clearTimeout,
    });

    weeklyScheduler.start();
    await flush();
    expect(weeklyClock.timers.find((timer) => !timer.cancelled)?.at).toBe(epoch("2026-08-30T16:05:00.000Z"));
    await weeklyClock.fireNext();
    expect(weeklyClock.timers.find((timer) => !timer.cancelled)?.at).toBe(epoch("2026-08-30T16:15:00.000Z"));

    const monthlyClock = new FakeClock("2026-08-31T15:00:00.000Z");
    const monthly = runInputs(monthlyClock);
    const monthlyScheduler = new AutomaticReflectionScheduler({
      max_input_bytes: 1,
      run: monthly.run,
      now: monthlyClock.now,
      setTimeout: monthlyClock.setTimeout,
      clearTimeout: monthlyClock.clearTimeout,
    });

    monthlyScheduler.start();
    await flush();
    await monthlyClock.fireNext();
    expect(monthlyClock.timers.find((timer) => !timer.cancelled)?.at).toBe(epoch("2026-08-31T16:30:00.000Z"));
  });

  test("rearms after a rejected run while the next boundary is representable", async () => {
    const clock = new FakeClock("2026-09-20T16:00:00.000Z");
    const inputs: RunDueAutomaticReflectionsInput[] = [];
    const scheduler = new AutomaticReflectionScheduler({
      max_input_bytes: 1,
      run: async (input) => {
        inputs.push(input);
        throw new Error("run failed");
      },
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    });

    scheduler.start();
    await flush();

    expect(inputs).toEqual([{ now: "2026-09-20T16:00:00.000Z", max_input_bytes: 1 }]);
    expect(clock.timers.filter((timer) => !timer.cancelled).map((timer) => timer.at)).toEqual([
      epoch("2026-09-20T16:05:00.000Z"),
    ]);
  });

  test("runs the final finite-horizon periods and stops after the last weekly boundary", async () => {
    const clock = new FakeClock("9998-12-31T15:00:00.000Z");
    const { inputs, run } = runInputs(clock);
    const scheduler = new AutomaticReflectionScheduler({
      max_input_bytes: 1,
      run,
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    });

    scheduler.start();
    await flush();
    await clock.fireNext();
    await clock.fireNext();
    await clock.fireNext();

    expect(inputs.map((input) => input.now)).toEqual([
      "9998-12-31T15:00:00.000Z",
      "9998-12-31T16:05:00.000Z",
      "9998-12-31T16:30:00.000Z",
      "9999-01-03T16:15:00.000Z",
    ]);
    expect(clock.timers.filter((timer) => !timer.cancelled)).toHaveLength(0);
  });

  test("keeps one armed wake for store catch-up", async () => {
    const clock = new FakeClock("2026-09-01T00:00:00.000Z");
    const { inputs, run } = runInputs(clock);
    const scheduler = new AutomaticReflectionScheduler({ max_input_bytes: 1, run, now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });

    scheduler.start();
    await flush();
    expect(inputs).toHaveLength(1);
    expect(clock.timers.filter((timer) => !timer.cancelled)).toHaveLength(1);
    expect(clock.timers.find((timer) => !timer.cancelled)?.at).toBe(epoch("2026-09-01T16:05:00.000Z"));
  });

  test("never overlaps runs and catches every crossed boundary with fresh now values", async () => {
    const clock = new FakeClock("2026-09-21T16:00:00.000Z");
    const first = deferred<void>();
    const second = deferred<void>();
    const inputs: RunDueAutomaticReflectionsInput[] = [];
    let active = 0;
    let peak = 0;
    let calls = 0;
    const scheduler = new AutomaticReflectionScheduler({
      max_input_bytes: 1,
      run: async (input) => {
        inputs.push(input);
        active += 1;
        peak = Math.max(peak, active);
        calls += 1;
        if (calls === 1) await first.promise;
        if (calls === 2) await second.promise;
        active -= 1;
        return { status: "completed", now: input.now, attempts: [], has_more: false };
      },
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    });

    scheduler.start();
    await flush();
    clock.nowMs = epoch("2026-09-21T16:31:00.000Z");
    first.resolve(undefined);
    await flush();
    expect(inputs.map((input) => input.now)).toEqual(["2026-09-21T16:00:00.000Z", "2026-09-21T16:31:00.000Z"]);
    expect(peak).toBe(1);
    second.resolve(undefined);
    await flush();
  });
  test("continues catch-up with zero-delay fresh runs and cancels a pending continuation", async () => {
    const clock = new FakeClock("2026-09-21T16:00:00.000Z");
    const first = deferred<void>();
    const inputs: RunDueAutomaticReflectionsInput[] = [];
    let active = 0;
    let peak = 0;
    let calls = 0;
    const scheduler = new AutomaticReflectionScheduler({
      max_input_bytes: 1,
      run: async (input) => {
        inputs.push(input);
        active += 1;
        peak = Math.max(peak, active);
        calls += 1;
        if (calls === 1) await first.promise;
        active -= 1;
        return { status: "completed", now: input.now, attempts: [], has_more: true };
      },
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    });

    scheduler.start();
    await flush();
    expect(calls).toBe(1);
    expect(active).toBe(1);
    expect(clock.timers.filter((timer) => !timer.cancelled)).toHaveLength(0);

    first.resolve(undefined);
    await flush();
    const continuation = clock.timers.find((timer) => !timer.cancelled);
    expect(continuation?.at).toBe(clock.nowMs);
    if (continuation === undefined) throw new Error("catch-up continuation was not armed");
    continuation.cancelled = true;
    clock.nowMs = epoch("2026-09-21T16:31:00.000Z");
    continuation.callback();
    await flush();

    expect(inputs.map((input) => input.now)).toEqual([
      "2026-09-21T16:00:00.000Z",
      "2026-09-21T16:31:00.000Z",
    ]);
    expect(peak).toBe(1);
    const cancelledContinuation = clock.timers.find((timer) => !timer.cancelled);
    expect(cancelledContinuation?.at).toBe(clock.nowMs);
    if (cancelledContinuation === undefined) throw new Error("second catch-up continuation was not armed");
    scheduler.close();
    cancelledContinuation.callback();
    await flush();
    expect(calls).toBe(2);
    expect(clock.timers.every((timer) => timer.cancelled)).toBe(true);
  });


  test("late timer callbacks use the callback's actual clock time", async () => {
    const clock = new FakeClock("2026-09-20T16:00:00.000Z");
    const { inputs, run } = runInputs(clock);
    const scheduler = new AutomaticReflectionScheduler({ max_input_bytes: 1, run, now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });

    scheduler.start();
    await flush();
    clock.nowMs = epoch("2026-09-20T16:30:00.000Z");
    const timer = clock.timers.find((item) => !item.cancelled);
    timer?.callback();
    await flush();

    expect(inputs[1]?.now).toBe("2026-09-20T16:30:00.000Z");
  });

  test("close cancels an armed timer and suppresses a late callback", async () => {
    const clock = new FakeClock("2026-09-20T16:00:00.000Z");
    const { inputs, run } = runInputs(clock);
    const scheduler = new AutomaticReflectionScheduler({
      max_input_bytes: 1,
      run,
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    });

    scheduler.start();
    await flush();
    const timer = clock.timers.find((item) => !item.cancelled);
    scheduler.close();
    timer?.callback();
    await flush();

    expect(inputs).toHaveLength(1);
    expect(clock.timers.every((item) => item.cancelled)).toBe(true);
  });

  test("close suppresses post-run scheduling for an active run", async () => {
    const clock = new FakeClock("2026-09-20T16:00:00.000Z");
    const gate = deferred<void>();
    const inputs: RunDueAutomaticReflectionsInput[] = [];
    const scheduler = new AutomaticReflectionScheduler({
      max_input_bytes: 1,
      run: async (input) => {
        inputs.push(input);
        await gate.promise;
        return { status: "completed", now: input.now, attempts: [], has_more: false };
      },
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    });

    scheduler.start();
    await flush();
    scheduler.close();
    gate.resolve(undefined);
    await flush();

    expect(inputs).toHaveLength(1);
    expect(clock.timers.every((timer) => timer.cancelled)).toBe(true);
  });

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1_048_577])("rejects invalid max_input_bytes %p", (max_input_bytes) => {
    expect(() => new AutomaticReflectionScheduler({
      max_input_bytes,
      run: async (input) => ({ status: "completed", now: input.now, attempts: [], has_more: false }),
    })).toThrow(TypeError);
  });
});
