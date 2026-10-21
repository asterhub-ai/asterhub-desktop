import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveDevelopmentHome, sourceDevelopmentHome, SOURCE_DEVELOPMENT_HOME_DIRECTORY } from './development-home.mjs'

const USER_HOME = resolve('/home/developer')
const PRODUCT_HOME = join(USER_HOME, '.asterhub')
const DEFAULT_HOME = join(USER_HOME, 'checkout', SOURCE_DEVELOPMENT_HOME_DIRECTORY)

describe('resolveDevelopmentHome', () => {
  it('uses the isolated default when DSH_HOME is unset', () => {
    expect(resolveDevelopmentHome({ defaultHome: DEFAULT_HOME, env: {}, userHome: USER_HOME })).toBe(DEFAULT_HOME)
  })

  it('uses the isolated default when DSH_HOME is blank instead of the working directory', () => {
    expect(resolveDevelopmentHome({ defaultHome: DEFAULT_HOME, env: { DSH_HOME: '   ' }, userHome: USER_HOME })).toBe(DEFAULT_HOME)
  })

  it('honors an explicit DSH_HOME', () => {
    expect(resolveDevelopmentHome({ defaultHome: DEFAULT_HOME, env: { DSH_HOME: join(USER_HOME, 'elsewhere') }, userHome: USER_HOME }))
      .toBe(join(USER_HOME, 'elsewhere'))
  })

  it('expands a ~-rooted DSH_HOME against the supplied user home', () => {
    expect(resolveDevelopmentHome({ defaultHome: DEFAULT_HOME, env: { DSH_HOME: '~/dev-home' }, userHome: USER_HOME }))
      .toBe(join(USER_HOME, 'dev-home'))
  })

  it('refuses the installed product home', () => {
    expect(() => resolveDevelopmentHome({ defaultHome: DEFAULT_HOME, env: { DSH_HOME: PRODUCT_HOME }, userHome: USER_HOME }))
      .toThrow(/installed product home/)
  })

  it('refuses a default that resolves to the installed product home', () => {
    expect(() => resolveDevelopmentHome({ defaultHome: PRODUCT_HOME, env: {}, userHome: USER_HOME }))
      .toThrow(/installed product home/)
  })
})

describe('sourceDevelopmentHome', () => {
  it('derives the development home from a repository root', () => {
    expect(sourceDevelopmentHome('/work/asterhub')).toBe(resolve('/work/asterhub', SOURCE_DEVELOPMENT_HOME_DIRECTORY))
  })
})
