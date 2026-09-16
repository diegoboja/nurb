import { describe, it, expect } from "vitest"
import { clock, elapsedLabel } from "./format"

describe("elapsedLabel", () => {
  it("reads 0.0s at the start of a run", () => {
    expect(elapsedLabel(0)).toBe("0.0s")
  })

  it("keeps one decimal under a minute", () => {
    expect(elapsedLabel(4.2)).toBe("4.2s")
  })

  // The tenths would round to "60.0s" here, which is a minute spelled wrong.
  it("switches to m:ss before the tenths can read 60", () => {
    expect(elapsedLabel(59.96)).toBe("1:00")
  })

  it("reads m:ss over a minute", () => {
    expect(elapsedLabel(67)).toBe("1:07")
  })

  it("never goes negative", () => {
    expect(elapsedLabel(-3)).toBe("0.0s")
  })
})

describe("clock", () => {
  it("returns null with no figure", () => {
    expect(clock(null)).toBe(null)
    expect(clock(undefined)).toBe(null)
  })

  it("pads the seconds", () => {
    expect(clock(321)).toBe("5:21")
    expect(clock(9)).toBe("0:09")
  })

  it("rounds to the nearest second", () => {
    expect(clock(59.6)).toBe("1:00")
  })
})
