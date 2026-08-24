import type { NotificationType } from './types'

type Locale = 'pt-PT' | 'en'

function localeKey(locale?: string | null): Locale {
  return locale?.startsWith('pt') ? 'pt-PT' : locale?.startsWith('en') ? 'en' : 'pt-PT'
}

function str(payload: Record<string, unknown>, key: string): string {
  const value = payload[key]
  return value == null ? '' : String(value)
}

function num(payload: Record<string, unknown>, key: string): string {
  const value = payload[key]
  return typeof value === 'number' ? String(value) : str(payload, key)
}

function period(payload: Record<string, unknown>): string {
  const start = str(payload, 'period_start').slice(0, 10)
  const end = str(payload, 'period_end').slice(0, 10)
  if (start && end) return `${start} → ${end}`
  const from = str(payload, 'from').slice(0, 10)
  const to = str(payload, 'to').slice(0, 10)
  if (from && to) return `${from} → ${to}`
  return str(payload, 'period')
}

function teamName(payload: Record<string, unknown>, locale: Locale): string {
  const name = str(payload, 'team_name')
  if (name) return name
  const id = str(payload, 'team_id')
  if (!id) return ''
  return locale === 'pt-PT' ? `Equipa #${id}` : `Team #${id}`
}

export function notificationCopy(
  type: NotificationType,
  payload: Record<string, unknown> = {},
  locale?: string | null,
): { title: string; body: string } {
  const loc = localeKey(locale)
  const pt = loc === 'pt-PT'
  const team = teamName(payload, loc)
  const range = period(payload)
  const employee = str(payload, 'employee_name') || str(payload, 'employee_name')
  const date = str(payload, 'date').slice(0, 10)
  const comments = str(payload, 'comments').trim()

  switch (type) {
    case 'approval_request':
      return {
        title: pt ? `Aprovação submetida — ${team}` : `Approval submitted — ${team}`,
        body: pt ? `O período ${range} aguarda revisão.` : `Period ${range} is awaiting review.`,
      }
    case 'approval_returned':
      return {
        title: pt ? `Aprovação devolvida — ${team}` : `Approval returned — ${team}`,
        body: comments
          ? pt
            ? `Período ${range}: ${comments}`
            : `Period ${range}: ${comments}`
          : pt
            ? `O período ${range} foi devolvido para alterações.`
            : `Period ${range} was returned for changes.`,
      }
    case 'approval_approved':
      return {
        title: pt ? `Aprovação aprovada — ${team}` : `Approval approved — ${team}`,
        body: pt ? `O período ${range} foi aprovado.` : `Period ${range} was approved.`,
      }
    case 'approval_locked':
      return {
        title: pt ? `Período bloqueado — ${team}` : `Period locked — ${team}`,
        body: pt
          ? `As alocações de ${range} estão bloqueadas.`
          : `Allocations for ${range} are now locked.`,
      }
    case 'approval_reopened':
      return {
        title: pt ? `Período reaberto — ${team}` : `Period reopened — ${team}`,
        body: pt
          ? `As alocações de ${range} podem voltar a ser editadas.`
          : `Allocations for ${range} can be edited again.`,
      }
    case 'over_allocation':
      return {
        title: pt ? `Sobre-alocação — ${employee}` : `Over-allocation — ${employee}`,
        body: pt
          ? `${num(payload, 'allocated')}h alocadas em ${date} (capacidade ${num(payload, 'available')}h).`
          : `${num(payload, 'allocated')}h allocated on ${date} (capacity ${num(payload, 'available')}h).`,
      }
    case 'missing_allocation':
      return {
        title: pt ? `Alocação em falta — ${employee}` : `Missing allocation — ${employee}`,
        body: pt
          ? `Sem horas registadas no dia útil ${date}.`
          : `No hours logged on working day ${date}.`,
      }
    case 'bench_alert':
      return {
        title: pt ? `Banco disponível — ${employee}` : `Bench available — ${employee}`,
        body: pt
          ? `${num(payload, 'remaining_hours')}h restantes (${num(payload, 'bench_pct')}% banco) em ${range}.`
          : `${num(payload, 'remaining_hours')}h remaining (${num(payload, 'bench_pct')}% bench) in ${range}.`,
      }
    case 'capacity_alert': {
      const util = Number(payload.utilization_pct ?? payload.utilization_pct)
      const high = str(payload, 'level') === 'high' || util > 95
      return {
        title: high
          ? pt
            ? 'Alerta de utilização elevada'
            : 'High utilization alert'
          : pt
            ? 'Alerta de utilização baixa'
            : 'Low utilization alert',
        body: pt
          ? `A utilização do âmbito é ${num(payload, 'utilization_pct') || util}% em ${range}.`
          : `Scope utilization is ${num(payload, 'utilization_pct') || util}% for ${range}.`,
      }
    }
    default:
      return { title: '', body: '' }
  }
}
