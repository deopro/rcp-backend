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
    select: ['email', 'username', 'first_name', 'last_name'],
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

  const created = await strapi.db.query('api::employee.employee').create({
    data: {
      employee_number: null,
      full_name: fullNameFromUser(user, userId),
      email,
      position: null,
      daily_capacity: 8,
      status: 'active',
      user: userId,
      publishedAt: new Date(),
    },
  })

  return (created?.id as number | undefined) ?? null
}

/** Copy User email and display name onto an employee payload. Never overwrites number or position. */
export async function overlayEmployeeIdentityFromUser(
  strapi: Core.Strapi,
  data: Record<string, unknown>,
): Promise<void> {
  const userId = extractRelationId(data, 'user')
  if (!userId) return

  const user = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: userId },
    select: ['email', 'username', 'first_name', 'last_name'],
  })
  if (!user) return

  data.full_name = fullNameFromUser(user, userId)
  if (typeof user.email === 'string' && user.email.trim()) {
    data.email = user.email.trim().toLowerCase()
  }
}

/** Refresh cached Employee email/full_name from the linked User (OIDC / profile updates). */
export async function refreshLinkedEmployeeIdentity(
  strapi: Core.Strapi,
  userId: number,
): Promise<void> {
  const employee = await strapi.db.query('api::employee.employee').findOne({
    where: { user: userId },
    select: ['id'],
  })
  if (!employee?.id) return

  const data: Record<string, unknown> = { user: userId }
  await overlayEmployeeIdentityFromUser(strapi, data)
  await strapi.db.query('api::employee.employee').update({
    where: { id: employee.id },
    data: {
      ...(typeof data.email === 'string' ? { email: data.email } : {}),
      ...(typeof data.full_name === 'string' ? { full_name: data.full_name } : {}),
    },
  })
}

/** Return an error message if another employee already uses this email. */
export async function findDuplicateEmployeeEmail(
  strapi: Core.Strapi,
  email: unknown,
  excludeId?: number,
): Promise<string | null> {
  if (typeof email !== 'string' || !email.trim()) return null
  const normalized = email.trim().toLowerCase()
  const existing = await strapi.db.query('api::employee.employee').findOne({
    where: excludeId
      ? { email: normalized, id: { $ne: excludeId } }
      : { email: normalized },
    select: ['id'],
  })
  return existing ? 'An employee with this email already exists' : null
}

export function normalizeEmployeeNumber(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value == null) return null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, 48) : null
}

/** Return an error message if another employee already uses this number. */
export async function findDuplicateEmployeeNumber(
  strapi: Core.Strapi,
  employeeNumber: unknown,
  excludeId?: number,
): Promise<string | null> {
  if (typeof employeeNumber !== 'string' || !employeeNumber.trim()) return null
  const normalized = employeeNumber.trim()
  const existing = await strapi.db.query('api::employee.employee').findOne({
    where: excludeId
      ? { employee_number: normalized, id: { $ne: excludeId } }
      : { employee_number: normalized },
    select: ['id'],
  })
  return existing ? 'An employee with this number already exists' : null
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

function documentIdsFilter(base: object, documentIds: string[]): object {
  if (!documentIds.length) return emptyResultFilters(base)
  return { $and: [base, { documentId: { $in: documentIds } }] }
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
    return employeeId ? [employeeId] : []
  }

  if (roleType === 'team_leader') {
    const teamIds = await findTeamIdsForLeader(strapi, userId)
    const memberIds = await findEmployeeIdsInTeams(strapi, teamIds)
    const ownId = await findEmployeeIdForUser(strapi, userId)
    return [...new Set([...memberIds, ...(ownId ? [ownId] : [])])]
  }

  if (roleType === 'department_manager') {
    const departmentIds = await findDepartmentIdsForManager(strapi, userId)
    const teamIds = await findTeamIdsInDepartments(strapi, departmentIds)
    const memberIds = await findEmployeeIdsInTeams(strapi, teamIds)
    const ownId = await findEmployeeIdForUser(strapi, userId)
    return [...new Set([...memberIds, ...(ownId ? [ownId] : [])])]
  }

  return []
}

type VisibleProjects = { ids: number[]; documentIds: string[] }

/**
 * Projects visible to scoped roles.
 * Uses db.query (M2M REST filters are unreliable). Unassigned projects stay visible;
 * otherwise the user must be assigned or already allocated.
 */
export async function findVisibleProjects(
  strapi: Core.Strapi,
  roleType: RoleType,
  userId: number,
): Promise<VisibleProjects | null> {
  if (roleType === 'administrator' || roleType === 'executive') return null

  const employeeIds = await findProjectScopeEmployeeIds(strapi, roleType, userId)

  const projects = await strapi.db.query('api::project.project').findMany({
    populate: ['assigned_employees'],
  })

  const allocatedIds = new Set<number>()
  if (employeeIds.length) {
    const allocations = await strapi.db.query('api::allocation.allocation').findMany({
      where: { employee: { id: { $in: employeeIds } } },
      populate: ['project'],
    })
    for (const row of allocations) {
      const projectId = (row.project as { id?: number } | undefined)?.id
      if (typeof projectId === 'number') allocatedIds.add(projectId)
    }
  }

  const ids: number[] = []
  const documentIds: string[] = []
  for (const project of projects) {
    const projectId = project.id as number
    const documentId = project.documentId as string | undefined
    const assigned = (project.assigned_employees as { id: number }[] | undefined) ?? []
    const visible =
      !assigned.length ||
      employeeIds.some((id) => assigned.some((employee) => employee.id === id)) ||
      allocatedIds.has(projectId)
    if (!visible) continue
    ids.push(projectId)
    if (documentId) documentIds.push(documentId)
  }
  return { ids, documentIds }
}

/** Scope project lists to assigned, allocated, or still-unassigned projects. */
export async function scopeProjectFilters(
  strapi: Core.Strapi,
  roleType: RoleType,
  userId: number,
  filters: object | undefined,
): Promise<object> {
  const base = filters ?? {}

  if (roleType === 'employee' || roleType === 'team_leader' || roleType === 'department_manager') {
    const visible = await findVisibleProjects(strapi, roleType, userId)
    if (!visible) return base
    return documentIdsFilter(base, visible.documentIds)
  }

  return base
}

/** Whether a user may access a project based on assignment or existing allocations. */
export async function canAccessProject(
  strapi: Core.Strapi,
  roleType: RoleType,
  userId: number,
  projectId: number,
): Promise<boolean> {
  if (roleType === 'administrator' || roleType === 'executive') return true

  const visible = await findVisibleProjects(strapi, roleType, userId)
  if (!visible) return true
  return visible.ids.includes(projectId)
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
    where: { id: projectId },
    populate: ['assigned_employees'],
    select: ['id'],
  })
  if (!project) return false

  const assigned = (project.assigned_employees as { id: number }[] | undefined) ?? []
  if (!assigned.length) return true
  return assigned.some((employee) => employee.id === employeeId)
}

/** Whether a user may access an employee record. */
export async function canAccessEmployee(
  strapi: Core.Strapi,
  roleType: RoleType,
  userId: number,
  employeeId: number,
): Promise<boolean> {
  return canAccessLeaveEmployee(strapi, roleType, userId, employeeId)
}

/** Extract a numeric relation id from Strapi REST body shapes. */
export function extractRelationId(data: Record<string, unknown>, key: string): number | null {
  const value = data[key]
  if (value == null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  if (typeof value === 'object') {
    const obj = value as { id?: number; connect?: unknown; set?: unknown }
    if (typeof obj.id === 'number') return obj.id
    const connect = obj.connect ?? obj.set
    if (Array.isArray(connect)) {
      const first = connect[0]
      if (typeof first === 'number') return first
      if (typeof first === 'object' && first && 'id' in first) {
        return (first as { id: number }).id
      }
    }
    if (typeof connect === 'number') return connect
    if (typeof connect === 'object' && connect && 'id' in connect) {
      return (connect as { id: number }).id
    }
  }
  return null
}

/** Persist a users-permissions user relation (REST connect is unreliable for plugin users). */
export async function persistUserRelation(
  strapi: Core.Strapi,
  uid: string,
  documentId: string | undefined,
  field: string,
  userId: number | null,
): Promise<void> {
  if (!documentId || userId == null) return
  await strapi.db.query(uid).update({
    where: { documentId },
    data: { [field]: userId },
  })
}

/** Whether a user may assign an employee to the given team. */
export async function canAssignEmployeeToTeam(
  strapi: Core.Strapi,
  roleType: RoleType,
  userId: number,
  teamId: number | null | undefined,
): Promise<boolean> {
  if (teamId == null) {
    return roleType === 'administrator' || roleType === 'department_manager'
  }
  if (roleType === 'administrator' || roleType === 'executive') return true

  if (roleType === 'department_manager') {
    const departmentIds = await findDepartmentIdsForManager(strapi, userId)
    const teamIds = await findTeamIdsInDepartments(strapi, departmentIds)
    return teamIds.includes(teamId)
  }

  if (roleType === 'team_leader') {
    const teamIds = await findTeamIdsForLeader(strapi, userId)
    return teamIds.includes(teamId)
  }

  return false
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
