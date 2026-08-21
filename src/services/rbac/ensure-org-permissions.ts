/**
 * Grant Users & Permissions actions for organization content-types.
 */
import type { Core } from '@strapi/strapi'

const ORG_UIDS = [
  'api::department.department',
  'api::team.team',
  'api::employee.employee',
] as const

const ACTIONS = ['find', 'findOne', 'create', 'update', 'delete'] as const

/** Role type → allowed actions per content-type (simplified M3 matrix) */
const ROLE_MATRIX: Record<string, Partial<Record<(typeof ORG_UIDS)[number], readonly string[]>>> = {
  administrator: {
    'api::department.department': ACTIONS,
    'api::team.team': ACTIONS,
    'api::employee.employee': ACTIONS,
  },
  executive: {
    'api::department.department': ['find', 'findOne'],
    'api::team.team': ['find', 'findOne'],
    'api::employee.employee': ['find', 'findOne'],
  },
  department_manager: {
    'api::department.department': ['find', 'findOne'],
    'api::team.team': ['find', 'findOne', 'create', 'update'],
    'api::employee.employee': ['find', 'findOne', 'create', 'update'],
  },
  team_leader: {
    'api::department.department': ['find', 'findOne'],
    'api::team.team': ['find', 'findOne', 'update'],
    'api::employee.employee': ['find', 'findOne', 'create', 'update'],
  },
  employee: {
    'api::department.department': ['find', 'findOne'],
    'api::team.team': ['find', 'findOne'],
    'api::employee.employee': ['find', 'findOne'],
  },
  authenticated: {
    'api::department.department': ['find', 'findOne'],
    'api::team.team': ['find', 'findOne'],
    'api::employee.employee': ['find', 'findOne'],
  },
}

export async function ensureOrgPermissions(strapi: Core.Strapi): Promise<void> {
  for (const [roleType, matrix] of Object.entries(ROLE_MATRIX)) {
    const role = await strapi.db.query('plugin::users-permissions.role').findOne({
      where: { type: roleType },
    })
    if (!role) {
      continue
    }

    for (const [uid, actions] of Object.entries(matrix)) {
      for (const action of actions || []) {
        const actionId = `${uid}.${action}`
        const existing = await strapi.db.query('plugin::users-permissions.permission').findOne({
          where: {
            action: actionId,
            role: role.id,
          },
        })

        if (existing) {
          continue
        }

        await strapi.db.query('plugin::users-permissions.permission').create({
          data: {
            action: actionId,
            role: role.id,
          },
        })
      }
    }

    strapi.log.info(`Ensured org permissions for role: ${roleType}`)
  }
}
