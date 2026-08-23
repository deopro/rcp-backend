/**
 * Persist AI usage metadata (no secrets, no full prompts).
 */
import type { Core } from '@strapi/strapi'

export async function logAiUsage(
  strapi: Core.Strapi,
  opts: {
    userId: number
    provider: string
    operation: 'recommend' | 'explain' | 'apply'
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  try {
    await strapi.db.query('api::ai-usage-log.ai-usage-log').create({
      data: {
        user: opts.userId,
        provider: opts.provider,
        operation: opts.operation,
        metadata: opts.metadata || {},
        publishedAt: new Date(),
      },
    })
  } catch (error) {
    strapi.log.warn('Failed to log AI usage')
    strapi.log.warn(error)
  }
}
