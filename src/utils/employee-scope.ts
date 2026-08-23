import type { Core } from '@strapi/strapi'

type RoleType = string | null | undefined

export async function findEmployeeIdForUser(
  strapi: Core.Strapi,
  userId: number,
): Promise<number | null> {
  const row = await strapi.db.query('api::employee.employee').findOne({
    where: { user: userId },
    select: ['id'],
  })
  return row?.id ?? null
}

function emptyResultFilters(filters: object | undefined): object {
  return { $and: [filters ?? {}, { id: { $in: [] } }] }
}

/** Scope filters for the employee collection itself. */
export async function scopeEmployeeFilters(
  strapi: Core.Strapi,
  roleType: RoleType,
  userId: number,
  filters: object | undefined,
): Promise<object> {
  const base = filters ?? {}

  if (roleType === 'employee') {
    const employeeId = await findEmployeeIdForUser(strapi, userId)
    if (!employeeId) return emptyResultFilters(base)
    return { $and: [base, { id: { $eq: employeeId } }] }
  }

  if (roleType === 'team_leader') {
    return { $and: [base, { team: { team_leader: { id: { $eq: userId } } } }] }
  }

  if (roleType === 'department_manager') {
    return {
      $and: [base, { team: { department: { manager: { id: { $eq: userId } } } } }],
    }
  }

  return base
}

/** Scope filters for entities linked through a single employee relation (leave, employee-skill). */
export async function scopeEmployeeRelationFilters(
  strapi: Core.Strapi,
  roleType: RoleType,
  userId: number,
  relationKey: string,
  filters: object | undefined,
): Promise<object> {
  const base = filters ?? {}

  if (roleType === 'employee') {
    const employeeId = await findEmployeeIdForUser(strapi, userId)
    if (!employeeId) return emptyResultFilters(base)
    return { $and: [base, { [relationKey]: { id: { $eq: employeeId } } }] }
  }

  if (roleType === 'team_leader') {
    return {
      $and: [base, { [relationKey]: { team: { team_leader: { id: { $eq: userId } } } } }],
    }
  }

  if (roleType === 'department_manager') {
    return {
      $and: [
        base,
        {
          [relationKey]: {
            team: { department: { manager: { id: { $eq: userId } } } },
          },
        },
      ],
    }
  }

  return base
}

/** Scope project lists for employee role via assigned_employees ids. */
export async function scopeProjectFilters(
  strapi: Core.Strapi,
  roleType: RoleType,
  userId: number,
  filters: object | undefined,
): Promise<object> {
  const base = filters ?? {}

  if (roleType === 'employee') {
    const employeeId = await findEmployeeIdForUser(strapi, userId)
    if (!employeeId) return emptyResultFilters(base)
    return { $and: [base, { assigned_employees: { id: { $eq: employeeId } } }] }
  }

  if (roleType === 'team_leader') {
    return {
      $and: [base, { assigned_employees: { team: { team_leader: { id: { $eq: userId } } } } }],
    }
  }

  if (roleType === 'department_manager') {
    return {
      $and: [
        base,
        {
          assigned_employees: {
            team: { department: { manager: { id: { $eq: userId } } } },
          },
        },
      ],
    }
  }

  return base
}
