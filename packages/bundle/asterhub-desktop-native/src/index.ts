/**
 * Desktop-only native AsterHub automation bundle.
 *
 * Appended after the shared Web composition in the Desktop-owned profile,
 * dev, and runtime metadata. The patch inserts the native automation Host
 * service (`asterhub-automation`), the native task panel
 * (`ui-asterhub-automation`), and a Desktop-only clock row
 * (`asterhub-time-context`) over the empty profile root. The Host service
 * owns durable task management, the timer-driven runtime, account-scoped
 * execution, and the typed `automation` Remote namespace. The panel
 * registers a main keyed panel directly below Plugins and the sidebar
 * entry that opens it.
 *
 * The bundle carries no runtime code of its own: the inserted rows point
 * at the owning packages, whose node halves are loaded by the profile
 * runner. This empty apply exists so the bundle is importable as a plugin
 * module by tooling that expects one.
 */

/** Host plugin body — the inserted rows own the runtime code. */
export function apply(): void {}
