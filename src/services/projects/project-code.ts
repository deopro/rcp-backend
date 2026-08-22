/**
 * Sequential project codes: RCP0001, RCP0002, …
 */
export const PROJECT_CODE_PREFIX = 'RCP'
export const PROJECT_CODE_PAD = 4

const CODE_RE = new RegExp(`^${PROJECT_CODE_PREFIX}(\\d+)$`, 'i')

export function formatProjectCode(sequence: number): string {
  const n = Math.max(1, Math.floor(sequence))
  return `${PROJECT_CODE_PREFIX}${String(n).padStart(PROJECT_CODE_PAD, '0')}`
}

export function parseProjectCodeSequence(code: unknown): number | null {
  if (typeof code !== 'string' || !code.trim()) return null
  const match = code.trim().match(CODE_RE)
  if (!match) return null
  const n = Number(match[1])
  return Number.isFinite(n) ? n : null
}

export async function allocateNextProjectCode(strapi: {
  db: {
    query: (uid: string) => {
      findMany: (args: { select: string[] }) => Promise<Array<{ code?: string | null }>>
    }
  }
}): Promise<string> {
  const rows = await strapi.db.query('api::project.project').findMany({
    select: ['code'],
  })

  let max = 0
  for (const row of rows) {
    const seq = parseProjectCodeSequence(row.code)
    if (seq != null && seq > max) max = seq
  }

  return formatProjectCode(max + 1)
}
