/** T58 — stable per-holder color (hash of the filed name → 6 hues).
 *  Same holder = same color across the lens map, the register, the seats,
 *  the company-page ownership card, and every week of the playback. */

const HOLDER_COLORS = ["#22d3ee", "#60a5fa", "#a78bfa", "#f472b6", "#fbbf24", "#34d399"];

export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function holderColor(name: string): string {
  return HOLDER_COLORS[hashStr(name) % HOLDER_COLORS.length];
}
