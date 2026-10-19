import { describe, expect, test } from "vitest";
import {
  AUTOMATIC_REFLECTION_COMPLETE_PERIOD,
  AUTOMATIC_REFLECTION_MAX_YEAR,
  AUTOMATIC_REFLECTION_MIN_YEAR,
  AUTOMATIC_REFLECTION_TIMEZONE,
  automaticReflectionSelector,
  compareInstants,
  formatUtcInstant,
  nextAutomaticBoundary,
  nextAutomaticCursorPeriod,
  nextPeriodKey,
  parseInstant,
  periodKeyContaining,
  selectorContains,
  selectorDueAt,
} from "../src/index.ts";
import { localDateTimeToEpochNanoseconds } from "../src/reflection-calendar-internal.ts";

const PROJECT_UID = "00000000-0000-4000-8000-000000000001";

function rejects(action: () => unknown): void {
  expect(action).toThrow(TypeError);
}

describe("strict instant primitives", () => {
  test("parses fractional seconds from one through nine digits and preserves offset semantics", () => {
    expect(parseInstant("2026-01-01T00:00:00.1Z")).toBe(Date.parse("2026-01-01T00:00:00.100Z"));
    expect(parseInstant("2026-01-01T00:00:00.12Z")).toBe(Date.parse("2026-01-01T00:00:00.120Z"));
    expect(parseInstant("2026-01-01T00:00:00.123Z")).toBe(Date.parse("2026-01-01T00:00:00.123Z"));
    expect(parseInstant("2026-01-01T00:00:00.123456789Z")).toBe(Date.parse("2026-01-01T00:00:00.123Z"));
    expect(parseInstant("2026-01-01T08:00:00+08:00")).toBe(parseInstant("2026-01-01T00:00:00Z"));
    expect(parseInstant("2025-12-31T19:00:00-05:00")).toBe(parseInstant("2026-01-01T00:00:00Z"));
  });

  test("rejects malformed, offset-free, invalid-date, invalid-time, and invalid-offset timestamps", () => {
    for (const value of [
      "0000-01-01T00:00:00Z",
      "2026-01-01T00:00:00",
      "2026-02-29T00:00:00Z",
      "2024-02-30T00:00:00Z",
      "2026-01-01T24:00:00Z",
      "2026-01-01T00:60:00Z",
      "2026-01-01T00:00:00+24:00",
      "2026-01-01T00:00:00+08:60",
      "2026-01-01T00:00:00.1234567890Z",
      "2026-01-01T00:00:00z",
    ]) {
      rejects(() => parseInstant(value));
    }
  });

  test("formats UTC epoch milliseconds exactly", () => {
    expect(formatUtcInstant(parseInstant("2026-01-01T08:00:00.12+08:00"))).toBe("2026-01-01T00:00:00.120Z");
  });

  test("keeps UTC formatting inside the nonzero four-digit year range", () => {
    const yearZero = new Date(0);
    yearZero.setUTCFullYear(0, 0, 1);
    yearZero.setUTCHours(0, 0, 0, 0);
    rejects(() => formatUtcInstant(yearZero.getTime()));

    const yearTenThousand = new Date(0);
    yearTenThousand.setUTCFullYear(10_000, 0, 1);
    yearTenThousand.setUTCHours(0, 0, 0, 0);
    rejects(() => formatUtcInstant(yearTenThousand.getTime()));
  });
});

describe("automatic reflection calendar", () => {
  test("exposes the supported automatic local year range", () => {
    expect(AUTOMATIC_REFLECTION_MIN_YEAR).toBe(2);
    expect(AUTOMATIC_REFLECTION_MAX_YEAR).toBe(9998);
  });

  test("rejects automatic years outside the supported local range", () => {
    rejects(() => automaticReflectionSelector(PROJECT_UID, "daily", "0001-12-31"));
    rejects(() => automaticReflectionSelector(PROJECT_UID, "monthly", "9999-12"));
    rejects(() => periodKeyContaining("daily", "0001-12-31T15:00:00Z"));
    rejects(() => periodKeyContaining("weekly", "0001-12-31T16:00:00Z"));
    rejects(() => periodKeyContaining("daily", "9998-12-31T16:00:00Z"));
    rejects(() => nextAutomaticBoundary("0001-12-31T15:00:00Z"));
    expect(nextAutomaticBoundary("9998-12-31T15:59:59.999Z")).toBe("9998-12-31T16:05:00.000Z");

    expect(nextAutomaticBoundary("9998-12-31T16:30:00Z")).toBe("9999-01-03T16:15:00.000Z");
  });

  test("serializes the lower automatic boundary with four-digit UTC years", () => {
    expect(automaticReflectionSelector(PROJECT_UID, "daily", "0002-01-01")).toMatchObject({
      period_key: "0002-01-01",
      start_at: "0001-12-31T15:54:17.000Z",
      end_at: "0002-01-01T15:54:17.000Z",
    });
  });

  test("rejects period successors crossing the final automatic year", () => {
    expect(nextPeriodKey("daily", "9998-12-30")).toBe("9998-12-31");
    expect(nextPeriodKey("weekly", "9998-12-21")).toBe("9998-12-28");
    expect(nextPeriodKey("monthly", "9998-11")).toBe("9998-12");
    rejects(() => nextPeriodKey("daily", "9998-12-31"));
    rejects(() => nextPeriodKey("weekly", "9998-12-28"));
    rejects(() => nextPeriodKey("monthly", "9998-12"));
    rejects(() => nextPeriodKey("daily", "9999-12-31"));
  });
  test("keeps final selector due instants four-digit", () => {
    const selector = automaticReflectionSelector(PROJECT_UID, "weekly", "9998-12-28");
    expect(selector.end_at).toBe("9999-01-03T16:00:00.000Z");
    expect(selectorDueAt(selector)).toBe("9999-01-03T16:15:00.000Z");
  });

  test("constructs frozen daily selectors across a Shanghai-local UTC date rollover", () => {
    const selector = automaticReflectionSelector(PROJECT_UID, "daily", "2026-03-01");
    expect(Object.keys(selector)).toEqual(["kind", "project_uid", "timezone", "period_key", "start_at", "end_at"]);
    expect(Object.isFrozen(selector)).toBe(true);
    expect(selector).toEqual({
      kind: "daily",
      project_uid: PROJECT_UID,
      timezone: AUTOMATIC_REFLECTION_TIMEZONE,
      period_key: "2026-03-01",
      start_at: "2026-02-28T16:00:00.000Z",
      end_at: "2026-03-01T16:00:00.000Z",
    });
  });

  test("validates weekly Monday keys and computes seven-day bounds", () => {
    const selector = automaticReflectionSelector(PROJECT_UID, "weekly", "2026-03-02");
    expect(selector.start_at).toBe("2026-03-01T16:00:00.000Z");
    expect(selector.end_at).toBe("2026-03-08T16:00:00.000Z");
    rejects(() => automaticReflectionSelector(PROJECT_UID, "weekly", "2026-03-03"));
  });

  test("handles leap-day and month/year rollover", () => {
    const leap = automaticReflectionSelector(PROJECT_UID, "daily", "2024-02-29");
    expect(leap.end_at).toBe("2024-02-29T16:00:00.000Z");
    const year = automaticReflectionSelector(PROJECT_UID, "monthly", "2025-12");
    expect(year.start_at).toBe("2025-11-30T16:00:00.000Z");
    expect(year.end_at).toBe("2025-12-31T16:00:00.000Z");
    expect(nextPeriodKey("monthly", "2025-12")).toBe("2026-01");
    expect(nextPeriodKey("daily", "2024-02-29")).toBe("2024-03-01");
  });

  test("finds containing daily, weekly, and monthly period keys using Shanghai local dates", () => {
    const instant = "2026-03-01T15:59:59.999Z";
    expect(periodKeyContaining("daily", instant)).toBe("2026-03-01");
    expect(periodKeyContaining("weekly", instant)).toBe("2026-02-23");
    expect(periodKeyContaining("monthly", instant)).toBe("2026-03");
    expect(periodKeyContaining("daily", "2026-03-01T16:00:00Z")).toBe("2026-03-02");
  });

  test("computes all fixed due times", () => {
    expect(selectorDueAt(automaticReflectionSelector(PROJECT_UID, "daily", "2026-03-01"))).toBe("2026-03-01T16:05:00.000Z");
    expect(selectorDueAt(automaticReflectionSelector(PROJECT_UID, "weekly", "2026-03-02"))).toBe("2026-03-08T16:15:00.000Z");
    expect(selectorDueAt(automaticReflectionSelector(PROJECT_UID, "monthly", "2026-02"))).toBe("2026-02-28T16:30:00.000Z");
  });

  test("uses exact half-open membership boundaries", () => {
    const selector = automaticReflectionSelector(PROJECT_UID, "daily", "2026-03-01");
    expect(selectorContains(selector, selector.start_at)).toBe(true);
    expect(selectorContains(selector, selector.end_at)).toBe(false);
    expect(selectorContains(selector, "2026-03-01T15:59:59.999Z")).toBe(true);
  });

  test("selects the earliest future boundary when Monday and month start collide", () => {
    expect(nextAutomaticBoundary("2026-05-31T16:00:00Z")).toBe("2026-05-31T16:05:00.000Z");
    expect(nextAutomaticBoundary("2026-05-31T16:00:00+08:00")).toBe("2026-05-31T16:05:00.000Z");
    expect(nextAutomaticBoundary("2026-05-31T16:05:00Z")).toBe("2026-05-31T16:15:00.000Z");
    expect(nextAutomaticBoundary("2026-05-31T16:30:00Z")).toBe("2026-06-01T16:05:00.000Z");
  });
});

describe("exact calendar edge cases", () => {
  test("floors pre-epoch fractional instants and compares nanoseconds exactly", () => {
    expect(parseInstant("1969-12-31T23:59:59.999999999Z")).toBe(-1);
    expect(compareInstants("2026-01-01T00:00:00.000000001Z", "2026-01-01T00:00:00.000000002Z")).toBe(-1);
    expect(compareInstants("2026-01-01T00:00:00.000000002Z", "2026-01-01T00:00:00.000000001Z")).toBe(1);
  });

  test("rejects normalized UTC values outside the four-digit range and invalid fourteen-hour offsets", () => {
    for (const value of [
      "0001-01-01T00:00:00+14:00",
      "9999-12-31T23:59:59.999-14:00",
      "2026-01-01T00:00:00+14:01",
      "2026-01-01T00:00:00-14:01",
    ]) {
      rejects(() => parseInstant(value));
    }
  });

  test("keeps nanosecond half-open membership exact", () => {
    const selector = automaticReflectionSelector(PROJECT_UID, "daily", "2026-03-01");
    expect(selectorContains(selector, "2026-02-28T16:00:00.000000001Z")).toBe(true);
    expect(selectorContains(selector, "2026-03-01T15:59:59.999999999Z")).toBe(true);
    expect(selectorContains(selector, "2026-03-01T16:00:00.000000001Z")).toBe(false);
  });

  test("returns the earliest instant for an exact historical fold", () => {
    const local = localDateTimeToEpochNanoseconds({
      year: 1991,
      month: 9,
      day: 15,
      hour: 1,
      minute: 30,
      second: 0,
    });
    expect(formatUtcInstant(Number(local / 1_000_000n))).toBe("1991-09-14T16:30:00.000Z");
  });

  test("shifts the 1919 Shanghai midnight gap by the exact offset delta", () => {
    const selector = automaticReflectionSelector(PROJECT_UID, "daily", "1919-04-12");
    expect(selector.start_at).toBe("1919-04-11T16:00:00.000Z");
    expect(selectorDueAt(selector)).toBe("1919-04-12T16:05:00.000Z");
  });

  test("keeps the 1919 Shanghai gap-shifted daily boundary after the jump", () => {
    expect(nextAutomaticBoundary("1919-04-12T16:00:00Z")).toBe("1919-04-12T16:05:00.000Z");
    expect(nextAutomaticBoundary("1919-04-12T16:04:59.999Z")).toBe("1919-04-12T16:05:00.000Z");
    expect(nextAutomaticBoundary("1919-04-12T16:05:00Z")).toBe("1919-04-13T15:05:00.000Z");
    expect(nextAutomaticBoundary("1919-04-12T16:05:00.001Z")).toBe("1919-04-13T15:05:00.000Z");
  });

  test("preserves pre-1901 Shanghai LMT seconds", () => {
    const selector = automaticReflectionSelector(PROJECT_UID, "daily", "1900-01-01");
    expect(selector.start_at).toBe("1899-12-31T15:54:17.000Z");
  });

  test("returns a finite cursor and boundary terminal sequence", () => {
    expect(nextAutomaticCursorPeriod("daily", "9998-12-31")).toBe(AUTOMATIC_REFLECTION_COMPLETE_PERIOD);
    expect(nextAutomaticCursorPeriod("weekly", "9998-12-28")).toBe(AUTOMATIC_REFLECTION_COMPLETE_PERIOD);
    expect(nextAutomaticCursorPeriod("monthly", "9998-12")).toBe(AUTOMATIC_REFLECTION_COMPLETE_PERIOD);
    rejects(() => nextAutomaticCursorPeriod("daily", AUTOMATIC_REFLECTION_COMPLETE_PERIOD));

    expect(nextAutomaticBoundary("9998-12-31T15:59:59Z")).toBe("9998-12-31T16:05:00.000Z");
    expect(nextAutomaticBoundary("9998-12-31T16:05:00Z")).toBe("9998-12-31T16:30:00.000Z");
    expect(nextAutomaticBoundary("9998-12-31T16:30:00Z")).toBe("9999-01-03T16:15:00.000Z");
    rejects(() => nextAutomaticBoundary("9999-01-03T16:15:00Z"));
  });
});
