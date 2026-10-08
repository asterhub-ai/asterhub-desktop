// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ThinkingStar } from '../src/client/chat/ThinkingStar.tsx'

afterEach(cleanup)

describe('ThinkingStar', () => {
  it('renders two decorative AsterHub sparkles', () => {
    const view = render(<ThinkingStar />)
    const svg = view.container.querySelector('svg')!
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.querySelectorAll('path')).toHaveLength(2)
    expect(svg.querySelectorAll('path')[0]?.getAttribute('class')).toContain('thinkingStarMain')
    expect(svg.querySelectorAll('path')[1]?.getAttribute('class')).toContain('thinkingStarAccent')
    expect(svg.querySelector('animate')).toBeNull()
  })
})
