import trackConfig from './track.json'
import type { Question, ReviewerGuide, Track, Unit } from '../types'

export interface DeckFile {
  id: string
  title: string
  description: string
  questionCount?: number
  chapters: Unit['chapters']
  questions: Question[]
  reviewer: ReviewerGuide
}

const deckModules = import.meta.glob('./decks/*.json') as Record<string, () => Promise<{ default: DeckFile }>>
const deckCache = new Map<string, DeckFile>()

export const trackManifest = {
  id: trackConfig.id,
  title: trackConfig.title,
  description: trackConfig.description,
  decks: trackConfig.decks as Unit[],
}

export async function loadDeckContent(deckId: string) {
  if (deckCache.has(deckId)) {
    return deckCache.get(deckId)!
  }

  const loader = deckModules[`./decks/${deckId}.json`]
  if (!loader) {
    throw new Error(`Missing deck content for ${deckId}`)
  }

  const module = await loader()
  deckCache.set(deckId, module.default)
  return module.default
}

export async function loadAllDeckContents() {
  const decks = await Promise.all(trackManifest.decks.map((deck) => loadDeckContent(deck.id)))
  return decks
}

export function buildTrackFromDecks(decks: DeckFile[]): Track {
  const deckMap = new Map(decks.map((deck) => [deck.id, deck]))

  const units: Unit[] = trackManifest.decks.map((deck) => {
    const loaded = deckMap.get(deck.id)
    return {
      ...deck,
      reviewer: loaded?.reviewer,
    }
  })

  return {
    id: trackManifest.id,
    title: trackManifest.title,
    description: trackManifest.description,
    units,
    questions: decks.flatMap((deck) => deck.questions),
  }
}
