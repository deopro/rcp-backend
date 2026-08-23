/**
 * Grant Users & Permissions for holidays and leave.
 */
import type { Core } from '@strapi/strapi'
import { syncContentTypePermissions } from './sync-content-type-permissions'

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
    'api::leave.leave': READ,
  },
  employee: {
    'api::holiday.holiday': READ,
    'api::leave.leave': ['find', 'findOne', 'create', 'update'],
  },
  authenticated: {
    'api::holiday.holiday': READ,
  },
}

export async function ensureLeavePermissions(strapi: Core.Strapi): Promise<void> {
  for (const [roleType, matrix] of Object.entries(ROLE_MATRIX)) {
    for (const [uid, actions] of Object.entries(matrix)) {
      await syncContentTypePermissions(strapi, roleType, uid, actions || [])
    }
    strapi.log.info(`Ensured leave/holiday permissions for role: ${roleType}`)
  }
}
