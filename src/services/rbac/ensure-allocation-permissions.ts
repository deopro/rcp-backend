/**
 * Grant Users & Permissions for allocations.
 */
import type { Core } from '@strapi/strapi'
import { syncContentTypePermissions } from './sync-content-type-permissions'

const UID = 'api::allocation.allocation'
const ACTIONS = ['find', 'findOne', 'create', 'update', 'delete'] as const
const READ = ['find', 'findOne'] as const

const ROLE_MATRIX: Record<string, readonly string[]> = {
  administrator: ACTIONS,
  executive: READ,
  department_manager: ['find', 'findOne', 'create', 'update', 'delete'],
  team_leader: ACTIONS,
  employee: ['find', 'findOne', 'create', 'update', 'delete'],
  authenticated: READ,
}

export async function ensureAllocationPermissions(strapi: Core.Strapi): Promise<void> {
  for (const [roleType, actions] of Object.entries(ROLE_MATRIX)) {
    await syncContentTypePermissions(strapi, roleType, UID, actions)
    strapi.log.info(`Ensured allocation permissions for role: ${roleType}`)
  }
}
