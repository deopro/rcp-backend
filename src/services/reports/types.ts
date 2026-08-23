export type ReportType =
  | 'monthly-capacity'
  | 'employee-allocation'
  | 'project-allocation'
  | 'team'
  | 'department'
  | 'executive'
  | 'utilization'
  | 'bench'
  | 'skills'
  | 'forecast'

export type ReportFormat = 'xlsx' | 'csv' | 'pdf'

export type ReportColumn = {
  key: string
  label: string
  width?: number
}

export type ReportSheet = {
  name: string
  columns: ReportColumn[]
  rows: Record<string, string | number | null | undefined>[]
}

export type ReportDocument = {
  type: ReportType
  title: string
  generatedAt: string
  period: { from: string; to: string }
  sheets: ReportSheet[]
}

export type ReportQuery = {
  from: string
  to: string
  locale: string
  userId: number
  roleType: string | null
  departmentId?: number
  teamId?: number
  projectId?: number
  employeeId?: number
  scope?: 'org' | 'department' | 'team' | 'project'
  granularity?: 'day' | 'week' | 'month'
}

export const REPORT_TYPES: ReportType[] = [
  'monthly-capacity',
  'employee-allocation',
  'project-allocation',
  'team',
  'department',
  'executive',
  'utilization',
  'bench',
  'skills',
  'forecast',
]

export const REPORT_FORMATS: ReportFormat[] = ['xlsx', 'csv', 'pdf']

export function isReportType(value: string): value is ReportType {
  return REPORT_TYPES.includes(value as ReportType)
}

export function isReportFormat(value: string): value is ReportFormat {
  return REPORT_FORMATS.includes(value as ReportFormat)
}
