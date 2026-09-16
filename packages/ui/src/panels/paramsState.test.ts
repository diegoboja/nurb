import { describe, it, expect } from "vitest"
import { adjustable, decimals, dirtyValues, sliderRange, tidy } from "./paramsState"
import type { Param } from "../types"

const width: Param = { name: "width", kind: "float", default: 40.0 }
const count: Param = { name: "count", kind: "int", default: 4, description: "how many" }
const flag: Param = { name: "flag", kind: "bool", default: false }
const name: Param = { name: "label", kind: "str", default: "x" }

describe("paramsState", () => {
  it("spans half to double and never starts a positive int at zero", () => {
    expect(sliderRange(40, false)).toEqual({ lo: 20, hi: 80, step: 1 })
    expect(sliderRange(4, true)).toEqual({ lo: 2, hi: 8, step: 1 })
    expect(sliderRange(1, true).lo).toBe(1)
    const zero = sliderRange(0, false)
    expect(zero.lo).toBe(0)
    expect(zero.hi).toBe(1)
  })

  it("keeps a negative default inside its range", () => {
    const range = sliderRange(-3, false)
    expect(range.lo).toBeLessThanOrEqual(-3)
    expect(range.hi).toBeGreaterThanOrEqual(-3)
  })

  it("never gives an int slider fewer than four stops", () => {
    const range = sliderRange(1, true)
    expect(range.hi - range.lo).toBeGreaterThanOrEqual(4)
  })

  it("keeps a fractional default on the step grid", () => {
    expect(sliderRange(9.5, false)).toEqual({ lo: 4.7, hi: 19, step: 0.1 })
    expect(sliderRange(92.5, false)).toEqual({ lo: 46.2, hi: 185, step: 0.1 })
    expect(sliderRange(0.25, false).step).toBe(0.01)
  })

  it("tidies to a number someone would write", () => {
    expect(tidy(0.30000000000000004, 0.1)).toBe(0.3)
    expect(tidy(42.00000001, 1)).toBe(42)
  })

  it("counts written decimal places and caps runaway fractions", () => {
    expect(decimals(12)).toBe(0)
    expect(decimals(9.5)).toBe(1)
    expect(decimals(1 / 3)).toBe(4)
    expect(decimals(1e-7)).toBe(0)
  })

  it("gives controls to bool, int, and float only", () => {
    expect(adjustable(width) && adjustable(count) && adjustable(flag)).toBe(true)
    expect(adjustable(name)).toBe(false)
  })

  it("keeps only what differs from the declared default", () => {
    const params = [width, count, flag, name]
    expect(dirtyValues(params, {})).toEqual({})
    expect(dirtyValues(params, { width: 40.0, count: 4 })).toEqual({})
    expect(dirtyValues(params, { width: 55, flag: true })).toEqual({ width: 55, flag: true })
  })
})
