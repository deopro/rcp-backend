/**
 * Grant Users & Permissions for allocations.
 */
import type { Core } from '@strapi/strapi'

const UID = 'api::allocation.allocation'
const ACTIONS = ['find', 'findOne', 'create', 'update', 'delete'] as const
const READ = ['find', 'findOne'] as const

const ROLE_MATRIX: Record<string, readonly string[]> = {
  administrator: ACTIONS,
  executive: READ,
  department_manager: ['find', 'findOne', 'create', 'update'],
  team_leader: ['find', 'findOne', 'create', 'update'],
  employee: READ,
  authenticated: READ,
}

export async function ensureAllocationPermissions(strapi: Core.Strapi): Promise<void> {
  for (const [roleType, actions] of Object.entries(ROLE_MATRIX)) {
    const role = await strapi.db.query('plugin::users-permissions.role').findOne({
      where: { type: roleType },
    })
    if (!role) continue

    for (const action of actions) {
      const actionId = `${UID}.${action}`
      const existing = await strapi.db.query('plugin::users-permissions.permission').findOne({
        where: { action: actionId, role: role.id },
      })
      if (existing) continue

      await strapi.db.query('plugin::users-permissions.permission').create({
        data: { action: actionId, role: role.id },
      })
    }

    strapi.log.info(`Ensured allocation permissions for role: ${roleType}`)
  }
}
