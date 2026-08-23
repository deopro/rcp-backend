/**
 * Grant Users & Permissions for holidays and leave.
 */
import type { Core } from '@strapi/strapi'

const ACTIONS = ['find', 'findOne', 'create', 'update', 'delete'] as const
const READ = ['find', 'findOne'] as const

const ROLE_MATRIX: Record<
  string,
  Partial<Record<'api::holiday.holiday' | 'api::leave.leave', readonly string[]>>
> = {
  administrator: {
    'api::holiday.holiday': ACTIONS,
    'api::leave.leave': ACTIONS,
  },
  executive: {
    'api::holiday.holiday': READ,
    'api::leave.leave': READ,
  },
  department_manager: {
    'api::holiday.holiday': READ,
    'api::leave.leave': ['find', 'findOne', 'create', 'update'],
  },
  team_leader: {
    'api::holiday.holiday': READ,
    'api::leave.leave': ['find', 'findOne', 'create', 'update'],
  },
  employee: {
    'api::holiday.holiday': READ,
    'api::leave.leave': ['find', 'findOne', 'create', 'update'],
  },
  authenticated: {
    'api::holiday.holiday': READ,
    'api::leave.leave': READ,
  },
}

export async function ensureLeavePermissions(strapi: Core.Strapi): Promise<void> {
  for (const [roleType, matrix] of Object.entries(ROLE_MATRIX)) {
    const role = await strapi.db.query('plugin::users-permissions.role').findOne({
      where: { type: roleType },
    })
    if (!role) continue

    for (const [uid, actions] of Object.entries(matrix)) {
      for (const action of actions || []) {
        const actionId = `${uid}.${action}`
        const existing = await strapi.db.query('plugin::users-permissions.permission').findOne({
          where: { action: actionId, role: role.id },
        })
        if (existing) continue

        await strapi.db.query('plugin::users-permissions.permission').create({
          data: { action: actionId, role: role.id },
        })
      }
    }

    strapi.log.info(`Ensured leave/holiday permissions for role: ${roleType}`)
  }
}
