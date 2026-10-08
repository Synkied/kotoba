import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SpeechEndDetector } from './audio.ts'

test('waits for speech and allows short pauses before stopping', () => {
  const detector = new SpeechEndDetector()
  assert.equal(detector.update(0, 5), false)
  assert.equal(detector.update(0.05, 0.2), false)
  assert.equal(detector.update(0, 1), false)
  assert.equal(detector.update(0.05, 0.2), false)
  assert.equal(detector.update(0, 1.4), false)
  assert.equal(detector.update(0, 0.11), true)
})

test('ignores a brief noise spike', () => {
  const detector = new SpeechEndDetector()
  assert.equal(detector.update(0.1, 0.02), false)
  assert.equal(detector.update(0, 2), false)
})

test('caps continuous recordings at the server limit', () => {
  const detector = new SpeechEndDetector()
  assert.equal(detector.update(0.05, 59), false)
  assert.equal(detector.update(0.05, 1), true)
})

test('stops when the room stays noisy after speech', () => {
  const detector = new SpeechEndDetector()
  for (let t = 0; t < 1; t += 0.01) detector.update(0, 0.01)
  for (let t = 0; t < 1; t += 0.01) detector.update(0.1, 0.01)
  let stopped = false, after = 0
  for (; after < 10 && !stopped; after += 0.01) stopped = detector.update(0.03, 0.01)
  assert.ok(stopped, 'never stopped on a steady noise floor')
  assert.ok(after < 8, `took ${after.toFixed(1)} s`)
})

test('keeps going through continuous speech with short dips', () => {
  const detector = new SpeechEndDetector()
  for (let t = 0; t < 0.5; t += 0.01) detector.update(0.005, 0.01)
  for (let t = 0; t < 20; t += 0.01) assert.equal(detector.update(Math.floor(t * 5) % 2 ? 0.12 : 0.05, 0.01), false)
})
