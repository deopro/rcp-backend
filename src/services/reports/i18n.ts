import type { ReportColumn, ReportType } from './types'

type Locale = 'pt-PT' | 'en'

function localeKey(locale: string): Locale {
  return locale.startsWith('pt') ? 'pt-PT' : 'en'
}

const REPORT_TITLES: Record<Locale, Record<ReportType, string>> = {
  en: {
    'monthly-capacity': 'Monthly Capacity Report',
    'employee-allocation': 'Employee Allocation Report',
    'project-allocation': 'Project Allocation Report',
    team: 'Team Report',
    department: 'Department Report',
    executive: 'Executive Report',
    utilization: 'Utilization Report',
    bench: 'Bench Report',
    skills: 'Skills Report',
    forecast: 'Forecast Report',
  },
  'pt-PT': {
    'monthly-capacity': 'Relatório de Capacidade Mensal',
    'employee-allocation': 'Relatório de Alocação por Colaborador',
    'project-allocation': 'Relatório de Alocação por Projeto',
    team: 'Relatório de Equipa',
    department: 'Relatório de Departamento',
    executive: 'Relatório Executivo',
    utilization: 'Relatório de Utilização',
    bench: 'Relatório de Banco',
    skills: 'Relatório de Competências',
    forecast: 'Relatório de Previsão',
  },
}

const COLUMN_LABELS: Record<Locale, Record<string, string>> = {
  en: {
    employee: 'Employee',
    team: 'Team',
    department: 'Department',
    project: 'Project',
    date: 'Date',
    month: 'Month',
    hours: 'Hours',
    notes: 'Notes',
    status: 'Status',
    available: 'Available hours',
    allocated: 'Allocated hours',
    remaining: 'Remaining hours',
    utilization: 'Utilization %',
    bench: 'Bench %',
    employees: 'Employees',
    skill: 'Skill',
    proficiency: 'Proficiency',
    period: 'Period',
    health: 'Health',
    over: 'Over hours',
    kpi: 'KPI',
    value: 'Value',
    total: 'Total',
    generated: 'Generated at',
    from: 'From',
    to: 'To',
    active_projects: 'Active projects',
    pending_approvals: 'Pending approvals',
    pending_leave: 'Pending leave',
  },
  'pt-PT': {
    employee: 'Colaborador',
    team: 'Equipa',
    department: 'Departamento',
    project: 'Projeto',
    date: 'Data',
    month: 'Mês',
    hours: 'Horas',
    notes: 'Notas',
    status: 'Estado',
    available: 'Horas disponíveis',
    allocated: 'Horas alocadas',
    remaining: 'Horas restantes',
    utilization: 'Utilização %',
    bench: 'Banco %',
    employees: 'Colaboradores',
    skill: 'Competência',
    proficiency: 'Proficiência',
    period: 'Período',
    health: 'Estado',
    over: 'Horas a mais',
    kpi: 'Indicador',
    value: 'Valor',
    total: 'Total',
    generated: 'Gerado em',
    from: 'De',
    to: 'Até',
    active_projects: 'Projetos ativos',
    pending_approvals: 'Aprovações pendentes',
    pending_leave: 'Ausências pendentes',
  },
}

const SHEET_NAMES: Record<Locale, Record<string, string>> = {
  en: {
    data: 'Data',
    summary: 'Summary',
    matrix: 'Allocation grid',
    kpis: 'KPIs',
    teams: 'Teams',
    projects: 'Projects',
    series: 'Forecast',
  },
  'pt-PT': {
    data: 'Dados',
    summary: 'Resumo',
    matrix: 'Grelha de alocação',
    kpis: 'Indicadores',
    teams: 'Equipas',
    projects: 'Projetos',
    series: 'Previsão',
  },
}

export function reportTitle(type: ReportType, locale: string): string {
  return REPORT_TITLES[localeKey(locale)][type]
}

export function columnLabel(key: string, locale: string): string {
  return COLUMN_LABELS[localeKey(locale)][key] || key
}

export function sheetName(key: string, locale: string): string {
  return SHEET_NAMES[localeKey(locale)][key] || key
}

export function columns(keys: string[], locale: string): ReportColumn[] {
  return keys.map((key) => ({ key, label: columnLabel(key, locale) }))
}

export function healthLabel(health: string, locale: string): string {
  const pt = localeKey(locale) === 'pt-PT'
  if (health === 'over') return pt ? 'Sobre-alocado' : 'Over-allocated'
  if (health === 'under') return pt ? 'Sub-utilizado' : 'Under-utilized'
  if (health === 'healthy') return pt ? 'Saudável' : 'Healthy'
  return health
}
