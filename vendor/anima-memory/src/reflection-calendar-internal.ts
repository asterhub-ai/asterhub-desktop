const TIMEZONE = "Asia/Shanghai" as const;
const NANOSECONDS_PER_MILLISECOND = 1_000_000n;
const NANOSECONDS_PER_SECOND = 1_000_000_000n;
const MILLISECONDS_PER_DAY = 86_400_000;
const OFFSET_SAMPLE_MILLISECONDS = [
  0,
  -MILLISECONDS_PER_DAY,
  MILLISECONDS_PER_DAY,
  -2 * MILLISECONDS_PER_DAY,
  2 * MILLISECONDS_PER_DAY,
  -370 * MILLISECONDS_PER_DAY,
  370 * MILLISECONDS_PER_DAY,
] as const;

type DateTimePartType = Intl.DateTimeFormatPart["type"];

export type CalendarDateTime = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond?: number;
  nanosecond?: number;
}>;

export type ZonedDateTimeParts = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  nanosecond: number;
}>;

const ZONED_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  calendar: "gregory",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "2-digit",
  numberingSystem: "latn",
  second: "2-digit",
  timeZone: TIMEZONE,
  year: "numeric",
});

function invalid(message: string): never {
  throw new TypeError(message);
}

function floorDiv(value: bigint, divisor: bigint): bigint {
  const quotient = value / divisor;
  const remainder = value % divisor;
  return remainder < 0n ? quotient - 1n : quotient;
}

function floorMod(value: bigint, divisor: bigint): bigint {
  const remainder = value % divisor;
  return remainder < 0n ? remainder + divisor : remainder;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function assertDateTime(value: CalendarDateTime): void {
  if (!Number.isInteger(value.year) || value.year < 1 || value.year > 9999) invalid("invalid local date-time");
  if (!Number.isInteger(value.month) || value.month < 1 || value.month > 12) invalid("invalid local date-time");
  if (!Number.isInteger(value.day) || value.day < 1 || value.day > daysInMonth(value.year, value.month)) invalid("invalid local date-time");
  if (!Number.isInteger(value.hour) || value.hour < 0 || value.hour > 23) invalid("invalid local date-time");
  if (!Number.isInteger(value.minute) || value.minute < 0 || value.minute > 59) invalid("invalid local date-time");
  if (!Number.isInteger(value.second) || value.second < 0 || value.second > 59) invalid("invalid local date-time");
  if (value.millisecond !== undefined && (!Number.isInteger(value.millisecond) || value.millisecond < 0 || value.millisecond > 999)) {
    invalid("invalid local date-time");
  }
  const nanosecond = value.nanosecond ?? 0;
  if (!Number.isInteger(nanosecond) || nanosecond < 0 || nanosecond > 999_999_999) invalid("invalid local date-time");
}

function calendarDateToUtcMilliseconds(value: CalendarDateTime): number {
  const date = new Date(0);
  date.setUTCFullYear(value.year, value.month - 1, value.day);
  const millisecond = value.millisecond ?? Math.floor((value.nanosecond ?? 0) / 1_000_000);
  date.setUTCHours(value.hour, value.minute, value.second, millisecond);
  const milliseconds = date.getTime();
  if (!Number.isFinite(milliseconds)) invalid("local date-time is outside the supported range");
  return milliseconds;
}

function unvalidatedCalendarDateToUtcMilliseconds(value: Omit<ZonedDateTimeParts, "nanosecond">): number {
  const date = new Date(0);
  date.setUTCFullYear(value.year, value.month - 1, value.day);
  date.setUTCHours(value.hour, value.minute, value.second, value.millisecond);
  const milliseconds = date.getTime();
  if (!Number.isFinite(milliseconds)) invalid("timezone part is outside the supported range");
  return milliseconds;
}

export function localDateTimeToUtcEpochNanoseconds(value: CalendarDateTime): bigint {
  assertDateTime(value);
  const subMillisecond = (value.nanosecond ?? 0) % 1_000_000;
  return BigInt(calendarDateToUtcMilliseconds(value)) * NANOSECONDS_PER_MILLISECOND + BigInt(subMillisecond);
}

function partValue(parts: Intl.DateTimeFormatPart[], type: DateTimePartType): number {
  const value = parts.find((part) => part.type === type)?.value;
  if (value === undefined) invalid("timezone formatter omitted a required part");
  const number = Number(value);
  if (!Number.isInteger(number)) invalid("timezone formatter returned an invalid part");
  return number;
}

function formatZonedParts(epochMilliseconds: number): Omit<ZonedDateTimeParts, "nanosecond"> {
  const parts = ZONED_PARTS_FORMATTER.formatToParts(epochMilliseconds);
  return {
    year: partValue(parts, "year"),
    month: partValue(parts, "month"),
    day: partValue(parts, "day"),
    hour: partValue(parts, "hour"),
    minute: partValue(parts, "minute"),
    second: partValue(parts, "second"),
    millisecond: ((epochMilliseconds % 1000) + 1000) % 1000,
  };
}

export function epochNanosecondsToZonedParts(epochNanoseconds: bigint): ZonedDateTimeParts {
  const epochMilliseconds = floorDiv(epochNanoseconds, NANOSECONDS_PER_MILLISECOND);
  const epochMillisecondsNumber = Number(epochMilliseconds);
  if (!Number.isSafeInteger(epochMillisecondsNumber)) invalid("instant is outside the supported date range");
  const parts = formatZonedParts(epochMillisecondsNumber);
  return { ...parts, nanosecond: Number(floorMod(epochNanoseconds, NANOSECONDS_PER_SECOND)) };
}

export function floorEpochNanosecondsToMilliseconds(epochNanoseconds: bigint): number {
  const milliseconds = floorDiv(epochNanoseconds, NANOSECONDS_PER_MILLISECOND);
  const value = Number(milliseconds);
  if (!Number.isSafeInteger(value) || !Number.isFinite(value)) invalid("instant is outside the supported date range");
  return value;
}

function offsetSecondsAt(epochMilliseconds: number): number {
  const parts = formatZonedParts(epochMilliseconds);
  const wallMilliseconds = BigInt(unvalidatedCalendarDateToUtcMilliseconds(parts));
  const offsetMilliseconds = wallMilliseconds - BigInt(epochMilliseconds);
  if (offsetMilliseconds % 1000n !== 0n) invalid("timezone offset is not an integral second");
  return Number(offsetMilliseconds / 1000n);
}

export function collectNearbyOffsets(localDateTime: CalendarDateTime): readonly number[] {
  const localEpochMilliseconds = floorEpochNanosecondsToMilliseconds(localDateTimeToUtcEpochNanoseconds(localDateTime));
  const offsets = new Set<number>();
  for (const delta of OFFSET_SAMPLE_MILLISECONDS) offsets.add(offsetSecondsAt(localEpochMilliseconds + delta));
  return [...offsets];
}

function sameDateTime(left: ZonedDateTimeParts, right: CalendarDateTime): boolean {
  return left.year === right.year && left.month === right.month && left.day === right.day && left.hour === right.hour &&
    left.minute === right.minute && left.second === right.second && left.nanosecond === (right.nanosecond ?? 0);
}

function exactMatches(localDateTime: CalendarDateTime, offsets: readonly number[]): bigint[] {
  const localEpochNanoseconds = localDateTimeToUtcEpochNanoseconds(localDateTime);
  const matches: bigint[] = [];
  for (const offset of offsets) {
    const candidate = localEpochNanoseconds - BigInt(offset) * NANOSECONDS_PER_SECOND;
    if (sameDateTime(epochNanosecondsToZonedParts(candidate), localDateTime)) matches.push(candidate);
  }
  return matches;
}

function gapDelta(localDateTime: CalendarDateTime, offsets: readonly number[]): number | undefined {
  const localEpochNanoseconds = localDateTimeToUtcEpochNanoseconds(localDateTime);
  for (const before of offsets) {
    for (const after of offsets) {
      if (after <= before) continue;
      const candidateBefore = localEpochNanoseconds - BigInt(after) * NANOSECONDS_PER_SECOND;
      const candidateAfter = localEpochNanoseconds - BigInt(before) * NANOSECONDS_PER_SECOND;
      if (offsetSecondsAt(floorEpochNanosecondsToMilliseconds(candidateBefore)) !== before) continue;
      if (offsetSecondsAt(floorEpochNanosecondsToMilliseconds(candidateAfter)) !== after) continue;
      return after - before;
    }
  }
  return undefined;
}

function utcEpochNanosecondsToCalendarDateTime(epochNanoseconds: bigint): CalendarDateTime {
  const date = new Date(floorEpochNanosecondsToMilliseconds(epochNanoseconds));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    nanosecond: Number(floorMod(epochNanoseconds, NANOSECONDS_PER_SECOND)),
  };
}

/** Resolve a local Asia/Shanghai date-time with Temporal-compatible gap/fold semantics. */
export function localDateTimeToEpochNanoseconds(localDateTime: CalendarDateTime): bigint {
  assertDateTime(localDateTime);
  const offsets = collectNearbyOffsets(localDateTime);
  const matches = exactMatches(localDateTime, offsets);
  if (matches.length > 0) return matches.reduce((earliest, value) => (value < earliest ? value : earliest));

  const shiftSeconds = gapDelta(localDateTime, offsets);
  if (shiftSeconds !== undefined) {
    const shiftedLocal = utcEpochNanosecondsToCalendarDateTime(
      localDateTimeToUtcEpochNanoseconds(localDateTime) + BigInt(shiftSeconds) * NANOSECONDS_PER_SECOND,
    );
    const shiftedMatches = exactMatches(shiftedLocal, offsets);
    if (shiftedMatches.length > 0) return shiftedMatches.reduce((earliest, value) => (value < earliest ? value : earliest));
  }

  invalid("local date-time does not exist in Asia/Shanghai");
}
