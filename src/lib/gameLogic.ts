/**
 * Solidus Bingo — core game logic
 */

/** Generate a random 5x5 bingo card (numbers 1-75) */
export function generateBingoCard(): number[][] {
  const card: number[][] = []
  const ranges = [
    [1, 15],   // B
    [16, 30],  // I
    [31, 45],  // N
    [46, 60],  // G
    [61, 75],  // O
  ]

  for (let col = 0; col < 5; col++) {
    const [min, max] = ranges[col]
    const pool = Array.from({ length: max - min + 1 }, (_, i) => i + min)
    const picked: number[] = []
    while (picked.length < 5) {
      const idx = Math.floor(Math.random() * pool.length)
      picked.push(...pool.splice(idx, 1))
    }
    for (let row = 0; row < 5; row++) {
      if (!card[row]) card[row] = []
      card[row][col] = picked[row]
    }
  }

  // Free space in centre
  card[2][2] = 0
  return card
}

/** Check if a card has bingo given a set of called numbers */
export function checkBingo(card: number[][], called: Set<number>): boolean {
  const size = 5

  // Rows
  for (let r = 0; r < size; r++) {
    if (card[r].every(n => n === 0 || called.has(n))) return true
  }

  // Columns
  for (let c = 0; c < size; c++) {
    if (card.every(row => row[c] === 0 || called.has(row[c]))) return true
  }

  // Diagonals
  if (card.every((row, i) => row[i] === 0 || called.has(row[i]))) return true
  if (card.every((row, i) => row[size - 1 - i] === 0 || called.has(row[size - 1 - i]))) return true

  return false
}

/** Draw the next number (1-75) not yet called */
export function drawNumber(called: Set<number>): number | null {
  const remaining = Array.from({ length: 75 }, (_, i) => i + 1).filter(n => !called.has(n))
  if (remaining.length === 0) return null
  return remaining[Math.floor(Math.random() * remaining.length)]
}
