// 30 player colors ordered so consecutive indices are maximally distinct on the hue wheel.
// New colors are interleaved so a typical 2–9 player game never gets two similar-looking hues.
export const PLAYER_COLORS = [
  '#6c63ff', // violet       ~250°
  '#ff6b6b', // coral red    ~0°
  '#00d4aa', // teal         ~165°
  '#ffd166', // yellow       ~48°
  '#e91e8c', // magenta      ~320°
  '#26de81', // emerald      ~145°
  '#f19066', // peach        ~20°
  '#3dc1d3', // cyan         ~188°
  '#cf6a87', // mauve        ~340°
  '#74b9ff', // sky blue     ~210°
  '#fdcb6e', // amber        ~45°
  '#546de5', // indigo       ~235°
  '#55efc4', // seafoam      ~162°
  '#fc5c65', // scarlet      ~357°
  '#a55eea', // orchid       ~280°
  '#fd9644', // tangerine    ~30°
  '#00cec9', // turquoise    ~178°
  '#c44569', // raspberry    ~345°
  '#4b7bec', // cobalt       ~220°
  '#7bed9f', // mint         ~140°
  '#e17055', // burnt orange ~15°
  '#f78fb3', // rose pink    ~335°
  '#2bcbba', // jade         ~175°
  '#fed330', // gold         ~47°
  '#778beb', // periwinkle   ~230°
  '#eb3b5a', // cherry       ~351°
  '#a29bfe', // lavender     ~252°
  '#20bf6b', // forest       ~147°
  '#e15f41', // vermillion   ~12°
  '#ff9f43', // mango        ~35°
];

// Deterministic color for a player by name — same color regardless of sort order.
export function colorFor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PLAYER_COLORS[h % PLAYER_COLORS.length];
}
