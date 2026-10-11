/** Correlated requests to Electron's OS-backed credential encryption service. */

import type { CredentialCipher } from '@deepseek-ai/dsh-credentials'

interface PendingRequest {
  resolve(value: string): void
  reject(error: Error): void
}

/** Host-side credential cipher; plaintext crosses only the private child-process IPC channel. */
export class DesktopCredentialCipher implements CredentialCipher {
  private nextRequestId = 1
  private readonly pending = new Map<number, PendingRequest>()

  /**
   * Encrypt one document through the Electron main process.
   * @param plaintext - document text to encrypt.
   * @returns the opaque encrypted value.
   */
  encrypt(plaintext: string): Promise<string> {
    return this.request('encrypt', plaintext)
  }

  /**
   * Decrypt one document through the Electron main process.
   * @param ciphertext - the opaque encrypted value.
   * @returns the document text.
   */
  decrypt(ciphertext: string): Promise<string> {
    return this.request('decrypt', ciphertext)
  }

  /**
   * Resolve a reply from the shell process; unrelated process messages pass through.
   * @param message - the child-process message to inspect.
   * @returns whether this cipher consumed the message.
   */
  receive(message: unknown): boolean {
    if (typeof message !== 'object' || message === null || !('type' in message)
      || message.type !== 'credential-cipher/result' || !('requestId' in message)
      || !Number.isSafeInteger(message.requestId)) return false
    const requestId = message.requestId as number
    const request = this.pending.get(requestId)
    if (request === undefined) return true
    this.pending.delete(requestId)
    if ('error' in message && typeof message.error === 'string') request.reject(new Error(message.error))
    else if ('value' in message && typeof message.value === 'string') request.resolve(message.value)
    else request.reject(new Error('desktop credential cipher returned an invalid response'))
    return true
  }

  /**
   * Reject in-flight operations when the shell channel closes.
   * @returns nothing.
   */
  dispose(): void {
    for (const request of this.pending.values()) request.reject(new Error('desktop credential cipher is unavailable'))
    this.pending.clear()
  }

  private request(operation: 'encrypt' | 'decrypt', value: string): Promise<string> {
    if (!process.connected || process.send === undefined) return Promise.reject(new Error('desktop credential cipher is unavailable'))
    const requestId = this.nextRequestId++
    return new Promise<string>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject })
      process.send?.({ type: 'credential-cipher/request', requestId, operation, value }, (error) => {
        if (error === null) return
        this.pending.delete(requestId)
        reject(new Error('desktop credential cipher request failed'))
      })
    })
  }
}
