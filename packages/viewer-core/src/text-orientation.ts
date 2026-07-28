/** Clockwise rotation in quarter turns. */
export type TextQuarterTurn = 0 | 90 | 180 | 270;

/** Whether text follows its page or stays upright relative to the viewport. */
export type TextOrientationBehavior = 'page' | 'upright';

/**
 * Composes intrinsic text rotation with effective page rotation.
 * `upright` deliberately excludes page rotation.
 * @param intrinsic - The intrinsic value (TextQuarterTurn).
 * @param behavior - The behavior value (TextOrientationBehavior).
 * @param pageRotation - The pageRotation value (TextQuarterTurn).
 * @returns The resulting TextQuarterTurn.
 *
 */
export function composeTextRotation(
  intrinsic: TextQuarterTurn,
  behavior: TextOrientationBehavior,
  pageRotation: TextQuarterTurn,
): TextQuarterTurn {
  return ((intrinsic + (behavior === 'page' ? pageRotation : 0)) % 360) as TextQuarterTurn;
}
