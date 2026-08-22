// The CA curriculum vocabulary, shared by the student and mentor portals so the
// same enrollment is never described two different ways.

// Groups exist only for Intermediate and Final. 'both' is an enrollment choice,
// not a paper's group — a paper is always Group 1 or Group 2 (or unassigned).
export const CA_GROUPS = [
  { value: 'group1', label: 'Group 1' },
  { value: 'group2', label: 'Group 2' },
  { value: 'both',   label: 'Both groups' },
]

export const groupLabel = (g) => CA_GROUPS.find(x => x.value === g)?.label || ''

// One line for what a student is enrolled for: "Intermediate · Group 1",
// "Intermediate · Both groups", or "Intermediate · 2 papers". Picked papers
// REPLACE the group as the scope, which is why they win here too. Empty when
// nothing has been set for them yet.
//
// The picked papers arrive under a different key depending on the endpoint —
// `papers` (names, mentor list), `caSubjects` (objects, report) — so take
// whichever is present rather than making every caller normalise.
export function enrollmentLabel({ caLevel, caGroup, papers, caSubjects, paperCount } = {}) {
  const n = papers?.length ?? caSubjects?.length ?? paperCount ?? 0
  const parts = []
  if (caLevel) parts.push(caLevel)
  if (n) parts.push(`${n} paper${n !== 1 ? 's' : ''}`)
  else if (caGroup) parts.push(groupLabel(caGroup))
  return parts.join(' · ')
}
