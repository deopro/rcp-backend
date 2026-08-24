import type { Core } from '@strapi/strapi'

/** Account access uses Strapi's native `blocked` flag, not User.status. */
export function isAccountBlocked(user: { blocked?: unknown } | null | undefined): boolean {
  return Boolean(user?.blocked)
}

/** Copy leftover User.status=inactive onto blocked while the status column still exists. */
export async function migrateInactiveUsersToBlocked(strapi: Core.Strapi): Promise<void> {
  const knex = strapi.db.connection
  const hasStatus = await knex.schema.hasColumn('up_users', 'status')
  if (!hasStatus) return

  const updated = await knex('up_users').where('status', 'inactive').andWhere((qb) => {
    qb.where('blocked', false).orWhereNull('blocked')
  }).update({ blocked: true })

  if (updated) {
    strapi.log.info(`Migrated ${updated} inactive user(s) to blocked`)
  }
}

/** Warn if employee emails collide before / after the unique constraint. */
export async function logDuplicateEmployeeEmails(strapi: Core.Strapi): Promise<void> {
  const rows = await strapi.db.query('api::employee.employee').findMany({
    select: ['id', 'email'],
  })

  const byEmail = new Map<string, number[]>()
  for (const row of rows) {
    const email = typeof row.email === 'string' ? row.email.trim().toLowerCase() : ''
    if (!email) continue
    const ids = byEmail.get(email) ?? []
    ids.push(row.id as number)
    byEmail.set(email, ids)
  }

  const duplicates = [...byEmail.entries()].filter(([, ids]) => ids.length > 1)
  if (!duplicates.length) return

  strapi.log.warn(
    `Duplicate employee emails: ${duplicates
      .map(([email, ids]) => `${email} [${ids.join(', ')}]`)
      .join('; ')}`,
  )
}
