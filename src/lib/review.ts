import type { AppProgress } from './storage'
import type { Question, QuestionProgress, Session, SessionAnswer, SessionAnswerRecord, Track } from '../types'

export function uid() {
  return Math.random().toString(36).slice(2, 10)
}

export function createSession(mode: Session['mode'], questionIds: string[]): Session {
  const ids = shuffle(questionIds).slice(0, mode === 'simulation' ? 10 : questionIds.length)
  const durationSeconds = mode === 'simulation' ? ids.length * 45 : ids.length * 35
  const tracked =
    mode === 'simulation' ||
    mode === 'all' ||
    mode === 'review' ||
    (typeof mode === 'object' && 'unitId' in mode && !('chapterId' in mode))

  return {
    id: uid(),
    mode,
    questionIds: ids,
    currentIndex: 0,
    answers: [],
    choiceOrderByQuestionId: {},
    startedAt: Date.now(),
    questionStartedAt: Date.now(),
    durationSeconds,
    tracked,
  }
}

export function createChoiceOrderByQuestionId(track: Track, questionIds: string[]) {
  return questionIds.reduce<Record<string, string[]>>((accumulator, questionId) => {
    const question = track.questions.find((item) => item.id === questionId)
    if (!question) {
      return accumulator
    }

    accumulator[questionId] = shuffle(question.choices.map((choice) => choice.id))
    return accumulator
  }, {})
}

export function gradeQuestion(question: Question, selectedChoiceIds: string[], existing?: QuestionProgress): SessionAnswer {
  const selected = [...selectedChoiceIds].sort()
  const correct = [...question.correctChoiceIds].sort()
  const isCorrect = JSON.stringify(selected) === JSON.stringify(correct)
  const overlap = selected.filter((choiceId) => correct.includes(choiceId)).length
  const grade = isCorrect ? 4 : overlap > 0 ? 2 : 1
  const progress = updateQuestionProgress(question.id, grade, existing)

  return {
    isCorrect,
    grade,
    correctChoiceIds: question.correctChoiceIds,
    progress,
  }
}

export function updateQuestionProgress(
  questionId: string,
  grade: number,
  existing?: QuestionProgress,
): QuestionProgress {
  const now = Date.now()
  const prior = existing ?? {
    questionId,
    attempts: 0,
    correctCount: 0,
    streak: 0,
    lastGrade: 0,
    lastReviewedAt: 0,
    nextReviewAt: now,
    intervalDays: 0,
    easeFactor: 2.5,
  }

  const nextEaseFactor = Math.max(1.3, prior.easeFactor + (0.1 - (4 - grade) * (0.08 + (4 - grade) * 0.02)))
  const nextIntervalDays =
    grade >= 3
      ? prior.intervalDays === 0
        ? 1
        : Math.round(prior.intervalDays * nextEaseFactor)
      : 1

  return {
    ...prior,
    attempts: prior.attempts + 1,
    correctCount: prior.correctCount + (grade >= 4 ? 1 : 0),
    streak: grade >= 3 ? prior.streak + 1 : 0,
    lastGrade: grade,
    lastReviewedAt: now,
    nextReviewAt: now + nextIntervalDays * 24 * 60 * 60 * 1000,
    intervalDays: nextIntervalDays,
    easeFactor: nextEaseFactor,
  }
}

export function getDueQuestionIds(track: Track, progress: AppProgress, now: number) {
  return track.questions
    .filter((question) => {
      const item = progress.questions[question.id]
      return item && item.nextReviewAt <= now
    })
    .map((question) => question.id)
}

export function getRecommendedQuestionIds(track: Track, progress: AppProgress, limit: number) {
  const dueIds = getDueQuestionIds(track, progress, Date.now())
  const unseenIds = track.questions
    .filter((question) => !progress.questions[question.id])
    .map((question) => question.id)
  const strugglingIds = track.questions
    .filter((question) => {
      const item = progress.questions[question.id]
      return item && item.lastGrade <= 2
    })
    .map((question) => question.id)

  return [...new Set([...dueIds, ...strugglingIds, ...shuffle(unseenIds)])].slice(0, limit)
}

export function getTrackStats(track: Track, progress: AppProgress) {
  const entries = Object.values(progress.questions)
  const totalAttempts = entries.reduce((sum, entry) => sum + entry.attempts, 0)
  const totalCorrect = entries.reduce((sum, entry) => sum + entry.correctCount, 0)
  const masteredCount = entries.filter((entry) => entry.streak >= 2).length
  const strugglingCount = entries.filter((entry) => entry.lastGrade <= 2).length
  const bestStreak = entries.reduce((best, entry) => Math.max(best, entry.streak), 0)
  const dueCount = getDueQuestionIds(track, progress, Date.now()).length

  return {
    accuracy: totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0,
    masteredCount,
    strugglingCount,
    bestStreak,
    dueCount,
  }
}

export function getTopicInsights(track: Track, progress: AppProgress) {
  return track.units.map((unit) => {
    const unitQuestions = track.questions.filter((question) => question.unitId === unit.id)
    const unitSummary = summarizeQuestions(unitQuestions, progress)

    const chapters = unit.chapters
      .map((chapter) => {
        const chapterQuestions = unitQuestions.filter((question) => question.chapterId === chapter.id)
        const chapterSummary = summarizeQuestions(chapterQuestions, progress)

        return {
          id: chapter.id,
          title: chapter.title,
          attemptedCount: chapterSummary.attemptedCount,
          masteredCount: chapterSummary.masteredCount,
          dueCount: chapterSummary.dueCount,
          score: chapterSummary.score,
          status: getTopicStatus(chapterSummary.score, chapterSummary.attemptedCount),
        }
      })
      .sort((left, right) => left.score - right.score || left.title.localeCompare(right.title))

    return {
      id: unit.id,
      title: unit.title,
      attemptedCount: unitSummary.attemptedCount,
      masteredCount: unitSummary.masteredCount,
      totalCount: unitQuestions.length,
      dueCount: unitSummary.dueCount,
      score: unitSummary.score,
      status: getTopicStatus(unitSummary.score, unitSummary.attemptedCount),
      chapters,
    }
  })
}

export function computeSessionSummary(track: Track, answers: SessionAnswerRecord[]) {
  const totalQuestions = answers.length
  const correctAnswers = answers.filter((answer) => answer.isCorrect).length
  const totalElapsedSeconds = answers.reduce((sum, answer) => sum + answer.elapsedSeconds, 0)

  return {
    totalQuestions,
    correctAnswers,
    accuracy: totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 100) : 0,
    totalElapsedSeconds,
    questionLabels: answers
      .map((answer) => track.questions.find((question) => question.id === answer.questionId)?.code)
      .filter(Boolean),
  }
}

export function formatCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function shuffle<T>(items: T[]) {
  const copy = [...items]

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const otherIndex = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[otherIndex]] = [copy[otherIndex], copy[index]]
  }

  return copy
}

function summarizeQuestions(questions: Question[], progress: AppProgress) {
  const entries = questions
    .map((question) => progress.questions[question.id])
    .filter((entry): entry is QuestionProgress => Boolean(entry))

  const attemptedCount = entries.length
  const totalAttempts = entries.reduce((sum, entry) => sum + entry.attempts, 0)
  const totalCorrect = entries.reduce((sum, entry) => sum + entry.correctCount, 0)
  const masteredCount = entries.filter((entry) => entry.streak >= 2).length
  const dueCount = entries.filter((entry) => entry.nextReviewAt <= Date.now()).length
  const accuracy = totalAttempts > 0 ? totalCorrect / totalAttempts : 0
  const mastery = questions.length > 0 ? masteredCount / questions.length : 0
  const score = attemptedCount === 0 ? 0 : Math.round((accuracy * 0.7 + mastery * 0.3) * 100)

  return {
    attemptedCount,
    masteredCount,
    dueCount,
    score,
  }
}

function getTopicStatus(score: number, attemptedCount: number) {
  if (attemptedCount === 0) {
    return 'unseen'
  }

  if (score >= 80) {
    return 'strong'
  }

  if (score >= 55) {
    return 'building'
  }

  return 'weak'
}
