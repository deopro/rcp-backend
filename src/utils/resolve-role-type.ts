import type { Core } from '@strapi/strapi'

export async function resolveRoleType(
  strapi: Core.Strapi,
  user: { id: number; role?: { id?: number; type?: string } | number } | undefined,
): Promise<string | null> {
  if (!user) return null
  if (user.role && typeof user.role === 'object' && user.role.type) {
    return user.role.type
  }

  const roleId =
    typeof user.role === 'number'
      ? user.role
      : typeof user.role === 'object'
        ? user.role?.id
        : undefined

  if (roleId) {
    const role = await strapi.db.query('plugin::users-permissions.role').findOne({
      where: { id: roleId },
    })
    return role?.type || null
  }

  const full = await strapi.db.query('plugin::users-permissions.user').findOne({
    where: { id: user.id },
    populate: ['role'],
  })
  return full?.role?.type || null
}
