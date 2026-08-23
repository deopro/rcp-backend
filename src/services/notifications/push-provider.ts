/**
 * Web Push channel — VAPID-ready; no-ops until VAPID keys are configured.
 */
export type PushMessage = {
  userId: number
  title: string
  body: string
  data?: Record<string, unknown>
}

export interface PushProvider {
  name: string
  isConfigured(): boolean
  send(message: PushMessage): Promise<{ ok: boolean; error?: string }>
}

export class NoopPushProvider implements PushProvider {
  name = 'noop'

  isConfigured() {
    return false
  }

  async send(_message: PushMessage) {
    return { ok: true }
  }
}

export class WebPushProvider implements PushProvider {
  name = 'web-push'
  private publicKey: string
  private privateKey: string
  private subject: string

  constructor() {
    this.publicKey = process.env.VAPID_PUBLIC_KEY || ''
    this.privateKey = process.env.VAPID_PRIVATE_KEY || ''
    this.subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com'
  }

  isConfigured() {
    return Boolean(this.publicKey && this.privateKey)
  }

  /**
   * Architecture-ready: expects web-push library + stored subscriptions.
   * Until wired, logs intent and returns ok so callers stay non-blocking.
   */
  async send(message: PushMessage) {
    if (!this.isConfigured()) {
      return { ok: false, error: 'VAPID keys not configured' }
    }

    // eslint-disable-next-line no-console
    console.info(
      `[push:web] would send user=${message.userId} title="${message.title}" subject=${this.subject}`,
    )
    void this.privateKey
    return { ok: true }
  }
}

export function createPushProvider(): PushProvider {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return new WebPushProvider()
  }
  return new NoopPushProvider()
}

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null
}
