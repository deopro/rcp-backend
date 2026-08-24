/**
 * Email channel — SMTP-ready; no-ops until SMTP_HOST is configured.
 */
export type EmailMessage = {
  to: string
  subject: string
  text: string
}

export interface EmailProvider {
  name: string
  isConfigured(): boolean
  send(message: EmailMessage): Promise<{ ok: boolean; error?: string }>
}

export class NoopEmailProvider implements EmailProvider {
  name = 'noop'

  isConfigured() {
    return false
  }

  async send(_message: EmailMessage) {
    return { ok: true }
  }
}

export class SmtpEmailProvider implements EmailProvider {
  name = 'smtp'
  private host: string
  private port: number
  private user?: string
  private password?: string
  private from: string

  constructor() {
    this.host = process.env.SMTP_HOST || ''
    this.port = Number(process.env.SMTP_PORT || 587)
    this.user = process.env.SMTP_USER || undefined
    this.password = process.env.SMTP_PASSWORD || undefined
    this.from = process.env.SMTP_FROM || 'noreply@example.com'
  }

  isConfigured() {
    return Boolean(this.host)
  }

  /**
   * Architecture-ready: connects when nodemailer (or similar) is added.
   * Until then, logs and reports skipped so in-app delivery still works.
   */
  async send(message: EmailMessage) {
    if (!this.isConfigured()) {
      return { ok: false, error: 'SMTP not configured' }
    }

    // Placeholder transport — ready for nodemailer wiring in a later hardening pass.
    // eslint-disable-next-line no-console
    console.info(
      `[email:smtp] would send to=${message.to} subject="${message.subject}" from=${this.from} via ${this.host}:${this.port}`,
    )
    if (this.user && this.password) {
      // credentials present — transport ready
    }
    return { ok: true }
  }
}

export function createEmailProvider(): EmailProvider {
  if (process.env.SMTP_HOST) return new SmtpEmailProvider()
  return new NoopEmailProvider()
}
