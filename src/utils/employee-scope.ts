import type { Core } from '@strapi/strapi'

type RoleType = string | null | undefined

export async function findEmployeeIdForUser(
  strapi: Core.Strapi,
  userId: number,
): Promise<number | null> {
  const byUser = await strapi.db.query('api::employee.employee').findOne({
    where: { user: userId },
    select: ['id'],
  })
  if (byUser?.id) return byUser.id as number

  const user = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: userId },
    select: ['email', 'username'],
  })
  if (!user) return null

  const candidates = [user.email, user.username]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim().toLowerCase())

  for (const candidate of [...new Set(candidates)]) {
    const byEmail = await strapi.db.query('api::employee.employee').findOne({
      where: { email: candidate },
      select: ['id'],
    })
    if (!byEmail?.id) continue

    await strapi.db.query('api::employee.employee').update({
      where: { id: byEmail.id },
      data: { user: userId },
    })

    return byEmail.id as number
  }

  return null
}

function employeeNumberForUser(userId: number, username?: string | null): string {
  const base = typeof username === 'string' && username.trim() ? username.trim() : `user-${userId}`
  return base.slice(0, 48)
}

function fullNameFromUser(
  user: {
    first_name?: string | null
    last_name?: string | null
    username?: string | null
    email?: string | null
  },
  userId: number,
): string {
  const fromNames = [user.first_name, user.last_name].filter(Boolean).join(' ').trim()
  return fromNames || user.username || user.email || `User ${userId}`
}

/** Resolve or create the employee row for an application user. */
export async function ensureEmployeeForUser(
  strapi: Core.Strapi,
  userId: number,
): Promise<number | null> {
  const existing = await findEmployeeIdForUser(strapi, userId)
  if (existing) return existing

  const user = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: userId },
  })
  if (!user?.email) return null

  const email = user.email.trim().toLowerCase()
  let employeeNumber = employeeNumberForUser(userId, user.username)

  const numberTaken = await strapi.db.query('api::employee.employee').findOne({
    where: { employee_number: employeeNumber },
    select: ['id'],
  })
  if (numberTaken) {
    employeeNumber = `user-${userId}`
  }

  const created = await strapi.db.query('api::employee.employee').create({
    data: {
      employee_number: employeeNumber,
      full_name: fullNameFromUser(user, userId),
      email,
      daily_capacity: 8,
      status: 'active',
      user: userId,
      publishedAt: new Date(),
    },
  })

  return (created?.id as number | undefined) ?? null
}

export async function syncEmployeeRoleUsers(strapi: Core.Strapi): Promise<void> {
  const employeeRole = await strapi.db.query('plugin::users-permissions.role').findOne({
    where: { type: 'employee' },
  })
  if (!employeeRole) return

  const users = await strapi.db.query('plugin::users-permissions.user').findMany({
    where: { role: employeeRole.id },
    select: ['id'],
  })

  for (const user of users) {
    await ensureEmployeeForUser(strapi, user.id as number)
  }
}

export async function findTeamIdsForLeader(
  strapi: Core.Strapi,
  userId: number,
): Promise<number[]> {
  const teams = await strapi.db.query('api::team.team').findMany({
    where: { team_leader: userId },
    select: ['id'],
  })
  return teams.map((team) => team.id as number)
}

export async function findDepartmentIdsForManager(
  strapi: Core.Strapi,
  userId: number,
): Promise<number[]> {
  const departments = await strapi.db.query('api::department.department').findMany({
    where: { manager: userId },
    select: ['id'],
  })
  return departments.map((department) => department.id as number)
}

export async function findTeamIdsInDepartments(
  strapi: Core.Strapi,
  departmentIds: number[],
): Promise<number[]> {
  if (!departmentIds.length) return []
  const teams = await strapi.db.query('api::team.team').findMany({
    where: { department: { id: { $in: departmentIds } } },
    select: ['id'],
  })
  return teams.map((team) => team.id as number)
}

export async function findEmployeeIdsInTeams(
  strapi: Core.Strapi,
  teamIds: number[],
): Promise<number[]> {
  if (!teamIds.length) return []
  const employees = await strapi.db.query('api::employee.employee').findMany({
    where: { team: { id: { $in: teamIds } } },
    select: ['id'],
  })
  return employees.map((employee) => employee.id as number)
}

function emptyResultFilters(filters: object | undefined): object {
  return { $and: [filters ?? {}, { id: { $in: [] } }] }
}

function idsFilter(base: object, ids: number[]): object {
  if (!ids.length) return emptyResultFilters(base)
  return { $and: [base, { id: { $in: ids } }] }
}

/** Scope filters for the team collection. */
export async function scopeTeamFilters(
  strapi: Core.Strapi,
  roleType: RoleType,
  userId: number,
  filters: object | undefined,
): Promise<object> {
  const base = filters ?? {}

  if (roleType === 'team_leader') {
    const teamIds = await findTeamIdsForLeader(strapi, userId)
    return idsFilter(base, teamIds)
  }

  if (roleType === 'department_manager') {
    const departmentIds = await findDepartmentIdsForManager(strapi, userId)
    const teamIds = await findTeamIdsInDepartments(strapi, departmentIds)
    return idsFilter(base, teamIds)
  }

  if (roleType === 'employee') {
    const employee = await strapi.db.query('api::employee.employee').findOne({
      where: { user: userId },
      populate: ['team'],
    })
    const teamId = employee?.team?.id as number | undefined
    if (!teamId) return emptyResultFilters(base)
    return { $and: [base, { id: { $eq: teamId } }] }
  }

  return base
}

/** Scope filters for the department collection. */
export async function scopeDepartmentFilters(
  strapi: Core.Strapi,
  roleType: RoleType,
  userId: number,
  filters: object | undefined,
): Promise<object> {
  const base = filters ?? {}

  if (roleType === 'department_manager') {
    const departmentIds = await findDepartmentIdsForManager(strapi, userId)
    return idsFilter(base, departmentIds)
  }

  if (roleType === 'team_leader') {
    const teamIds = await findTeamIdsForLeader(strapi, userId)
    if (!teamIds.length) return emptyResultFilters(base)
    const teams = await strapi.db.query('api::team.team').findMany({
      where: { id: { $in: teamIds } },
      populate: ['department'],
    })
    const departmentIds = [
      ...new Set(
        teams
          .map((team) => team.department?.id as number | undefined)
          .filter((id): id is number => id != null),
      ),
    ]
    return idsFilter(base, departmentIds)
  }

  if (roleType === 'employee') {
    const employee = await strapi.db.query('api::employee.employee').findOne({
      where: { user: userId },
      populate: ['team.department'],
    })
    const departmentId = employee?.team?.department?.id as number | undefined
    if (!departmentId) return emptyResultFilters(base)
    return { $and: [base, { id: { $eq: departmentId } }] }
  }

  return base
}

/** Scope filters for entities with a direct team relation (approvals). */
export async function scopeTeamRelationFilters(
  strapi: Core.Strapi,
  roleType: RoleType,
  userId: number,
  filters: object | undefined,
): Promise<object> {
  const base = filters ?? {}

  if (roleType === 'team_leader') {
    const teamIds = await findTeamIdsForLeader(strapi, userId)
    if (!teamIds.length) return emptyResultFilters(base)
    return { $and: [base, { team: { id: { $in: teamIds } } }] }
  }

  if (roleType === 'department_manager') {
    const departmentIds = await findDepartmentIdsForManager(strapi, userId)
    const teamIds = await findTeamIdsInDepartments(strapi, departmentIds)
    if (!teamIds.length) return emptyResultFilters(base)
    return { $and: [base, { team: { id: { $in: teamIds } } }] }
  }

  return base
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
    const teamIds = await findTeamIdsForLeader(strapi, userId)
    if (!teamIds.length) return emptyResultFilters(base)
    return { $and: [base, { team: { id: { $in: teamIds } } }] }
  }

  if (roleType === 'department_manager') {
    const departmentIds = await findDepartmentIdsForManager(strapi, userId)
    const teamIds = await findTeamIdsInDepartments(strapi, departmentIds)
    if (!teamIds.length) return emptyResultFilters(base)
    return { $and: [base, { team: { id: { $in: teamIds } } }] }
  }

  return base
}

/** Scope filters for entities linked through a single employee relation (leave, employee-skill, allocation). */
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
    const teamIds = await findTeamIdsForLeader(strapi, userId)
    if (!teamIds.length) return emptyResultFilters(base)
    return { $and: [base, { [relationKey]: { team: { id: { $in: teamIds } } } }] }
  }

  if (roleType === 'department_manager') {
    const departmentIds = await findDepartmentIdsForManager(strapi, userId)
    const teamIds = await findTeamIdsInDepartments(strapi, departmentIds)
    if (!teamIds.length) return emptyResultFilters(base)
    return { $and: [base, { [relationKey]: { team: { id: { $in: teamIds } } } }] }
  }

  return base
}

/** Employee ids whose project assignments are visible for the given role. */
export async function findProjectScopeEmployeeIds(
  strapi: Core.Strapi,
  roleType: RoleType,
  userId: number,
): Promise<number[]> {
  if (roleType === 'employee') {
    const employeeId = await findEmployeeIdForUser(strapi, userId)
    if (!employeeId) return []

    const employee = await strapi.db.query('api::employee.employee').findOne({
      where: { id: employeeId },
      populate: ['team'],
    })
    const teamId = employee?.team?.id as number | undefined
    if (!teamId) return [employeeId]

    return findEmployeeIdsInTeams(strapi, [teamId])
  }

  if (roleType === 'team_leader') {
    const teamIds = await findTeamIdsForLeader(strapi, userId)
    return findEmployeeIdsInTeams(strapi, teamIds)
  }

  if (roleType === 'department_manager') {
    const departmentIds = await findDepartmentIdsForManager(strapi, userId)
    const teamIds = await findTeamIdsInDepartments(strapi, departmentIds)
    return findEmployeeIdsInTeams(strapi, teamIds)
  }

  return []
}

/** Scope project lists via assigned employee ids. */
export async function scopeProjectFilters(
  strapi: Core.Strapi,
  roleType: RoleType,
  userId: number,
  filters: object | undefined,
): Promise<object> {
  const base = filters ?? {}

  if (roleType === 'employee' || roleType === 'team_leader' || roleType === 'department_manager') {
    const employeeIds = await findProjectScopeEmployeeIds(strapi, roleType, userId)
    if (!employeeIds.length) return emptyResultFilters(base)
    return { $and: [base, { assigned_employees: { id: { $in: employeeIds } } }] }
  }

  return base
}

/** Whether a user may access a project based on assigned team members. */
export async function canAccessProject(
  strapi: Core.Strapi,
  roleType: RoleType,
  userId: number,
  projectId: number,
): Promise<boolean> {
  if (roleType === 'administrator' || roleType === 'executive') return true

  const project = await strapi.db.query('api::project.project').findOne({
    where: { id: projectId },
    populate: ['assigned_employees'],
  })
  if (!project) return false

  const assignedIds = ((project.assigned_employees as { id: number }[] | undefined) ?? []).map(
    (employee) => employee.id,
  )
  if (!assignedIds.length) return false

  const scopeIds = await findProjectScopeEmployeeIds(strapi, roleType, userId)
  if (!scopeIds.length) return false

  return assignedIds.some((id) => scopeIds.includes(id))
}

export async function requireOwnEmployeeId(
  strapi: Core.Strapi,
  userId: number,
  employeeId: number,
): Promise<boolean> {
  const ownId = await findEmployeeIdForUser(strapi, userId)
  return ownId != null && ownId === employeeId
}

export async function isEmployeeAssignedToProject(
  strapi: Core.Strapi,
  employeeId: number,
  projectId: number,
): Promise<boolean> {
  const project = await strapi.db.query('api::project.project').findOne({
    where: { id: projectId, assigned_employees: { id: employeeId } },
    select: ['id'],
  })
  return Boolean(project)
}

/** Whether a user may access a leave record for the given employee id. */
export async function canAccessLeaveEmployee(
  strapi: Core.Strapi,
  roleType: RoleType,
  userId: number,
  leaveEmployeeId: number | undefined,
): Promise<boolean> {
  if (!leaveEmployeeId) return false
  if (roleType === 'administrator' || roleType === 'executive') return true

  if (roleType === 'employee') {
    const ownId = await findEmployeeIdForUser(strapi, userId)
    return ownId != null && ownId === leaveEmployeeId
  }

  if (roleType === 'team_leader') {
    const teamIds = await findTeamIdsForLeader(strapi, userId)
    const employeeIds = await findEmployeeIdsInTeams(strapi, teamIds)
    return employeeIds.includes(leaveEmployeeId)
  }

  if (roleType === 'department_manager') {
    const departmentIds = await findDepartmentIdsForManager(strapi, userId)
    const teamIds = await findTeamIdsInDepartments(strapi, departmentIds)
    const employeeIds = await findEmployeeIdsInTeams(strapi, teamIds)
    return employeeIds.includes(leaveEmployeeId)
  }

  return false
}
