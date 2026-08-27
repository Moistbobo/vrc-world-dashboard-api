export interface TagSeedRow {
  tag: string;
  emoji: string;
  hexColor: string;
}

/**
 * The 28 canonical taxonomy tags with their emoji and hex color.
 * This is the seed for the `tags` catalog table (migration 010). The values
 * are taken from the dashboard's tag registry plus the `particle live / vrmv`
 * special case. The catalog is user-extensible at runtime, so this list is
 * only the initial seed, not the full set forever.
 */
export const TAG_SEED: TagSeedRow[] = [
  { tag: 'kino', emoji: '⛰️', hexColor: '#8b5cf6' },
  { tag: 'chill', emoji: '😎', hexColor: '#06b6d4' },
  { tag: 'comfy', emoji: '🛏️', hexColor: '#d946ef' },
  { tag: 'adventure', emoji: '🗺️', hexColor: '#f59e0b' },
  { tag: 'horror', emoji: '👻', hexColor: '#c084fc' },
  { tag: 'game', emoji: '🎮', hexColor: '#fb923c' },
  { tag: 'particle live / vrmv', emoji: '🎭', hexColor: '#f43f5e' },
  { tag: 'gallery', emoji: '🖼️', hexColor: '#6366f1' },
  { tag: 'meme', emoji: '😂', hexColor: '#facc15' },
  { tag: 'puzzle', emoji: '🧩', hexColor: '#14b8a6' },
  { tag: 'driving', emoji: '🚗', hexColor: '#ef4444' },
  { tag: 'flying', emoji: '✈️', hexColor: '#0ea5e9' },
  { tag: 'tech', emoji: '💻', hexColor: '#3b82f6' },
  { tag: 'nature', emoji: '🌿', hexColor: '#84cc16' },
  { tag: 'gamerip', emoji: '🎬', hexColor: '#a855f7' },
  { tag: 'portal', emoji: '🌀', hexColor: '#06b6d4' },
  { tag: 'liminal', emoji: '🌫️', hexColor: '#94a3b8' },
  { tag: 'moon', emoji: '🌙', hexColor: '#a78bfa' },
  { tag: 'space', emoji: '🚀', hexColor: '#6366f1' },
  { tag: 'day', emoji: '☀️', hexColor: '#f59e0b' },
  { tag: 'night', emoji: '🌌', hexColor: '#64748b' },
  { tag: 'dawn', emoji: '🌅', hexColor: '#fb7185' },
  { tag: 'dusk', emoji: '🌆', hexColor: '#f97316' },
  { tag: 'bar', emoji: '🍸', hexColor: '#ec4899' },
  { tag: 'club', emoji: '🪩', hexColor: '#a855f7' },
  { tag: 'beach', emoji: '🏖️', hexColor: '#38bdf8' },
  { tag: 'urban', emoji: '🏙️', hexColor: '#64748b' },
  { tag: 'aquatic', emoji: '🐟', hexColor: '#06b6d4' }
];
