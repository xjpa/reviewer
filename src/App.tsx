import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { buildTrackFromDecks, loadAllDeckContents, loadDeckContent, type DeckFile, trackManifest } from './data/content'
import {
  computeSessionSummary,
  createChoiceOrderByQuestionId,
  createSession,
  formatCountdown,
  getDueQuestionIds,
  getRecommendedQuestionIds,
  getTrackStats,
  getTopicInsights,
  gradeQuestion,
  uid,
} from './lib/review'
import {
  createEmptyProgress,
  loadProgress,
  saveProgress,
  type AppProgress,
  type SessionRecord,
} from './lib/storage'
import type { Question, Session, SessionAnswer, Unit } from './types'

type SessionPreset =
  | 'all'
  | 'review'
  | 'simulation'
  | { unitId: string }
  | { unitId: string; chapterId: string }

function App() {
  const [progress, setProgress] = useState<AppProgress>(() => loadProgress())
  const [loadedDecks, setLoadedDecks] = useState<Record<string, DeckFile>>({})
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const [draftSelection, setDraftSelection] = useState<string[]>([])
  const [submittedAnswer, setSubmittedAnswer] = useState<SessionAnswer | null>(null)
  const [reviewerDeckId, setReviewerDeckId] = useState<string | null>(null)
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null)
  const [isLoadingDecks, setIsLoadingDecks] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    saveProgress(progress)
  }, [progress])

  useEffect(() => {
    void preloadDecks()
  }, [])

  const loadedTrack = useMemo(
    () => buildTrackFromDecks(Object.values(loadedDecks)),
    [loadedDecks],
  )
  const totalQuestionCount = useMemo(
    () => trackManifest.decks.reduce((sum, deck) => sum + (deck.questionCount ?? 0), 0),
    [],
  )
  const stats = useMemo(() => getTrackStats(loadedTrack, progress), [loadedTrack, progress])
  const topicInsights = useMemo(() => getTopicInsights(loadedTrack, progress), [loadedTrack, progress])
  const reviewerDeck = useMemo(
    () => {
      if (!reviewerDeckId) {
        return null
      }

      const manifestDeck = trackManifest.decks.find((deck) => deck.id === reviewerDeckId)
      const loadedDeck = loadedDecks[reviewerDeckId]

      if (!manifestDeck || !loadedDeck) {
        return null
      }

      return {
        ...manifestDeck,
        reviewer: loadedDeck.reviewer,
      }
    },
    [loadedDecks, reviewerDeckId],
  )

  const currentQuestion = useMemo(() => {
    if (!activeSession) {
      return null
    }

    return loadedTrack.questions.find(
      (question) => question.id === activeSession.questionIds[activeSession.currentIndex],
    ) ?? null
  }, [activeSession, loadedTrack])

  useEffect(() => {
    if (!currentQuestion) {
      setDraftSelection([])
      setSubmittedAnswer(null)
      return
    }

    if (!activeSession) {
      setDraftSelection([])
      setSubmittedAnswer(null)
      return
    }

    setDraftSelection(activeSession.draftSelectionByQuestionId[currentQuestion.id] ?? [])
    setSubmittedAnswer(activeSession.submittedAnswerByQuestionId[currentQuestion.id] ?? null)
  }, [activeSession, currentQuestion])

  const preloadDecks = async () => {
    try {
      const decks = await loadAllDeckContents()
      setLoadedDecks((current) => {
        const next = { ...current }
        decks.forEach((deck) => {
          next[deck.id] = deck
        })
        return next
      })
    } catch {
      // Keep the app usable even if some content fails to preload.
    }
  }

  const ensureDeckLoaded = async (deckId: string) => {
    if (loadedDecks[deckId]) {
      return loadedDecks[deckId]
    }

    const deck = await loadDeckContent(deckId)
    setLoadedDecks((current) => ({ ...current, [deck.id]: deck }))
    return deck
  }

  const startSession = async (preset: SessionPreset) => {
    setIsLoadingDecks(true)
    try {
      const decksForSession =
        preset === 'all' || preset === 'review' || preset === 'simulation'
          ? await loadAllDeckContents()
          : [await ensureDeckLoaded(preset.unitId)]

      setLoadedDecks((current) => {
        const next = { ...current }
        decksForSession.forEach((deck) => {
          next[deck.id] = deck
        })
        return next
      })

      const workingTrack = buildTrackFromDecks(decksForSession)
      const candidateIds =
        preset === 'all'
          ? workingTrack.questions.map((question) => question.id)
          : preset === 'review'
            ? getDueQuestionIds(workingTrack, progress, now)
            : preset === 'simulation'
              ? getRecommendedQuestionIds(workingTrack, progress, 10)
              : workingTrack.questions
                  .filter((question) =>
                    question.unitId === preset.unitId &&
                    (!('chapterId' in preset) || question.chapterId === preset.chapterId),
                  )
                  .map((question) => question.id)

      if (candidateIds.length === 0) {
        return
      }

      const session = createSession(preset, candidateIds)
      setActiveSession({
        ...session,
        choiceOrderByQuestionId: createChoiceOrderByQuestionId(workingTrack, session.questionIds),
      })
    } finally {
      setIsLoadingDecks(false)
    }
  }

  const toggleChoice = (choiceId: string) => {
    if (!currentQuestion || submittedAnswer) {
      return
    }

    if (currentQuestion.type === 'single') {
      const nextSelection = [choiceId]
      setDraftSelection(nextSelection)
      setActiveSession((current) =>
        current && current.questionIds[current.currentIndex] === currentQuestion.id
          ? {
              ...current,
              draftSelectionByQuestionId: {
                ...current.draftSelectionByQuestionId,
                [currentQuestion.id]: nextSelection,
              },
            }
          : current,
      )
      return
    }

    setDraftSelection((current) => {
      const nextSelection = current.includes(choiceId)
        ? current.filter((item) => item !== choiceId)
        : [...current, choiceId]

      setActiveSession((active) =>
        active && active.questionIds[active.currentIndex] === currentQuestion.id
          ? {
              ...active,
              draftSelectionByQuestionId: {
                ...active.draftSelectionByQuestionId,
                [currentQuestion.id]: nextSelection,
              },
            }
          : active,
      )

      return nextSelection
    })
  }

  const submitCurrent = () => {
    if (!activeSession || !currentQuestion || draftSelection.length === 0) {
      return
    }

    const graded = gradeQuestion(
      currentQuestion,
      draftSelection,
      activeSession.tracked ? progress.questions[currentQuestion.id] : undefined,
    )

    setSubmittedAnswer(graded)
    setActiveSession({
      ...activeSession,
      draftSelectionByQuestionId: {
        ...activeSession.draftSelectionByQuestionId,
        [currentQuestion.id]: draftSelection,
      },
      submittedAnswerByQuestionId: {
        ...activeSession.submittedAnswerByQuestionId,
        [currentQuestion.id]: graded,
      },
    })
  }

  const persistCurrentQuestion = (session: Session, question: Question, answer: SessionAnswer | null) => {
    if (!answer) {
      return {
        answers: session.answers,
        progress,
      }
    }

    const elapsedSeconds = Math.max(1, Math.round((Date.now() - session.questionStartedAt) / 1000))
    const nextRecord = {
      questionId: question.id,
      selectedChoiceIds: session.draftSelectionByQuestionId[question.id] ?? draftSelection,
      isCorrect: answer.isCorrect,
      elapsedSeconds,
    }
    const existingIndex = session.answers.findIndex((item) => item.questionId === question.id)
    const updatedAnswers =
      existingIndex >= 0
        ? session.answers.map((item, index) => (index === existingIndex ? nextRecord : item))
        : [...session.answers, nextRecord]

    const updatedProgress = session.tracked
      ? {
          ...progress,
          questions: {
            ...progress.questions,
            [question.id]: answer.progress,
          },
        }
      : progress

    return {
      answers: updatedAnswers,
      progress: updatedProgress,
    }
  }

  const navigateQuestion = (direction: -1 | 1) => {
    if (!activeSession || !currentQuestion) {
      return
    }

    const nextIndex = activeSession.currentIndex + direction
    if (nextIndex < 0 || nextIndex >= activeSession.questionIds.length) {
      return
    }

    const persisted = persistCurrentQuestion(activeSession, currentQuestion, submittedAnswer)
    if (activeSession.tracked && persisted.progress !== progress) {
      setProgress(persisted.progress)
    }

    setActiveSession({
      ...activeSession,
      answers: persisted.answers,
      draftSelectionByQuestionId: {
        ...activeSession.draftSelectionByQuestionId,
        [currentQuestion.id]: draftSelection,
      },
      currentIndex: nextIndex,
      questionStartedAt: Date.now(),
    })
  }

  const finishSession = () => {
    if (!activeSession || !currentQuestion || !submittedAnswer) {
      return
    }

    const completedAt = Date.now()
    const persisted = persistCurrentQuestion(activeSession, currentQuestion, submittedAnswer)
    const summary = computeSessionSummary(loadedTrack, persisted.answers)
    const record: SessionRecord = {
      id: uid(),
      mode:
        typeof activeSession.mode === 'string'
          ? activeSession.mode
          : `deck:${activeSession.mode.unitId}`,
      completedAt,
      totalQuestions: persisted.answers.length,
      correctAnswers: summary.correctAnswers,
      accuracy: summary.accuracy,
    }

    if (activeSession.tracked) {
      setProgress({
        ...persisted.progress,
        sessions: [record, ...persisted.progress.sessions].slice(0, 20),
      })
    }
    setActiveSession(null)
    setSubmittedAnswer(null)
    setDraftSelection([])
  }

  const resetAllProgress = () => {
    setProgress(createEmptyProgress())
    setActiveSession(null)
  }

  const openReviewer = async (deckId: string) => {
    setIsLoadingDecks(true)
    try {
      await ensureDeckLoaded(deckId)
      setReviewerDeckId(deckId)
    } finally {
      setIsLoadingDecks(false)
    }
  }

  const abandonSession = () => {
    if (!activeSession) {
      return
    }

    const hasStartedWork = activeSession.answers.length > 0 || draftSelection.length > 0
    if (hasStartedWork) {
      const shouldLeave = window.confirm(
        'Leave this session and go back to the deck list? Your current run will be discarded.',
      )

      if (!shouldLeave) {
        return
      }
    }

    setActiveSession(null)
    setSubmittedAnswer(null)
    setDraftSelection([])
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Interview practice platform</p>
          <h1>{trackManifest.title}</h1>
          <p className="hero-description">{trackManifest.description}</p>
        </div>
        <div className="hero-stats">
          <Metric label="Questions" value={`${totalQuestionCount}`} />
          <Metric label="Due now" value={`${stats.dueCount}`} />
          <Metric label="Accuracy" value={`${stats.accuracy}%`} />
          <Metric label="Sessions" value={`${progress.sessions.length}`} />
        </div>
      </section>
      {isLoadingDecks ? <p className="loading-copy">Loading deck content...</p> : null}

      {reviewerDeck ? (
        <ReviewerView deck={reviewerDeck} onBack={() => setReviewerDeckId(null)} />
      ) : !activeSession ? (
        <div className="layout-grid">
          <section className="primary-column">
            <article className="simulation-card">
              <div>
                <h2>Interview Simulation</h2>
                <p>
                  Mixed practice across all decks with timing pressure, spaced-review reinforcement,
                  and immediate feedback.
                </p>
              </div>
              <button className="action-card action-card--primary" onClick={() => void startSession('simulation')}>
                Start 10-question interview simulation
              </button>
            </article>

            <article className="simulation-card">
              <div>
                <h2>Review Queue</h2>
                <p>{stats.dueCount > 0 ? `${stats.dueCount} questions are due for review.` : 'No reviews due yet. Build history with a few sessions first.'}</p>
              </div>
              <button
                className="action-card"
                disabled={stats.dueCount === 0}
                onClick={() => void startSession('review')}
              >
                Practice due reviews
              </button>
            </article>

            <section className="unit-list">
              <div className="section-heading">
                <h2>Decks</h2>
                <button className="text-button" onClick={() => void startSession('all')}>
                  Practice all
                </button>
              </div>
              {trackManifest.decks.map((unit, index) => {
                const unitQuestions = loadedTrack.questions.filter((question) => question.unitId === unit.id)
                const masteredCount = unitQuestions.filter((question) => {
                  const item = progress.questions[question.id]
                  return item && item.streak >= 2
                }).length
                const isExpanded = selectedDeckId === unit.id

                return (
                  <article className="unit-card" key={unit.id}>
                    <div className="unit-card__header">
                      <div>
                        <p className="unit-index">Deck {index + 1}</p>
                        <h3>{unit.title}</h3>
                      </div>
                      <div className="deck-actions">
                        <button className="action-card action-card--ghost" onClick={() => void openReviewer(unit.id)}>
                          Reviewer
                        </button>
                        <button
                          className="action-card action-card--ghost"
                          onClick={() =>
                            setSelectedDeckId((current) => (current === unit.id ? null : unit.id))
                          }
                        >
                          {isExpanded ? 'Hide chapters' : 'Open deck'}
                        </button>
                        <button className="action-card" onClick={() => void startSession({ unitId: unit.id })}>
                          Practice
                        </button>
                      </div>
                    </div>
                    <p className="unit-description">{unit.description}</p>
                    <div className="unit-meta">
                      <span>{unit.chapterCount} chapters</span>
                      <span>{unit.questionCount ?? 0} questions</span>
                      <span>{masteredCount} mastered</span>
                    </div>
                    {isExpanded ? (
                      <div className="chapter-list">
                        {unit.chapters.map((chapter, chapterIndex) => (
                          <div className="chapter-row" key={chapter.id}>
                            <div>
                              <span>
                                {chapterIndex + 1}. {chapter.title}
                              </span>
                              <small>{chapter.focus}</small>
                            </div>
                            <div className="chapter-actions">
                              <small className="chapter-count">{chapter.questionCount ?? 0} questions</small>
                              <button
                                className="text-button"
                                disabled={(chapter.questionCount ?? 0) === 0}
                                onClick={() => void startSession({ unitId: unit.id, chapterId: chapter.id })}
                              >
                                Drill chapter
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </article>
                )
              })}
            </section>
          </section>

          <aside className="secondary-column">
            <section className="panel">
              <div className="section-heading">
                <h2>Progress snapshot</h2>
              </div>
              <div className="stats-stack">
                <Metric label="Mastered" value={`${stats.masteredCount}/${totalQuestionCount}`} />
                <Metric label="Needs work" value={`${stats.strugglingCount}`} />
                <Metric label="Best streak" value={`${stats.bestStreak}`} />
              </div>
            </section>

            <section className="panel">
              <div className="section-heading">
                <h2>Topic map</h2>
              </div>
              <div className="topic-list">
                {topicInsights.map((unit) => (
                  <div className="topic-card" key={unit.id}>
                    <div className="topic-card__header">
                      <div>
                        <strong>{unit.title}</strong>
                        <p>
                          {unit.masteredCount}/{unit.totalCount} mastered
                          {unit.dueCount > 0 ? ` · ${unit.dueCount} due` : ''}
                        </p>
                      </div>
                      <span className={`topic-status topic-status--${unit.status}`}>{unit.score}%</span>
                    </div>
                    <div className="topic-meter">
                      <div className="topic-meter__fill" style={{ width: `${unit.score}%` }} />
                    </div>
                    <div className="topic-chip-list">
                      {unit.chapters.map((chapter) => (
                        <button
                          className={`topic-chip topic-chip--${chapter.status}`}
                          key={chapter.id}
                          onClick={() => void startSession({ unitId: unit.id, chapterId: chapter.id })}
                          type="button"
                        >
                          <span>{chapter.title}</span>
                          <small>
                            {chapter.attemptedCount > 0
                              ? `${chapter.score}% · ${chapter.masteredCount} mastered`
                              : 'Unseen'}
                          </small>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="section-heading">
                <h2>Recent sessions</h2>
              </div>
              <div className="history-list">
                {progress.sessions.length > 0 ? (
                  progress.sessions.slice(0, 6).map((session) => (
                    <div className="history-row" key={session.id}>
                      <div>
                        <strong>{session.mode}</strong>
                        <p>{new Date(session.completedAt).toLocaleDateString()}</p>
                      </div>
                      <span>{session.accuracy}%</span>
                    </div>
                  ))
                ) : (
                  <p className="empty-copy">No completed sessions yet.</p>
                )}
              </div>
            </section>

            <section className="panel">
              <div className="section-heading">
                <h2>Storage</h2>
              </div>
              <p className="storage-copy">
                Progress is saved in your browser so the site can live on GitHub Pages without a
                backend.
              </p>
              <button className="text-button" onClick={resetAllProgress}>
                Reset local progress
              </button>
            </section>
          </aside>
        </div>
      ) : currentQuestion ? (
        <PracticeView
          activeSession={activeSession}
          currentQuestion={currentQuestion}
          countdown={Math.max(
            0,
            Math.round((activeSession.startedAt + activeSession.durationSeconds * 1000 - now) / 1000),
          )}
          draftSelection={draftSelection}
          submittedAnswer={submittedAnswer}
          onQuit={abandonSession}
          onSubmit={submitCurrent}
          onToggleChoice={toggleChoice}
          onPrevious={() => navigateQuestion(-1)}
          onNext={() => navigateQuestion(1)}
          onFinish={finishSession}
        />
      ) : null}
    </main>
  )
}

function ReviewerView({ deck, onBack }: { deck: Unit; onBack: () => void }) {
  return (
    <section className="reviewer-shell">
      <header className="practice-header">
        <div>
          <button className="back-button" onClick={onBack}>
            Back to decks
          </button>
          <p className="eyebrow">Crash Course Reviewer</p>
          <h2>{deck.title}</h2>
          <p className="helper-copy">{deck.description}</p>
        </div>
      </header>

      <section className="question-panel">
        <div className="reviewer-summary">
          <p>{deck.reviewer?.summary}</p>
        </div>

        <div className="reviewer-focus">
          <h3>What Interviewers Usually Care About</h3>
          <div className="focus-chip-list">
            {deck.reviewer?.interviewFocus.map((item) => (
              <span className="focus-chip" key={item}>
                {item}
              </span>
            ))}
          </div>
        </div>

        <div className="reviewer-sections">
          {deck.reviewer?.sections.map((section) => (
            <article className="reviewer-card" key={section.id}>
              <h3>{section.title}</h3>
              <ul className="reviewer-points">
                {section.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </section>
  )
}

function PracticeView({
  activeSession,
  currentQuestion,
  countdown,
  draftSelection,
  submittedAnswer,
  onQuit,
  onSubmit,
  onToggleChoice,
  onPrevious,
  onNext,
  onFinish,
}: {
  activeSession: Session
  currentQuestion: Question
  countdown: number
  draftSelection: string[]
  submittedAnswer: SessionAnswer | null
  onQuit: () => void
  onSubmit: () => void
  onToggleChoice: (choiceId: string) => void
  onPrevious: () => void
  onNext: () => void
  onFinish: () => void
}) {
  const orderedChoices =
    activeSession.choiceOrderByQuestionId[currentQuestion.id]
      ?.map((choiceId) => currentQuestion.choices.find((choice) => choice.id === choiceId))
      .filter((choice): choice is NonNullable<typeof choice> => Boolean(choice)) ?? currentQuestion.choices
  const currentDeck = trackManifest.decks.find((unit) => unit.id === currentQuestion.unitId)
  const currentChapter = currentDeck?.chapters.find((chapter) => chapter.id === currentQuestion.chapterId)

  return (
    <section className="practice-shell">
      <header className="practice-header">
        <div>
          <button className="back-button" onClick={onQuit}>
            Back to decks
          </button>
          <p className="eyebrow">{trackManifest.title}</p>
          <h2>{labelMode(activeSession.mode)}</h2>
          {!activeSession.tracked ? (
            <p className="helper-copy">Chapter drills are stateless and do not update progress.</p>
          ) : null}
        </div>
        <div className="practice-meta">
          <strong>{formatCountdown(countdown)}</strong>
          <span>
            {activeSession.currentIndex + 1}/{activeSession.questionIds.length}
          </span>
          <button className="action-card action-card--ghost" onClick={onQuit}>
            Cancel session
          </button>
        </div>
      </header>

      <div className="question-panel">
        <p className="question-code">{currentQuestion.code}</p>
        {currentChapter ? (
          <div className="chapter-pill">
            <span>{currentDeck?.title}</span>
            <strong>{currentChapter.title}</strong>
          </div>
        ) : null}
        {currentQuestion.codeSnippet ? (
          <pre className="study-note question-code-block">{currentQuestion.codeSnippet}</pre>
        ) : null}
        <h3>{currentQuestion.prompt}</h3>
        {currentQuestion.problemDescription ? (
          <div className="question-brief">
            <p className="question-brief__label">Problem</p>
            <p>{currentQuestion.problemDescription}</p>
          </div>
        ) : null}
        {currentQuestion.inputFormat ? (
          <div className="question-brief">
            <p className="question-brief__label">Input</p>
            <pre className="study-note question-brief__block">{currentQuestion.inputFormat}</pre>
          </div>
        ) : null}
        {currentQuestion.outputFormat ? (
          <div className="question-brief">
            <p className="question-brief__label">Output</p>
            <pre className="study-note question-brief__block">{currentQuestion.outputFormat}</pre>
          </div>
        ) : null}
        {currentQuestion.exampleInput || currentQuestion.exampleOutput ? (
          <div className="question-brief question-brief--split">
            {currentQuestion.exampleInput ? (
              <div>
                <p className="question-brief__label">Example Input</p>
                <pre className="study-note question-brief__block">{currentQuestion.exampleInput}</pre>
              </div>
            ) : null}
            {currentQuestion.exampleOutput ? (
              <div>
                <p className="question-brief__label">Example Output</p>
                <pre className="study-note question-brief__block">{currentQuestion.exampleOutput}</pre>
              </div>
            ) : null}
          </div>
        ) : null}
        <p className="helper-copy">
          {currentQuestion.type === 'multi' ? 'Select all that apply' : 'Select one answer'}
        </p>

        <div className="choice-list">
          {orderedChoices.map((choice) => {
            const isSelected = draftSelection.includes(choice.id)
            const isCorrect = submittedAnswer?.correctChoiceIds.includes(choice.id)
            const showIncorrect = submittedAnswer && isSelected && !isCorrect

            return (
              <button
                className={[
                  'choice-card',
                  isSelected ? 'choice-card--selected' : '',
                  submittedAnswer && isCorrect ? 'choice-card--correct' : '',
                  showIncorrect ? 'choice-card--incorrect' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                disabled={Boolean(submittedAnswer)}
                key={choice.id}
                onClick={() => onToggleChoice(choice.id)}
              >
                <span className="choice-indicator" />
                <span className="choice-label">{choice.label}</span>
              </button>
            )
          })}
        </div>

        {submittedAnswer ? (
          <div className="feedback-panel">
            <div className="feedback-badge">
              {submittedAnswer.isCorrect ? 'Correct' : `Grade ${submittedAnswer.grade}/4`}
            </div>
            <p>{currentQuestion.explanation}</p>
            {currentQuestion.firstPrinciples?.length ? (
              <div className="learning-block">
                <p className="question-brief__label">First Principles</p>
                <ul className="learning-list">
                  {currentQuestion.firstPrinciples.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {currentQuestion.tips?.length ? (
              <div className="learning-block">
                <p className="question-brief__label">Tips</p>
                <ul className="learning-list">
                  {currentQuestion.tips.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {currentQuestion.studyNote ? (
              <pre className="study-note">{currentQuestion.studyNote}</pre>
            ) : null}
            <div className="practice-nav">
              <button
                className="action-card action-card--ghost"
                disabled={activeSession.currentIndex === 0}
                onClick={onPrevious}
              >
                Previous problem
              </button>
              {activeSession.currentIndex === activeSession.questionIds.length - 1 ? (
                <button className="primary-button" onClick={onFinish}>
                  Finish session
                </button>
              ) : (
                <button className="primary-button" onClick={onNext}>
                  Next problem
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="practice-nav">
            <button
              className="action-card action-card--ghost"
              disabled={activeSession.currentIndex === 0}
              onClick={onPrevious}
            >
              Previous problem
            </button>
            <div className="practice-nav__actions">
              <button
                className="action-card action-card--ghost"
                disabled={activeSession.currentIndex === activeSession.questionIds.length - 1}
                onClick={onNext}
              >
                Next problem
              </button>
              <button className="primary-button" disabled={draftSelection.length === 0} onClick={onSubmit}>
                Submit selection
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function labelMode(mode: Session['mode']) {
  if (mode === 'all') {
    return 'All questions'
  }

  if (mode === 'review') {
    return 'Spaced review'
  }

  if (mode === 'simulation') {
    return 'Interview simulation'
  }

  if ('chapterId' in mode) {
    const unit = trackManifest.decks.find((item) => item.id === mode.unitId)
    const chapter = unit?.chapters.find((item) => item.id === mode.chapterId)
    return chapter ? `${unit?.title}: ${chapter.title}` : 'Chapter drill'
  }

  const unit = trackManifest.decks.find((item) => item.id === mode.unitId)
  return unit ? unit.title : 'Deck practice'
}

export default App
