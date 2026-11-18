// The sample map has 176 regions. Use the same starting totals on all three views.
const total = 176;

export function sampleSnapshot(covered = 49) {
  return { total, covered, lap: 1, participants: 180 + covered * 2, minutes: 420 + covered * 5 };
}

export function sampleGrid(features, covered) {
  return Object.fromEntries(features.filter((_, index) => (index * 53) % total < covered)
    .map(feature => [feature.id, 1]));
}
