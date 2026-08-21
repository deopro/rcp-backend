// AI provider abstraction (Milestone 12 wires OpenAI).
// Keys stay on the API only — never expose to Nuxt.

export type RecommendationInput = {
  projectId: string
  requiredSkillIds: string[]
  from: string
  to: string
  teamId?: string
}

export type RecommendationMatch = {
  employeeId: string
  score: number
  reasons: string[]
}

export interface AiProvider {
  recommendResources(input: RecommendationInput): Promise<RecommendationMatch[]>
  explainRecommendation(match: RecommendationMatch): Promise<string>
}

export class NoopAiProvider implements AiProvider {
  async recommendResources(): Promise<RecommendationMatch[]> {
    return []
  }

  async explainRecommendation(): Promise<string> {
    return ''
  }
}
