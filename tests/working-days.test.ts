import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  countWeekdays,
  countWorkingDays,
  expandDateRangeToIso,
  isWeekend,
  isWorkingDay,
  parseIsoDate,
  toIsoDate,
} from '../src/services/capacity/working-days'

describe('working-days', () => {
  it('parses and formats ISO dates without timezone shift', () => {
    const d = parseIsoDate('2026-08-15')
    assert.equal(toIsoDate(d), '2026-08-15')
  })

  it('detects weekends', () => {
    assert.equal(isWeekend(parseIsoDate('2026-08-15')), true) // Saturday
    assert.equal(isWeekend(parseIsoDate('2026-08-16')), true) // Sunday
    assert.equal(isWeekend(parseIsoDate('2026-08-17')), false) // Monday
  })

  it('counts weekdays in a Mon–Fri range', () => {
    // 2026-08-17 Mon … 2026-08-21 Fri
    assert.equal(countWeekdays(parseIsoDate('2026-08-17'), parseIsoDate('2026-08-21')), 5)
  })

  it('excludes weekends from week counts', () => {
    // Mon 17 Aug – Sun 23 Aug → 5 weekdays
    assert.equal(countWeekdays(parseIsoDate('2026-08-17'), parseIsoDate('2026-08-23')), 5)
  })

  it('excludes holidays from working days', () => {
    const holidays = new Set(['2026-08-19']) // Wednesday
    assert.equal(
      countWorkingDays('2026-08-17', '2026-08-21', holidays),
      4,
    )
    assert.equal(
      isWorkingDay(parseIsoDate('2026-08-19'), holidays),
      false,
    )
  })

  it('excludes leave dates from working days', () => {
    const leave = new Set(['2026-08-18', '2026-08-19'])
    assert.equal(countWorkingDays('2026-08-17', '2026-08-21', new Set(), leave), 3)
  })

  it('expands inclusive leave ranges to ISO dates', () => {
    const dates = expandDateRangeToIso('2026-08-17', '2026-08-19')
    assert.deepEqual(dates, ['2026-08-17', '2026-08-18', '2026-08-19'])
  })

  it('treats holiday + leave as non-working even on weekdays', () => {
    const holidays = new Set(['2026-08-17'])
    const leave = new Set(['2026-08-18'])
    assert.equal(isWorkingDay(parseIsoDate('2026-08-17'), holidays, leave), false)
    assert.equal(isWorkingDay(parseIsoDate('2026-08-18'), holidays, leave), false)
    assert.equal(isWorkingDay(parseIsoDate('2026-08-19'), holidays, leave), true)
  })
})
