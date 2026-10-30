import { describe, expect, it } from 'vitest'
import { canSelectApplicationModel, type ApplicationModelRoute } from '../src/application-model-route.ts'

const selectable: ApplicationModelRoute = {
  provider: 'sub2api',
  model: '__unselected__',
  selectableModels: true,
}

describe('application model selection policy', () => {
  it('allows choosing account models without changing the deployment provider', () => {
    expect(canSelectApplicationModel(selectable)).toBe(true)
    expect(canSelectApplicationModel(selectable, 'sub2api')).toBe(true)
    expect(canSelectApplicationModel(selectable, 'other-provider')).toBe(false)
  })

  it('does not expose model overrides for a fixed deployment route', () => {
    for (const route of [
      { provider: 'sub2api', model: 'fixed-model' },
      { provider: 'sub2api', model: 'fixed-model', selectableModels: false },
    ]) {
      expect(canSelectApplicationModel(route)).toBe(false)
      expect(canSelectApplicationModel(route, 'sub2api')).toBe(false)
      expect(canSelectApplicationModel(route, 'other-provider')).toBe(false)
    }
  })

  it('allows ordinary provider selection without an application route', () => {
    expect(canSelectApplicationModel(undefined)).toBe(true)
    expect(canSelectApplicationModel(undefined, 'other-provider')).toBe(true)
  })
})
