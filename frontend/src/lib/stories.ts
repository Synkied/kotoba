import type { StoryLength, StoryState, Syllabus } from './api'

export const STORY_BUSY: StoryState[] = ['queued', 'writing', 'checking', 'voicing']
export const STORY_STATE: Record<StoryState, string> = {
  queued: 'Waiting for the worker…', writing: 'Writing…', checking: 'Checking its words…', voicing: 'Reading it aloud…', done: 'Ready', failed: 'Stopped',
}
export const STORY_LENGTH: Record<StoryLength, string> = { short: 'Short', medium: 'Medium', long: 'Long' }

/** A unit as menus name it: JLPT's by level (N4), a course's by number and title (19 · かぜ). */
export const unitLabel = (syl: Pick<Syllabus, 'bundled'>, u: { number: number; title: string }) =>
  syl.bundled ? u.title : `${u.number}${u.title ? ` · ${u.title}` : ''}`
