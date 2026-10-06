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
