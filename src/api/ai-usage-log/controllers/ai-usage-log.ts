/**
 * AI usage logs — internal audit only (no public CRUD).
 */
import { factories } from '@strapi/strapi'

export default factories.createCoreController('api::ai-usage-log.ai-usage-log', () => ({
  async find(ctx) {
    return ctx.forbidden('AI usage logs are not exposed via API')
  },
  async findOne(ctx) {
    return ctx.forbidden('AI usage logs are not exposed via API')
  },
  async create(ctx) {
    return ctx.forbidden('AI usage logs are not exposed via API')
  },
  async update(ctx) {
    return ctx.forbidden('AI usage logs are not exposed via API')
  },
  async delete(ctx) {
    return ctx.forbidden('AI usage logs are not exposed via API')
  },
}))
