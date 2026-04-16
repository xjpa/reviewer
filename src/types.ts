export type QuestionType = 'single' | 'multi'

export interface Choice {
  id: string
  label: string
}

export interface Chapter {
  id: string
  title: string
  focus: string
  questionCount?: number
}

export interface ReviewerSection {
  id: string
  title: string
  points: string[]
}

export interface ReviewerGuide {
  summary: string
  interviewFocus: string[]
  sections: ReviewerSection[]
}

export interface Unit {
  id: string
  title: string
  description: string
  chapterCount: number
  questionCount?: number
  chapters: Chapter[]
  reviewer?: ReviewerGuide
}

export interface Question {
  id: string
  code: string
  unitId: string
  chapterId: string
  prompt: string
  codeSnippet?: string
  type: QuestionType
  choices: Choice[]
  correctChoiceIds: string[]
  explanation: string
  studyNote?: string
  estimatedSeconds: number
}

export interface Track {
  id: string
  title: string
  description: string
  units: Unit[]
  questions: Question[]
}

export interface QuestionProgress {
  questionId: string
  attempts: number
  correctCount: number
  streak: number
  lastGrade: number
  lastReviewedAt: number
  nextReviewAt: number
  intervalDays: number
  easeFactor: number
}

export interface Session {
  id: string
  mode:
    | 'all'
    | 'review'
    | 'simulation'
    | { unitId: string }
    | { unitId: string; chapterId: string }
  questionIds: string[]
  currentIndex: number
  answers: SessionAnswerRecord[]
  choiceOrderByQuestionId: Record<string, string[]>
  startedAt: number
  questionStartedAt: number
  durationSeconds: number
  tracked: boolean
}

export interface SessionAnswerRecord {
  questionId: string
  selectedChoiceIds: string[]
  isCorrect: boolean
  elapsedSeconds: number
}

export interface SessionAnswer {
  isCorrect: boolean
  grade: number
  correctChoiceIds: string[]
  progress: QuestionProgress
}
