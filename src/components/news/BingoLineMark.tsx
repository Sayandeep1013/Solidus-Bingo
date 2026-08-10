import { View, StyleSheet } from 'react-native'
import type { LineId } from '@/lib/gameEngine'
import { colors } from '@/theme'

/** Shared board-grid geometry — used by both the online and bot game boards
 * so cell sizing and line-mark math stay in exactly one place. */
export const BOARD_CELL = 66
export const BOARD_GAP = 4
export const BOARD_SIZE = BOARD_CELL * 5 + BOARD_GAP * 4
const PITCH = BOARD_CELL + BOARD_GAP
const STROKE = 5

/**
 * A single accent-colored stroke drawn across a completed line's five cells —
 * the "dauber ink" mark for a whole row/column/diagonal, distinct from the
 * per-cell checkmark used for an individual called number.
 */
export function BingoLineMark({ lineId }: { lineId: LineId }) {
  const style = lineMarkStyle(lineId)
  return <View pointerEvents="none" style={[styles.mark, style]} />
}

function lineMarkStyle(lineId: LineId) {
  const center = BOARD_SIZE / 2

  if (lineId.startsWith('row_')) {
    const r = parseInt(lineId.slice(4), 10)
    const y = r * PITCH + BOARD_CELL / 2
    return { top: y - STROKE / 2, left: -8, width: BOARD_SIZE + 16, height: STROKE }
  }
  if (lineId.startsWith('col_')) {
    const c = parseInt(lineId.slice(4), 10)
    const x = c * PITCH + BOARD_CELL / 2
    return { top: -8, left: x - STROKE / 2, width: STROKE, height: BOARD_SIZE + 16 }
  }
  const length = Math.SQRT2 * (BOARD_SIZE + 16)
  const rotate = lineId === 'diag_main' ? '45deg' : '-45deg'
  return {
    top: center - STROKE / 2,
    left: center - length / 2,
    width: length,
    height: STROKE,
    transform: [{ rotate }],
  }
}

const styles = StyleSheet.create({
  mark: {
    position: 'absolute',
    backgroundColor: colors.accent,
    borderRadius: STROKE / 2,
  },
})
