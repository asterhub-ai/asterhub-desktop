// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { BootPage } from '../src/boot-page.ts'

afterEach(() => { document.body.innerHTML = '' })

function mount() {
  document.documentElement.lang = 'zh-CN'
  const el = document.createElement('div')
  document.body.append(el)
  return { el, page: new BootPage(el) }
}

describe('BootPage', () => {
  it('shows a static product mark without a loading animation or vendor names', () => {
    const { el } = mount()
    expect(el.textContent).toContain('AsterHub')
    expect(el.querySelector('[data-dsh-boot-spinner]')).toBeNull()
    expect(el.textContent).not.toMatch(/loading|deepseek|harness|sub2api|\bdsh\b/iu)
  })

  it('keeps the static product mark while entries activate', () => {
    const { el, page } = mount()
    page.setTotal(2)
    page.setState('one', 'active')
    page.setState('two', 'loading')
    expect(el.textContent).toBe('AsterHub')
    page.setState('two', 'active')
    expect(el.querySelector('[data-dsh-boot-spinner]')).toBeNull()
  })

  it('shows a generic startup failure without module names or raw details', () => {
    const { el, page } = mount()
    page.setState('@internal/plugin-name', 'failed')
    page.fail('internal endpoint and secret detail')
    expect(el.textContent).toContain('AsterHub 无法启动')
    expect(el.textContent).not.toContain('@internal/plugin-name')
    expect(el.textContent).not.toContain('internal endpoint')
  })

  it('detaches on disposal', () => {
    const { el, page } = mount()
    page.dispose()
    expect(el.childNodes).toHaveLength(0)
  })
})
