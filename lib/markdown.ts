// Pages are stored as BlockNote JSON, but a model works far better with Markdown.
// This covers what the editor offers for text; other blocks are kept out of the Markdown view.
type Inline = Record<string, any>
type Block = Record<string, any>

const STYLE: [string, string][] = [['bold', '**'], ['italic', '*'], ['code', '`']]

function inlineToMd(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return (content as Inline[]).map((c) => {
    if (c.type === 'mention') return `[@${c.props?.label ?? ''}](person:${c.props?.personId ?? ''})`
    if (c.type === 'link') return `[${inlineToMd(c.content)}](${c.href})`
    let t = c.text ?? ''
    for (const [k, mark] of STYLE) if (c.styles?.[k]) t = `${mark}${t}${mark}`
    return t
  }).join('')
}

export function blocksToMarkdown(blocks: Block[], indent = ''): string {
  const out: string[] = []
  let n = 0
  for (const b of blocks) {
    n = b.type === 'numberedListItem' ? n + 1 : 0
    const text = inlineToMd(b.content)
    if (b.type === 'heading') out.push(`${indent}${'#'.repeat(b.props?.level ?? 1)} ${text}`)
    else if (b.type === 'bulletListItem') out.push(`${indent}- ${text}`)
    else if (b.type === 'checkListItem') out.push(`${indent}- [${b.props?.checked ? 'x' : ' '}] ${text}`)
    else if (b.type === 'numberedListItem') out.push(`${indent}${n}. ${text}`)
    else if (b.type === 'quote') out.push(`${indent}> ${text}`)
    else if (b.type === 'divider') out.push(`${indent}---`)
    else if (b.type === 'image') out.push(`${indent}![${b.props?.caption ?? ''}](${b.props?.url ?? ''})`)
    else if (b.type === 'paragraph') out.push(`${indent}${text}`)
    else out.push(`${indent}<!-- ${b.type} -->`)
    if (b.children?.length) out.push(blocksToMarkdown(b.children, `${indent}  `))
  }
  return out.join('\n')
}

const INLINE = /\[@([^\]]*)\]\(person:([^)\s]*)\)|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g

function mdToInline(s: string): Inline[] {
  const out: Inline[] = []
  const text = (t: string, styles: Record<string, boolean> = {}) => t && out.push({ type: 'text', text: t, styles })
  let last = 0
  for (const m of s.matchAll(INLINE)) {
    text(s.slice(last, m.index))
    last = m.index + m[0].length
    if (m[2] !== undefined) out.push({ type: 'mention', props: { personId: m[2], label: m[1] } })
    else if (m[4] !== undefined) out.push({ type: 'link', href: m[4], content: [{ type: 'text', text: m[3], styles: {} }] })
    else if (m[5] !== undefined) text(m[5], { bold: true })
    else if (m[6] !== undefined) text(m[6], { italic: true })
    else text(m[7], { code: true })
  }
  text(s.slice(last))
  return out
}

export function markdownToBlocks(md: string): Block[] {
  const blocks: Block[] = []
  for (const raw of md.replace(/\r/g, '').split('\n')) {
    const line = raw.trim()
    let m: RegExpMatchArray | null
    if (!line) continue
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) blocks.push({ type: 'heading', props: { level: m[1].length }, content: mdToInline(m[2]) })
    else if (/^(---+|\*\*\*+)$/.test(line)) blocks.push({ type: 'divider' })
    else if ((m = line.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/))) blocks.push({ type: 'image', props: { url: m[2], caption: m[1] } })
    else if ((m = line.match(/^>\s?(.*)$/))) blocks.push({ type: 'quote', content: mdToInline(m[1]) })
    else if ((m = line.match(/^[-*]\s+\[([ x])\]\s+(.*)$/))) blocks.push({ type: 'checkListItem', props: { checked: m[1] === 'x' }, content: mdToInline(m[2]) })
    else if ((m = line.match(/^[-*]\s+(.*)$/))) blocks.push({ type: 'bulletListItem', content: mdToInline(m[1]) })
    else if ((m = line.match(/^\d+\.\s+(.*)$/))) blocks.push({ type: 'numberedListItem', content: mdToInline(m[1]) })
    else blocks.push({ type: 'paragraph', content: mdToInline(line) })
  }
  return blocks
}
