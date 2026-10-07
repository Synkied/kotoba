import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mergeLabels, parseLabels } from './labels.ts'

test('splits labels on ASCII, Japanese and full-width commas', () => {
  assert.deepEqual(parseLabels('minna no nihongo, lesson 18'), ['minna no nihongo', 'lesson 18'])
  assert.deepEqual(parseLabels('アニメ、第3話，  op  ,, '), ['アニメ', '第3話', 'op'])
  assert.deepEqual(parseLabels('Drama, drama'), ['Drama'])
})

test('merging respects the three-label limit', () => {
  assert.deepEqual(mergeLabels(['a'], ['A', 'b']), ['a', 'b'])
  assert.equal(mergeLabels(['a', 'b'], ['c', 'd']), null)
})
