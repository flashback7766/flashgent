import { describe, expect, it } from 'vitest'
import {
  ThinkingSplitter,
  nearingThinkingBudget,
  splitThinking,
  stripStrayTags
} from '../../src/renderer/agent/thinking.js'

/** Feed a string one character at a time, the worst case for tag detection. */
function streamCharByChar(raw: string): { text: string; thinking: string } {
  const splitter = new ThinkingSplitter()
  let text = ''
  let thinking = ''
  for (const char of raw) {
    const out = splitter.feed(char)
    text += out.text
    thinking += out.thinking
  }
  const tail = splitter.flush()
  return { text: text + tail.text, thinking: thinking + tail.thinking }
}

describe('ThinkingSplitter', () => {
  it('separates a thinking region from the visible answer', () => {
    const raw = '<thinking>the file is empty</thinking>The file is empty.'

    expect(splitThinking(raw)).toEqual({
      text: 'The file is empty.',
      thinking: 'the file is empty'
    })
  })

  it('never leaks a tag when it straddles chunk boundaries', () => {
    const raw = 'before <thinking>hidden</thinking> after'
    const out = streamCharByChar(raw)

    expect(out.text).toBe('before  after')
    expect(out.thinking).toBe('hidden')
    expect(out.text).not.toContain('<')
  })

  it('accepts the <think> and <reasoning> spellings too', () => {
    expect(splitThinking('<think>a</think>b').thinking).toBe('a')
    expect(splitThinking('<reasoning>a</reasoning>b').thinking).toBe('a')
  })

  it('handles several thinking regions in one completion', () => {
    const out = splitThinking('<thinking>one</thinking>mid<thinking>two</thinking>end')

    expect(out.thinking).toBe('onetwo')
    expect(out.text).toBe('midend')
  })

  it('treats an unterminated region as thinking rather than losing it', () => {
    const splitter = new ThinkingSplitter()
    const streamed = splitter.feed('visible <thinking>never closed')
    const tail = splitter.flush()

    expect(splitter.unterminated).toBe(true)
    expect(streamed.text + tail.text).toBe('visible ')
    expect(streamed.thinking + tail.thinking).toBe('never closed')
  })

  it('passes plain text through untouched', () => {
    const raw = 'No tags here. 1 < 2 and 3 > 2.'
    expect(splitThinking(raw)).toEqual({ text: raw, thinking: '' })
  })

  describe('malformed tags', () => {
    it('handles an opening tag with no closing bracket', () => {
      // Seen in the wild: `<thinking ` followed straight by the reasoning.
      const raw = '<thinking I will read secret.txt to find the code. </thinking>Here it is.'
      const out = splitThinking(raw)

      expect(out.text).toBe('Here it is.')
      expect(out.thinking).toContain('secret.txt')
      expect(out.text).not.toContain('<')
    })

    it('is case-insensitive', () => {
      expect(splitThinking('<Thinking>hmm</THINKING>answer').text).toBe('answer')
    })

    it('tolerates whitespace and attributes inside the tag', () => {
      expect(splitThinking('< thinking foo="1" >hmm</ thinking >answer').text).toBe('answer')
    })

    it('does not mistake <think> for a prefix of <thinking>', () => {
      expect(splitThinking('<thinking>a</thinking>b').text).toBe('b')
      expect(splitThinking('<think>a</think>b').text).toBe('b')
    })

    it('never leaks a malformed tag when streamed character by character', () => {
      const out = streamCharByChar('<thinking reasoning here </thinking>visible')
      expect(out.text).toBe('visible')
      expect(out.text).not.toMatch(/thinking/i)
    })
  })

  it('does not stall on a lone angle bracket at the end of a chunk', () => {
    const splitter = new ThinkingSplitter()
    const first = splitter.feed('a <')
    const second = splitter.feed('b')

    expect(first.text + second.text).toBe('a <b')
  })
})

describe('stripStrayTags', () => {
  it('removes a tag shape the splitter did not recognise', () => {
    expect(stripStrayTags('answer </thinking> more')).toBe('answer more')
    expect(stripStrayTags('<thinking answer')).toBe('answer')
  })

  it('leaves ordinary text and comparisons alone', () => {
    const text = 'if (a < b && c > d) return "<ok>"'
    expect(stripStrayTags(text)).toBe(text)
  })
})

describe('nearingThinkingBudget', () => {
  it('is false while there is room left', () => {
    expect(nearingThinkingBudget('x'.repeat(100), 1000)).toBe(false)
  })

  it('becomes true once the reasoning approaches the budget', () => {
    // 3.5 chars per token, 80% of 100 tokens ≈ 280 characters.
    expect(nearingThinkingBudget('x'.repeat(300), 100)).toBe(true)
  })

  it('is always false when reasoning is not budgeted', () => {
    expect(nearingThinkingBudget('x'.repeat(10_000), 0)).toBe(false)
  })
})
