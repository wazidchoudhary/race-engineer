/**
 * Team colors by UDP teamId — single source shared by TimingTower, TrackMap,
 * and anything else that paints cars. Mirrors get_lookups in src-tauri/lib.rs.
 *
 * 0-9 are the F1 25 season teams; 476-486 are the 2026-season teams
 * (packetFormat 2026 sends u16 team ids, including Audi and Cadillac).
 */
export const TEAM_COLORS: Record<number, string> = {
  0: '#27F4D2',   // Mercedes
  1: '#E80020',   // Ferrari
  2: '#3671C6',   // Red Bull Racing
  3: '#64C4FF',   // Williams
  4: '#229971',   // Aston Martin
  5: '#0093CC',   // Alpine
  6: '#6692FF',   // RB
  7: '#B6BABD',   // Haas
  8: '#FF8000',   // McLaren
  9: '#52E252',   // Sauber
  41: '#3671C6',  // F1 Generic
  // Historic / career-mode / My Team placeholders kept from the old maps
  85: '#6692FF', 86: '#FF98A8', 88: '#FF5733', 89: '#C70D3A',
  104: '#FF8000', // Custom Team
  143: '#52E252',
  253: '#FFFFFF',
  // 2026 season teams
  476: '#27F4D2', // Mercedes '26
  477: '#E80020', // Ferrari '26
  478: '#3671C6', // Red Bull Racing '26
  479: '#64C4FF', // Williams '26
  480: '#229971', // Aston Martin '26
  481: '#0093CC', // Alpine '26
  482: '#6692FF', // RB '26
  483: '#B6BABD', // Haas '26
  484: '#FF8000', // McLaren '26
  485: '#F50537', // Audi '26
  486: '#B59A57', // Cadillac '26
};

export function teamColor(teamId: number | undefined | null, fallback = '#888'): string {
  if (teamId == null) return fallback;
  return TEAM_COLORS[teamId] ?? fallback;
}
