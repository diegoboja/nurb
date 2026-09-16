// Pure logic for the parameter panel: slider ranges inferred from defaults and
// the dirty-value diff. Free of React and the DOM so a plain runner can drive it.

import type { Param, Params } from "../types"

// No part annotates a range, so one is guessed the way the OSS viewer does:
// half the default to double it, never a 0-based range (item_depth=0 is an
// error, not a design), soft (typing outside widens it). `int` must be told,
// never inferred: Python's 1.0 arrives in JS as 1.
export function sliderRange(defaultValue: number, int: boolean) {
  let lo: number
  let hi: number
  if (defaultValue === 0) {
    lo = 0
    hi = int ? 8 : 1
  } else if (defaultValue < 0) {
    lo = defaultValue * 2
    hi = defaultValue / 2
  } else {
    lo = defaultValue / 2
    hi = defaultValue * 2
  }
  if (int) {
    lo = Math.floor(lo)
    hi = Math.ceil(hi)
    if (defaultValue >= 1) lo = Math.max(1, lo)
    if (hi - lo < 4) hi = lo + 4 // never a slider with two stops on it
    return { lo, hi, step: 1 }
  }
  // The default must sit on the step grid, or the thumb snaps to a neighbour
  // while the fill and the number show the real value (9.5 on a step of 1).
  const step = Math.min(10 ** (Math.floor(Math.log10(hi - lo)) - 1), 10 ** -decimals(defaultValue))
  return { lo: tidy(Math.floor(lo / step) * step, step), hi: tidy(Math.ceil(hi / step) * step, step), step }
}

// Decimal places a number is written with, capped so 1/3 never asks for a
// step of 1e-16. 9.5 -> 1, 12 -> 0.
export function decimals(value: number): number {
  const text = String(value)
  const dot = text.indexOf(".")
  return dot === -1 || text.includes("e") ? 0 : Math.min(text.length - dot - 1, 4)
}

// A slider lands on 0.30000000000000004, which is not a dimension anyone chose.
export function tidy(value: number, step: number): number {
  const places = Math.max(0, -Math.floor(Math.log10(step)))
  return +value.toFixed(places)
}

export function adjustable(param: Param): boolean {
  return param.kind === "bool" || param.kind === "int" || param.kind === "float"
}

// The values that differ from the part's declared defaults: exactly what Apply
// writes back. Sending only the diff means an untouched panel sends {}.
export function dirtyValues(params: Param[], values: Params): Params {
  const out: Params = {}
  for (const param of params) {
    if (!adjustable(param)) continue
    const held = values[param.name]
    if (held === undefined || held === param.default) continue
    out[param.name] = held
  }
  return out
}
