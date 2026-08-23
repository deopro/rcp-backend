/**
 * Sync Users & Permissions actions for a content-type to match the allowed matrix.
 * Adds missing permissions and removes ones no longer granted.
 */
import type { Core } from '@strapi/strapi'

const ALL_ACTIONS = ['find', 'findOne', 'create', 'update', 'delete'] as const

export async function syncContentTypePermissions(
  strapi: Core.Strapi,
  roleType: string,
  uid: string,
  allowedActions: readonly string[],
): Promise<void> {
  const role = await strapi.db.query('plugin::users-permissions.role').findOne({
    where: { type: roleType },
  })
  if (!role) return

  for (const action of ALL_ACTIONS) {
    const actionId = `${uid}.${action}`
    const existing = await strapi.db.query('plugin::users-permissions.permission').findOne({
      where: { action: actionId, role: role.id },
    })
    const shouldHave = allowedActions.includes(action)

    if (shouldHave && !existing) {
      await strapi.db.query('plugin::users-permissions.permission').create({
        data: { action: actionId, role: role.id },
      })
    } else if (!shouldHave && existing) {
      await strapi.db.query('plugin::users-permissions.permission').delete({
        where: { id: existing.id },
      })
    }
  }
}
