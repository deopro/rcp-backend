/**
 * Grant Users & Permissions actions for organization content-types.
 */
import type { Core } from '@strapi/strapi'
import { syncContentTypePermissions } from './sync-content-type-permissions'

const ORG_UIDS = [
  'api::department.department',
  'api::team.team',
  'api::employee.employee',
] as const

const ACTIONS = ['find', 'findOne', 'create', 'update', 'delete'] as const
const READ = ['find', 'findOne'] as const

/** Role type → allowed actions per content-type (simplified M3 matrix) */
const ROLE_MATRIX: Record<string, Partial<Record<(typeof ORG_UIDS)[number], readonly string[]>>> = {
  administrator: {
    'api::department.department': ACTIONS,
    'api::team.team': ACTIONS,
    'api::employee.employee': ACTIONS,
  },
  executive: {
    'api::department.department': READ,
    'api::team.team': READ,
    'api::employee.employee': READ,
  },
  department_manager: {
    'api::department.department': READ,
    'api::team.team': ['find', 'findOne', 'create', 'update'],
    'api::employee.employee': ['find', 'findOne', 'create', 'update'],
  },
  team_leader: {
    'api::department.department': READ,
    'api::team.team': READ,
    'api::employee.employee': ['find', 'findOne', 'create', 'update'],
  },
  employee: {
    'api::department.department': READ,
    'api::team.team': READ,
    'api::employee.employee': READ,
  },
  authenticated: {
    'api::department.department': READ,
    'api::team.team': READ,
    'api::employee.employee': READ,
  },
}

export async function ensureOrgPermissions(strapi: Core.Strapi): Promise<void> {
  for (const [roleType, matrix] of Object.entries(ROLE_MATRIX)) {
    for (const uid of ORG_UIDS) {
      await syncContentTypePermissions(strapi, roleType, uid, matrix[uid] || [])
    }
    strapi.log.info(`Ensured org permissions for role: ${roleType}`)
  }
}
