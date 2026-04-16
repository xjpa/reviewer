# Future Role Interview Prep

Mobile-first React practice app for preparing for future engineering roles. It is designed to feel like a focused interview drill tool rather than a content-heavy course site: short sessions, visible timing pressure, local progress tracking, and spaced repetition without requiring a backend.

## What it does

- Browse prep units and chapters from a content-driven question bank
- Run full-track practice, per-unit practice, or a mixed interview simulation
- Grade answers immediately and explain the reasoning
- Save progress locally in the browser
- Track past session accuracy
- Schedule question review with a lightweight spaced repetition model

## Stack

- React
- TypeScript
- Vite
- Local persistence with `localStorage`

The app is intentionally static so it can be hosted on GitHub Pages. `vite.config.ts` uses `base: './'` so built assets resolve correctly from a project subpath.

## Local development

```bash
npm install
npm run dev
```

## Quality checks

```bash
npm run build
npm run lint
```

## Project structure

```text
src/
  data/content.ts      Static track, unit, chapter, and question content
  lib/review.ts        Session generation, grading, and spaced repetition logic
  lib/storage.ts       Browser persistence
  types.ts             Shared app types
  App.tsx              Main UI and practice flow
```

## Current product shape

- One interview-prep track
- Three units with chapters
- Timed simulation mode
- Review queue based on previous performance
- Recent-session history

## Next steps

- Add open-ended prompt types and rubric-based grading
- Add export/import for local progress backups
- Add multiple tracks for different role families
- Add richer results summaries after each session
- Add authoring tools for question editing
