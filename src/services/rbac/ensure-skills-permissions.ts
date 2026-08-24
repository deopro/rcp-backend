/**
 * Grant Users & Permissions for skill categories and employee skills.
 */
import type { Core } from '@strapi/strapi'
import { syncContentTypePermissions } from './sync-content-type-permissions'

const SKILL_UIDS = [
  'api::skill-category.skill-category',
  'api::employee-skill.employee-skill',
] as const

const ACTIONS = ['find', 'findOne', 'create', 'update', 'delete'] as const
const READ = ['find', 'findOne'] as const
const MATRIX_WRITE = ['find', 'findOne', 'create', 'update', 'delete'] as const

const ROLE_MATRIX: Record<
  string,
  Partial<Record<(typeof SKILL_UIDS)[number], readonly string[]>>
> = {
  administrator: {
    'api::skill-category.skill-category': ACTIONS,
    'api::employee-skill.employee-skill': ACTIONS,
  },
  executive: {
    'api::skill-category.skill-category': READ,
    'api::employee-skill.employee-skill': READ,
  },
  department_manager: {
    'api::skill-category.skill-category': READ,
    'api::employee-skill.employee-skill': MATRIX_WRITE,
  },
  team_leader: {
    'api::skill-category.skill-category': READ,
    'api::employee-skill.employee-skill': MATRIX_WRITE,
  },
  employee: {
    'api::skill-category.skill-category': READ,
    'api::employee-skill.employee-skill': MATRIX_WRITE,
  },
  authenticated: {
    'api::skill-category.skill-category': READ,
    'api::employee-skill.employee-skill': READ,
  },
}

export async function ensureSkillsPermissions(strapi: Core.Strapi): Promise<void> {
  for (const [roleType, matrix] of Object.entries(ROLE_MATRIX)) {
    for (const uid of SKILL_UIDS) {
      await syncContentTypePermissions(strapi, roleType, uid, matrix[uid] || [])
    }
    strapi.log.info(`Ensured skills permissions for role: ${roleType}`)
  }
}
