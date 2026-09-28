// @vitest-environment jsdom
/** Account actions remain wired to the Host state through the injected slot face. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { AccountSection, type AccountSectionProps } from '../src/client/AccountSection.tsx'
import { AccountGate, type AccountGateProps } from '../src/client/AccountGate.tsx'
import { apply, inject } from '../src/client/index.ts'
import { ACCOUNT_COMMAND_EVENT } from '../src/client/account-api.ts'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const t = (key: keyof typeof zh) => zh[key]
const loggedOut = { loggedIn: false, keyBound: false }
const loggedIn = {
  loggedIn: true, keyBound: true,
  user: { id: 'test-user', email: 'test@example.invalid' }, balance: 12,
}

function section(overrides: Record<string, unknown> = {}) {
  const props = {
    t,
    getStatus: vi.fn().mockResolvedValue({ ok: true, value: loggedOut }),
    login: vi.fn().mockResolvedValue({ ok: true, value: loggedIn }),
    logout: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    quota: vi.fn().mockResolvedValue({ ok: true, value: { balance: 12 } }),
    paymentMethods: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    topUp: vi.fn(),
    redeem: vi.fn(),
    ...overrides,
  } as unknown as AccountSectionProps
  return { props, view: render(<AccountSection {...props} />) }
}

describe('Account settings entry', () => {
  it('waits for the account Remote namespace before mounting the client plugin', async () => {
    const runtime = await SlotTestRuntime.create()
    try {
      const locale = new LocaleRuntime(runtime.ctx)
      runtime.ctx.provide('locale', locale)
      runtime.slots.installLocale(locale)
      await expect(runtime.mount({ inject: [...inject], apply }))
        .rejects.toThrow('remote.accountSub2api')
      runtime.remote.provideNamespaces({ accountSub2api: {} })
      await expect(runtime.mount({ inject: [...inject], apply })).resolves.toBeTruthy()
    } finally {
      await runtime.dispose()
    }
  })

  it('loads Host status on mount and retries an unavailable service', async () => {
    const getStatus = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, value: loggedOut })
    section({ getStatus })
    expect(await screen.findByText(zh.serviceUnavailable)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.refresh }))
    expect(await screen.findByRole('button', { name: zh.loginButton })).toBeTruthy()
    expect(getStatus).toHaveBeenCalledTimes(2)
  })

  it('refreshes Host state after login and logout', async () => {
    const getStatus = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: loggedOut })
      .mockResolvedValueOnce({ ok: true, value: loggedIn })
      .mockResolvedValueOnce({ ok: true, value: loggedOut })
    const login = vi.fn().mockResolvedValue({ ok: true, value: loggedIn })
    const logout = vi.fn().mockResolvedValue({ ok: true, value: undefined })
    section({ getStatus, login, logout })
    await screen.findByRole('button', { name: zh.loginButton })
    fireEvent.click(screen.getByRole('checkbox', { name: zh.rememberUsername }))
    fireEvent.change(await screen.findByLabelText(zh.emailLabel), { target: { value: 'test@example.invalid' } })
    fireEvent.change(screen.getByLabelText(zh.passwordLabel), { target: { value: 'local-test-only' } })
    fireEvent.click(screen.getByRole('button', { name: zh.loginButton }))
    await waitFor(() => expect(screen.getByText((_, element) => (
      element?.tagName === 'P' && element.textContent?.includes('test@example.invalid') === true
    ))).toBeTruthy())
    expect(login).toHaveBeenCalledWith({
      email: 'test@example.invalid', password: 'local-test-only', rememberUsername: true, autoLogin: false,
    })
    fireEvent.click(screen.getByRole('button', { name: zh.logoutButton }))
    await waitFor(() => expect(screen.getByRole('button', { name: zh.loginButton })).toBeTruthy())
    expect(getStatus).toHaveBeenCalledTimes(3)
  })

  it('disables top-up when no payment method is available', async () => {
    section({ getStatus: vi.fn().mockResolvedValue({ ok: true, value: loggedIn }) })
    expect(await screen.findByText(zh.noPaymentMethods)).toBeTruthy()
    expect((screen.getByRole('button', { name: zh.topUpButton }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('sends the chosen method with a top-up request and opens its checkout URL', async () => {
    const paymentMethods = vi.fn().mockResolvedValue({ ok: true, value: [
      { id: 'alipay', label: '支付宝' }, { id: 'wxpay', label: '微信支付' },
    ] })
    const topUp = vi.fn().mockResolvedValue({
      ok: true, value: { id: 'order-1', status: 'created', checkoutUrl: 'https://pay.example/checkout' },
    })
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    section({ getStatus: vi.fn().mockResolvedValue({ ok: true, value: loggedIn }), paymentMethods, topUp })
    await screen.findByRole('button', { name: zh.topUpButton })
    await waitFor(() => expect((screen.getByRole('button', { name: zh.topUpButton }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.change(screen.getByLabelText(zh.paymentMethod), { target: { value: 'wxpay' } })
    fireEvent.click(screen.getByRole('button', { name: zh.topUpButton }))
    await waitFor(() => expect(topUp).toHaveBeenCalledWith({ amount: 10, paymentType: 'wxpay' }))
    expect(open).toHaveBeenCalledWith('https://pay.example/checkout', '_blank')
  })
})

describe('Application account gate', () => {
  it('opens directly on the login form and reveals the workspace after authentication', async () => {
    const getStatus = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: loggedOut })
      .mockResolvedValue({ ok: true, value: loggedIn })
    const login = vi.fn().mockResolvedValue({
      ok: true, value: { ...loggedIn, rememberedUsername: 'test@example.invalid', autoLogin: true },
    })
    const props = {
      t,
      getStatus,
      login,
      logout: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
      quota: vi.fn(),
      paymentMethods: vi.fn().mockResolvedValue({ ok: true, value: [] }),
      topUp: vi.fn(),
      redeem: vi.fn(),
    } as unknown as AccountGateProps
    render(<AccountGate {...props} />)
    expect(screen.getByText('AsterHub')).toBeTruthy()
    await screen.findByLabelText(zh.emailLabel)
    fireEvent.click(screen.getByRole('checkbox', { name: zh.autoLogin }))
    expect((screen.getByRole('checkbox', { name: zh.rememberUsername }) as HTMLInputElement).checked).toBe(true)
    fireEvent.change(await screen.findByLabelText(zh.emailLabel), { target: { value: 'test@example.invalid' } })
    fireEvent.change(screen.getByLabelText(zh.passwordLabel), { target: { value: 'local-test-only' } })
    await waitFor(() => expect((screen.getByRole('button', { name: zh.loginButton }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: zh.loginButton }))
    expect(login).toHaveBeenCalledWith({
      email: 'test@example.invalid', password: 'local-test-only', rememberUsername: true, autoLogin: true,
    })
    await waitFor(() => expect(screen.queryByText('AsterHub')).toBeNull())
  })

  it('handles account open and logout commands from the native menu', async () => {
    const getStatus = vi.fn().mockResolvedValue({ ok: true, value: loggedIn })
    const logout = vi.fn().mockResolvedValue({ ok: true, value: undefined })
    const props = {
      t, getStatus, login: vi.fn(), logout, quota: vi.fn(),
      paymentMethods: vi.fn().mockResolvedValue({ ok: true, value: [] }),
      topUp: vi.fn(), redeem: vi.fn(),
    } as unknown as AccountGateProps
    render(<AccountGate {...props} />)
    await waitFor(() => expect(screen.queryByText('AsterHub')).toBeNull())
    window.dispatchEvent(new CustomEvent(ACCOUNT_COMMAND_EVENT, { detail: 'open' }))
    expect(await screen.findByText('AsterHub')).toBeTruthy()
    await screen.findByRole('button', { name: zh.logoutButton })
    fireEvent.click(screen.getByRole('button', { name: zh.backToWorkspace }))
    await waitFor(() => expect(screen.queryByText('AsterHub')).toBeNull())

    getStatus.mockResolvedValue({ ok: true, value: loggedOut })
    window.dispatchEvent(new CustomEvent(ACCOUNT_COMMAND_EVENT, { detail: 'logout' }))
    expect(await screen.findByRole('button', { name: zh.loginButton })).toBeTruthy()
    expect(logout).toHaveBeenCalledOnce()
  })
})
