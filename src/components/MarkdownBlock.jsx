// Renders extracted/generated question text.
//
// The AI is instructed to emit every table as a GitHub-flavored Markdown table,
// so the one thing this MUST get right is turning those into real <table>s
// instead of showing raw pipes. Everything else is light formatting (bold,
// paragraphs). Dependency-free on purpose — no markdown lib needed for this.

const isSeparator = (line) => /^\s*\|?[\s:-]*-{2,}[\s:|-]*\|?\s*$/.test(line) && line.includes('-')
const isTableRow  = (line) => line.includes('|')

function splitRow(line) {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|'))   s = s.slice(0, -1)
  return s.split('|').map((c) => c.trim())
}

// **bold** → <strong>; everything else stays literal text.
function renderInline(text, keyPrefix) {
  const parts = String(text ?? '').split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**') && p.length > 4
      ? <strong key={`${keyPrefix}-b${i}`}>{p.slice(2, -2)}</strong>
      : <span key={`${keyPrefix}-t${i}`}>{p}</span>
  )
}

// Group the raw text into { type: 'table' | 'text', lines }
function parseBlocks(text) {
  const lines = String(text ?? '').split('\n')
  const blocks = []
  let i = 0

  while (i < lines.length) {
    // A table = a row, a --- separator, then any following rows.
    if (isTableRow(lines[i]) && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const header = splitRow(lines[i])
      i += 2
      const rows = []
      while (i < lines.length && isTableRow(lines[i]) && lines[i].trim()) {
        rows.push(splitRow(lines[i]))
        i++
      }
      blocks.push({ type: 'table', header, rows })
      continue
    }
    const buf = []
    while (i < lines.length && !(isTableRow(lines[i]) && i + 1 < lines.length && isSeparator(lines[i + 1]))) {
      buf.push(lines[i])
      i++
    }
    if (buf.join('').trim()) blocks.push({ type: 'text', lines: buf })
  }
  return blocks
}

export default function MarkdownBlock({ text, className = '' }) {
  if (!text) return null
  const blocks = parseBlocks(text)

  return (
    <div className={className}>
      {blocks.map((b, bi) => {
        if (b.type === 'table') {
          return (
            // Wide tables scroll inside their own container — never the page.
            <div key={bi} className="my-2 overflow-x-auto">
              <table className="min-w-full text-xs border border-gray-200 rounded-lg border-collapse">
                <thead className="bg-gray-50">
                  <tr>
                    {b.header.map((h, hi) => (
                      <th key={hi} className="border border-gray-200 px-2.5 py-1.5 text-left font-semibold text-gray-700 whitespace-nowrap">
                        {renderInline(h, `h${bi}-${hi}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((r, ri) => (
                    <tr key={ri} className="even:bg-gray-50/50">
                      {r.map((c, ci) => (
                        <td key={ci} className="border border-gray-200 px-2.5 py-1.5 text-gray-700 align-top">
                          {renderInline(c, `c${bi}-${ri}-${ci}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        return (
          <p key={bi} className="whitespace-pre-wrap leading-relaxed">
            {b.lines.map((l, li) => (
              <span key={li}>
                {renderInline(l, `${bi}-${li}`)}
                {li < b.lines.length - 1 ? '\n' : ''}
              </span>
            ))}
          </p>
        )
      })}
    </div>
  )
}
