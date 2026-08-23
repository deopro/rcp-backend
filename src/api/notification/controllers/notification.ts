/**
 * Notifications — users manage their own inbox via custom routes only.
 */
import { factories } from '@strapi/strapi'

export default factories.createCoreController('api::notification.notification', () => ({
  async find(ctx) {
    return ctx.forbidden('Use GET /api/notifications')
  },
  async findOne(ctx) {
    return ctx.forbidden('Use GET /api/notifications')
  },
  async create(ctx) {
    return ctx.forbidden()
  },
  async update(ctx) {
    return ctx.forbidden()
  },
  async delete(ctx) {
    return ctx.forbidden()
  },
}))
