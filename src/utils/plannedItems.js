// Extra chapters/units the admin planned for a class, beyond its booked one.
// Accepts both shapes: the student/calendar feeds send
// [{ chapterName, unitName, done }], the mentor's managed list sends the raw
// [{ chapter: { name }, unit: { name } }]. Returns display names
// ("Chapter · Unit"), ✓-prefixed when `withDone` and the host ticked it.
export function plannedNames(c, { withDone = false } = {}) {
  return (c?.plannedItems || []).map((x) => {
    const ch = x.chapterName ?? x.chapter?.name ?? ''
    const un = x.unitName ?? x.unit?.name ?? ''
    const name = un ? `${ch} · ${un}` : ch
    return name && withDone && x.done ? `✓ ${name}` : name
  }).filter(Boolean)
}
