/**
 * OpenAI provider — enhances explanations only; scoring stays rule-based.
 */
import type { AiProvider, RecommendationMatch } from './provider'

type OpenAiConfig = { apiKey: string; model?: string }

export class OpenAiProvider implements AiProvider {
  name = 'openai'
  private apiKey: string
  private model: string

  constructor(config: OpenAiConfig) {
    this.apiKey = config.apiKey
    this.model = config.model || 'gpt-4o-mini'
  }

  async enhanceExplanation(match: RecommendationMatch, locale = 'en'): Promise<string> {
    const lang = locale.startsWith('pt') ? 'Portuguese (Portugal)' : 'English'
    const prompt = `You are a resource planning assistant. In 2-3 concise sentences in ${lang}, explain why this employee is recommended. Use only these facts:

Employee: ${match.full_name}
Score: ${match.score}/100, skill fit ${match.skill_score}%, availability ${match.availability_score}%
Bench: ${match.remaining_hours}h remaining
Matched: ${match.matched_skills.filter((s) => s.has_skill).map((s) => s.skill_name).join(', ') || 'none'}
Missing: ${match.missing_skills.map((s) => s.skill_name).join(', ') || 'none'}`

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.3,
      }),
    })

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`)
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    return data.choices?.[0]?.message?.content?.trim() || ''
  }
}

export class LocalExplanationProvider implements AiProvider {
  name = 'local'

  async enhanceExplanation(match: RecommendationMatch, locale = 'en'): Promise<string> {
    const pt = locale.startsWith('pt')
    const matched = match.matched_skills.filter((s) => s.has_skill)
    const parts: string[] = []

    if (matched.length) {
      const names = matched.map((s) => `${s.skill_name} (${s.proficiency_level || '?'})`).join(', ')
      parts.push(
        pt
          ? `${match.full_name} tem competências relevantes: ${names}.`
          : `${match.full_name} has relevant skills: ${names}.`,
      )
    } else if (match.missing_skills.length) {
      parts.push(
        pt
          ? `${match.full_name} não cobre todas as competências exigidas, mas tem capacidade disponível.`
          : `${match.full_name} does not cover all required skills but has available capacity.`,
      )
    }

    parts.push(
      pt
        ? `Restam ${match.remaining_hours}h de banco (${match.bench_pct}%) — score ${match.score}/100.`
        : `${match.remaining_hours}h bench remaining (${match.bench_pct}%) — score ${match.score}/100.`,
    )
    return parts.join(' ')
  }
}

export function createAiProvider(): AiProvider {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (apiKey) return new OpenAiProvider({ apiKey, model: process.env.OPENAI_MODEL })
  return new LocalExplanationProvider()
}
