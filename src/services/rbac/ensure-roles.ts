/**
 * Ensures RCP application roles exist in Users & Permissions.
 * Domain content-type permissions are assigned in later milestones.
 */
import type { Core } from '@strapi/strapi'

export const RCP_ROLES = [
  {
    name: 'Employee',
    type: 'employee',
    description: 'View and manage own allocations, capacity, projects, and skills',
  },
  {
    name: 'Team Leader',
    type: 'team_leader',
    description: 'Manage authorized team allocations, capacity, approvals, and exports',
  },
  {
    name: 'Department Manager',
    type: 'department_manager',
    description: 'View department teams, approvals, capacity, and consolidated reports',
  },
  {
    name: 'Executive',
    type: 'executive',
    description: 'Organization-wide KPIs, trends, bench, and forecasts',
  },
  {
    name: 'Administrator',
    type: 'administrator',
    description: 'Full system administration: users, master data, roles, settings, audit',
  },
] as const

export type RcpRoleType = (typeof RCP_ROLES)[number]['type']

export async function ensureRcpRoles(strapi: Core.Strapi): Promise<void> {
  for (const role of RCP_ROLES) {
    const existing = await strapi.db.query('plugin::users-permissions.role').findOne({
      where: { type: role.type },
    })

    if (existing) {
      continue
    }

    try {
      const roleService = strapi.plugin('users-permissions').service('role')
      if (typeof roleService.createRole === 'function') {
        await roleService.createRole({
          name: role.name,
          description: role.description,
          type: role.type,
          permissions: {},
        })
      } else {
        await strapi.db.query('plugin::users-permissions.role').create({
          data: {
            name: role.name,
            description: role.description,
            type: role.type,
          },
        })
      }
      strapi.log.info(`Created RCP role: ${role.type}`)
    } catch (error) {
      strapi.log.warn(`Could not create role ${role.type}`)
      strapi.log.warn(error)
    }
  }
}
