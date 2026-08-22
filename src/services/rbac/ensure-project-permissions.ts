/**
 * Grant Users & Permissions actions for project domain content-types.
 */
import type { Core } from '@strapi/strapi'

const PROJECT_UIDS = [
  'api::client.client',
  'api::skill.skill',
  'api::project.project',
] as const

const ACTIONS = ['find', 'findOne', 'create', 'update', 'delete'] as const
const READ = ['find', 'findOne'] as const

const ROLE_MATRIX: Record<
  string,
  Partial<Record<(typeof PROJECT_UIDS)[number], readonly string[]>>
> = {
  administrator: {
    'api::client.client': ACTIONS,
    'api::skill.skill': ACTIONS,
    'api::project.project': ACTIONS,
  },
  executive: {
    'api::client.client': READ,
    'api::skill.skill': READ,
    'api::project.project': READ,
  },
  department_manager: {
    'api::client.client': READ,
    'api::skill.skill': READ,
    'api::project.project': ['find', 'findOne', 'create', 'update', 'delete'],
  },
  team_leader: {
    'api::client.client': READ,
    'api::skill.skill': READ,
    'api::project.project': ['find', 'findOne', 'update'],
  },
  employee: {
    'api::client.client': READ,
    'api::skill.skill': READ,
    'api::project.project': READ,
  },
  authenticated: {
    'api::client.client': READ,
    'api::skill.skill': READ,
    'api::project.project': READ,
  },
}

export async function ensureProjectPermissions(strapi: Core.Strapi): Promise<void> {
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

    strapi.log.info(`Ensured project permissions for role: ${roleType}`)
  }
}
