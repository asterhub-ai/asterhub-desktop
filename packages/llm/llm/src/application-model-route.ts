/** Host-owned model routing policy used by child-model selectors. */
export interface ApplicationModelRoute {
  /** Provider selected by the deployment. */
  readonly provider: string
  /** Default model selected by the deployment. */
  readonly model: string
  /** Whether callers may select other models on this provider. */
  readonly selectableModels?: boolean
}

/**
 * Check whether an application permits selecting a child model on a provider.
 * @param route - Trusted deployment policy, absent for ordinary configurable routing.
 * @param requestedProvider - Proposed provider, or absent to query selector availability.
 * @returns Whether selection is enabled without leaving the deployment's provider.
 */
export function canSelectApplicationModel(route: ApplicationModelRoute | undefined, requestedProvider?: string): boolean {
  return route === undefined || route.selectableModels === true
    && (requestedProvider === undefined || requestedProvider === route.provider)
}
