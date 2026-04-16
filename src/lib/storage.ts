import type { QuestionProgress } from '../types'

export interface SessionRecord {
  id: string
  mode: string
  completedAt: number
  totalQuestions: number
  correctAnswers: number
  accuracy: number
}

export interface AppProgress {
  questions: Record<string, QuestionProgress>
  sessions: SessionRecord[]
}

const STORAGE_KEY = 'future-role-interview-prep'

export function createEmptyProgress(): AppProgress {
  return {
    questions: {},
    sessions: [],
  }
}

export function loadProgress(): AppProgress {
  const fallback = createEmptyProgress()

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return fallback
    }

    const parsed = JSON.parse(raw) as AppProgress
    return {
      questions: parsed.questions ?? {},
      sessions: parsed.sessions ?? [],
    }
  } catch {
    return fallback
  }
}

export function saveProgress(progress: AppProgress) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress))
}
