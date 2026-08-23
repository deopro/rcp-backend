/**
 * Grant Users & Permissions actions for project domain content-types.
 */
import type { Core } from '@strapi/strapi'
import { syncContentTypePermissions } from './sync-content-type-permissions'

const PROJECT_UIDS = [
  'api::client.client',
  'api::skill.skill',
  'api::project.project',
] as const

const ACTIONS = ['find', 'findOne', 'create', 'update', 'delete'] as const
const READ = ['find', 'findOne'] as const
const PROJECT_WRITE = ['find', 'findOne', 'create', 'update', 'delete'] as const

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
    'api::project.project': PROJECT_WRITE,
  },
  team_leader: {
    'api::client.client': READ,
    'api::skill.skill': READ,
    'api::project.project': PROJECT_WRITE,
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
    for (const uid of PROJECT_UIDS) {
      await syncContentTypePermissions(strapi, roleType, uid, matrix[uid] || [])
    }
    strapi.log.info(`Ensured project permissions for role: ${roleType}`)
  }
}
