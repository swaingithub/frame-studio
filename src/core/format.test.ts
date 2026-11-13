import { describe, expect, it } from 'vitest'
import { formatBytes, formatDuration, formatRelativeTime } from './format'

describe('formatBytes', () => {
  it('formats bytes without unit juggling', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
  })

  it('formats kilobytes and megabytes', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(512 * 1024)).toBe('512 KB')
    expect(formatBytes(24 * 1024 * 1024)).toBe('24.0 MB')
  })

  it('rounds large gigabyte values', () => {
    expect(formatBytes(3.5 * 1024 * 1024 * 1024)).toBe('3.5 GB')
    expect(formatBytes(150 * 1024 * 1024 * 1024)).toBe('150 GB')
  })

  it('falls back to a dash for invalid input', () => {
    expect(formatBytes(-1)).toBe('—')
    expect(formatBytes(Number.NaN)).toBe('—')
  })
})

describe('formatDuration', () => {
  it('renders simple durations', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(59)).toBe('0:59')
    expect(formatDuration(95)).toBe('1:35')
  })

  it('renders hours', () => {
    expect(formatDuration(3600)).toBe('1:00:00')
    expect(formatDuration(3671)).toBe('1:01:11')
  })

  it('is robust against garbage', () => {
    expect(formatDuration(-5)).toBe('0:00')
    expect(formatDuration(Number.NaN)).toBe('0:00')
  })
})

describe('formatRelativeTime', () => {
  it('buckets into readable units', () => {
    const now = Date.now()
    expect(formatRelativeTime(now - 5_000, now)).toBe('just now')
    expect(formatRelativeTime(now - 3 * 60_000, now)).toBe('3 mins ago')
    expect(formatRelativeTime(now - 2 * 60 * 60_000, now)).toBe('2 hours ago')
    expect(formatRelativeTime(now - 3 * 24 * 60 * 60_000, now)).toBe('3 days ago')
  })
})
