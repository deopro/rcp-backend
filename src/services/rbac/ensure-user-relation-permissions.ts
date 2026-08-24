/**
 * Allow privileged roles to resolve user relations via REST (manager, team_leader, employee↔user).
 */
import type { Core } from '@strapi/strapi'

const USER_FIND_ROLES = [
  'administrator',
  'executive',
  'department_manager',
  'team_leader',
] as const

export async function ensureUserRelationPermissions(strapi: Core.Strapi): Promise<void> {
  const action = 'plugin::users-permissions.user.find'

  for (const roleType of USER_FIND_ROLES) {
    const role = await strapi.db.query('plugin::users-permissions.role').findOne({
      where: { type: roleType },
    })
    if (!role) continue

    const existing = await strapi.db.query('plugin::users-permissions.permission').findOne({
      where: { action, role: role.id },
    })
    if (existing) continue

    await strapi.db.query('plugin::users-permissions.permission').create({
      data: { action, role: role.id },
    })
    strapi.log.info(`Ensured user relation permission for role: ${roleType}`)
  }
}
