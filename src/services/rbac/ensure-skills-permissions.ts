/**
 * Grant Users & Permissions for skill categories and employee skills.
 */
import type { Core } from '@strapi/strapi'

const SKILL_UIDS = [
  'api::skill-category.skill-category',
  'api::employee-skill.employee-skill',
] as const

const ACTIONS = ['find', 'findOne', 'create', 'update', 'delete'] as const
const READ = ['find', 'findOne'] as const

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
    'api::employee-skill.employee-skill': ['find', 'findOne', 'create', 'update'],
  },
  team_leader: {
    'api::skill-category.skill-category': READ,
    'api::employee-skill.employee-skill': ['find', 'findOne', 'create', 'update'],
  },
  employee: {
    'api::skill-category.skill-category': READ,
    'api::employee-skill.employee-skill': ['find', 'findOne', 'create', 'update', 'delete'],
  },
  authenticated: {
    'api::skill-category.skill-category': READ,
    'api::employee-skill.employee-skill': READ,
  },
}

export async function ensureSkillsPermissions(strapi: Core.Strapi): Promise<void> {
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

    strapi.log.info(`Ensured skills permissions for role: ${roleType}`)
  }
}
