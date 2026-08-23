/**
 * AI provider abstraction — keys stay on the API only.
 */
export type RecommendationInput = {
  projectId: number
  from: string
  to: string
  teamId?: number
  limit?: number
}

export type SkillMatchDetail = {
  skill_id: number
  skill_name: string
  required: boolean
  has_skill: boolean
  proficiency_level?: string | null
}

export type RecommendationMatch = {
  employee_id: number
  document_id: string
  full_name: string
  team_name?: string | null
  score: number
  skill_score: number
  availability_score: number
  remaining_hours: number
  bench_pct: number
  matched_skills: SkillMatchDetail[]
  missing_skills: { skill_id: number; skill_name: string }[]
  reasons: string[]
  explanation?: string
}

export type RecommendationResult = {
  recommendation_id: string
  project_id: number
  project_document_id: string
  project_name: string
  from: string
  to: string
  provider: string
  matches: RecommendationMatch[]
  availability_summary: {
    candidates: number
    avg_utilization_pct: number
    total_remaining_hours: number
  }
}

export type ApplyRecommendationInput = {
  recommendationId: string
  employeeId: number
  allocationDate: string
  hours: number
  notes?: string
}

export interface AiProvider {
  name: string
  enhanceExplanation(match: RecommendationMatch, locale?: string): Promise<string>
}

export function proficiencyWeight(level?: string | null): number {
  switch (level) {
    case 'expert':
      return 1
    case 'advanced':
      return 0.9
    case 'intermediate':
      return 0.75
    case 'beginner':
      return 0.5
    default:
      return 0.6
  }
}
