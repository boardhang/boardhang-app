// Hold roles + placed holds. TS mirror of shared/spec/data-model.md
// (ported from ios/MoonBoardLED/Models/HoldType.swift).

/** The official MoonBoard hold roles, plus `foot` (a foothold — beta info like left/match). */
export type HoldType = 'start' | 'left' | 'right' | 'match' | 'end' | 'foot'

/** Letter sent in the BLE message (e.g. the "S" in "S0"). The firmware
 *  (FabianRig/ArduinoMoonBoardLED) parses all six, incl. `F` → cyan for footholds —
 *  see shared/spec/ble-protocol.md. */
export const protocolLetter: Record<HoldType, string> = {
  start: 'S',
  left: 'L',
  right: 'R',
  match: 'M',
  end: 'E',
  foot: 'F',
}

/** On-screen color, chosen to mirror the firmware's LED colors. */
export const holdColor: Record<HoldType, string> = {
  start: '#22c55e', // green
  left: '#a855f7', // violet
  right: '#3b82f6', // blue
  match: '#ec4899', // pink
  end: '#ef4444', // red
  foot: '#22d3ee', // cyan / turquoise
}

/** Human label for a role. */
export const holdLabel: Record<HoldType, string> = {
  start: 'Start',
  left: 'Left',
  right: 'Right',
  match: 'Match',
  end: 'End',
  foot: 'Foot',
}

/**
 * How this hold should appear/light given the "Show beta" setting.
 * Beta off collapses the move roles (left/right/match) into a single blue
 * (`right`), so only green (start), blue (move), and red (end) are shown.
 */
export function displayed(type: HoldType, showBeta: boolean): HoldType {
  if (showBeta) return type
  return type === 'start' || type === 'end' ? type : 'right'
}

/** A single placed hold: its grid position and role. */
export interface HoldAssignment {
  col: number // 0…10 (A…K, left → right)
  row: number // 1…12 (1 = bottom)
  type: HoldType
}
