/**
 * Desktop-only native AsterHub schedule bundle.
 *
 * Appended after the shared Web composition in the Desktop-owned profile,
 * dev, and runtime metadata. The patch inserts the schedule Host
 * service (`schedule`), the schedule task panel (`ui-schedule`),
 * and a Desktop-only clock row (`asterhub-time-context`) over the empty profile root.
 *
 * The bundle carries no runtime code of its own: the inserted rows point
 * at the owning packages, whose node halves are loaded by the profile
 * runner. This empty apply exists so the bundle is importable as a plugin
 * module by tooling that expects one.
 */

/** Host plugin body — the inserted rows own the runtime code. */
export function apply(): void {}
