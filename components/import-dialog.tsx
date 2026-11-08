'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Loader2, Upload } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { api, useApp } from '@/lib/client'
import { COLUMN_FIELDS, detectKind, guessMapping, jsonToTable, parseCsv, rowsToText, sheetCell, type ColumnField, type ImportKind, type Mapping } from '@/lib/import-formats'
import { familyWords, peopleWords } from '@/lib/names'
import { matchFiles, splitDropped, type FileLink, type FilePerson } from '@/lib/import-files'
import { parseFamilyText, planFamilyText } from '@/lib/textformat'
import { MiniGraph, PlanSummary } from './text-dialog'
import { Select } from '@/components/ui/select'

const KIND_LABEL: Record<ImportKind, string> = { gedcom: 'GEDCOM', table: 'таблица CSV', xlsx: 'таблица Excel', json: 'JSON', text: 'текстовый формат' }

type Loaded =
  | { kind: 'gedcom'; name: string; text: string; preview: { version: string; persons: number; families: number; sample: string[]; existing: number; unread: { tag: string; count: number }[]; inArchive: number; matched: number; added: number; newLinks: number; knownLinks: number; people: FilePerson[]; media: FileLink[]; pairs: { xref: string; file: string; fileYear: number | null; card: string; cardYear: number | null }[] } }
  | { kind: 'text'; name: string; text: string }
  | { kind: 'table' | 'xlsx' | 'json'; name: string; headers: string[]; rows: string[][] }

/** One way in for every format: pick or drop a file, see what will change, then decide. */
const TAG_WORDS: Record<string, string> = { OBJE: 'ссылки на файлы', ASSO: 'связи с другими людьми', ALIA: 'другие записи о человеке', SUBM: 'сведения об авторе' }

export function ImportDialog({ open, files, onOpenChange }: { open: boolean; files?: File[] | null; onOpenChange: (v: boolean) => void }) {
  const { t, graph, familyName, notify, undoLast } = useApp()
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [mapping, setMapping] = useState<Mapping>([])
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const [mode, setMode] = useState<'add' | 'merge' | 'replace'>('merge')
  const [reading, setReading] = useState(false)
  // Photos and other files that came with the tree, and who a person said each one is of.
  const [extra, setExtra] = useState<File[]>([])
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const [sending, setSending] = useState<{ done: number; total: number } | null>(null)
  const more = useRef<HTMLInputElement>(null)

  const reset = () => { setLoaded(null); setMapping([]); setChoices({}); setError(''); setMode('merge'); setExtra([]); setChosen({}) }
  useEffect(() => { if (open) reset() }, [open])

  const read = async (f: File) => {
    reset()
    setReading(true)
    try {
      const head = detectKind(f.name, '') === 'xlsx' ? '' : await f.slice(0, 4000).text()
      const kind = detectKind(f.name, head)
      if (kind === 'xlsx') {
        const { readSheet } = await import('read-excel-file/browser')
        const sheet = (await readSheet(f)).map((r) => r.map(sheetCell)).filter((r) => r.some(Boolean))
        if (sheet.length < 2) throw new Error(t('В таблице нет строк с людьми'))
        setMapping(guessMapping(sheet[0]))
        return setLoaded({ kind, name: f.name, headers: sheet[0], rows: sheet.slice(1) })
      }
      const text = await f.text()
      if (kind === 'gedcom') return setLoaded({ kind, name: f.name, text, preview: await api('gedcom/preview', { method: 'POST', body: text }) })
      if (kind === 'text') return setLoaded({ kind, name: f.name, text })
      const table = kind === 'json' ? jsonToTable(text) : (() => { const rows = parseCsv(text); return rows.length > 1 ? { headers: rows[0], rows: rows.slice(1) } : null })()
      if (!table) throw new Error(t(kind === 'json' ? 'В этом JSON не нашлось списка людей' : 'В таблице нет строк с людьми'))
      setMapping(guessMapping(table.headers))
      setLoaded({ kind, name: f.name, ...table })
    } catch (e) {
      setError(`${t('Не удалось прочитать файл')}: ${(e as Error).message}`)
    } finally {
      setReading(false)
    }
  }
  /** Every file dropped or picked: the tree is read, the rest wait to be matched to people. */
  const take = (list: File[]) => {
    const { tree, rest } = splitDropped(list)
    if (tree) { void read(tree); setExtra(rest); return }
    if (loaded?.kind === 'gedcom') setExtra((e) => [...e, ...list])
    else setError(t('Нет файла с деревом: добавьте GEDCOM, таблицу или текст'))
  }
  useEffect(() => { if (open && files?.length) take(files) }, [open, files]) // eslint-disable-line react-hooks/exhaustive-deps

  const tree = loaded?.kind === 'gedcom' ? loaded.preview : null
  const key = (f: File) => `${f.name}:${f.size}`
  const matches = useMemo(() => (tree ? matchFiles(extra.map((f) => ({ name: f.name, path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || undefined })), tree.people, tree.media) : []), [extra, tree])
  /** Who each file goes to: the match, or what a person chose. */
  const owners = (i: number) => (chosen[key(extra[i])] === 'skip' ? [] : chosen[key(extra[i])] ? [chosen[key(extra[i])]] : matches[i]?.xrefs ?? [])
  const attached = extra.filter((_, i) => owners(i).length).length

  const table = loaded && 'rows' in loaded ? loaded : null
  const named = mapping.includes('name') || mapping.includes('given') || mapping.includes('surname')
  const built = useMemo(() => (table && named ? rowsToText(table.rows, mapping, familyName) : null), [table, mapping, named, familyName])
  const text = loaded?.kind === 'text' ? loaded.text : built?.text ?? ''
  const plan = useMemo(() => (text ? planFamilyText(parseFamilyText(text), graph, choices) : null), [text, graph, choices])
  const ready = loaded?.kind === 'gedcom' ? true : !!plan && !plan.errors.length && !plan.ambiguous.length && plan.ops.length > 0

  /** Files go up after the tree, three at a time, each to the people it belongs to. Returns the names that failed. */
  const sendFiles = async (ids: Record<string, string>) => {
    const jobs = extra.flatMap((f, i) => { const who = owners(i).map((x) => ids[x]).filter(Boolean); return who.length ? [{ f, who }] : [] })
    if (!jobs.length) return []
    const failed: string[] = []
    let done = 0
    setSending({ done, total: jobs.length })
    let next = 0
    const worker = async () => {
      while (next < jobs.length) {
        const { f, who } = jobs[next++]
        try {
          const form = new FormData()
          form.set('file', f)
          form.set('personId', who[0])
          const m = await api<{ id: string }>('media', { body: form })
          for (const other of who.slice(1)) await api(`media/${m.id}/tags`, { json: { personId: other } })
        } catch { failed.push(f.name) }
        setSending({ done: ++done, total: jobs.length })
      }
    }
    await Promise.all([worker(), worker(), worker()])
    setSending(null)
    return failed
  }

  const apply = async () => {
    setBusy(true)
    setError('')
    try {
      let ids: Record<string, string> = {}
      if (loaded?.kind === 'gedcom') ids = (await api<{ ids?: Record<string, string> }>(`gedcom/import?mode=${loaded.preview.inArchive ? mode : 'add'}`, { method: 'POST', body: loaded.text })).ids ?? {}
      else await api('text/import', { json: { text, resolutions: choices } })
      const failed = await sendFiles(ids)
      if (failed.length) {
        await qc.invalidateQueries()
        setError(`${t('Дерево загружено, но не удалось загрузить файлы')}: ${failed.slice(0, 5).join(', ')}${failed.length > 5 ? ` (+${failed.length - 5})` : ''}`)
        return
      }
      await qc.invalidateQueries()
      onOpenChange(false)
      notify(t('Импорт завершён'), [{ label: t('Отменить'), run: () => void undoLast() }])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(1000px,calc(100vw-32px))] sm:max-w-[min(1000px,calc(100vw-32px))] max-h-[calc(100vh-64px)] overflow-auto flex flex-col gap-3 text-sm">
        <DialogTitle className="font-serif font-medium text-lg">{t('Добавить людей из файла')}</DialogTitle>
        <input ref={input} type="file" multiple hidden onChange={(e) => { const list = [...(e.target.files ?? [])]; e.target.value = ''; if (list.length) take(list) }} />
        <input ref={more} type="file" multiple hidden onChange={(e) => { const list = [...(e.target.files ?? [])]; e.target.value = ''; if (list.length) setExtra((x) => [...x, ...list]) }} />

        {reading && <p role="status" className="flex items-center gap-2 text-ink-soft py-6 justify-center"><Loader2 size={16} className="animate-spin" /> {t('Читаю файл…')}</p>}

        {!loaded && !reading && (
          <button
            className={`rounded-xl border-2 border-dashed px-6 py-12 flex flex-col items-center gap-2 transition-colors ${over ? 'border-ink bg-muted' : 'border-border hover:border-ink-faint'}`}
            onClick={() => input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true) }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); const list = [...e.dataTransfer.files]; if (list.length) take(list) }}
          >
            <Upload size={22} className="text-ink-soft" />
            <span className="font-medium">{t('Перетащите файлы сюда или выберите их')}</span>
            <span className="text-ink-soft">{t('Файл дерева (GEDCOM, таблица, текст) и, если есть, фотографии и документы к нему')}</span>
          </button>
        )}

        {loaded && (
          <p className="flex flex-wrap items-center gap-2">
            <b className="font-medium truncate max-w-[60%]">{loaded.name}</b>
            <span className="rounded-full bg-muted px-2 text-xs text-ink-soft">{t(KIND_LABEL[loaded.kind])}</span>
            <button className="pick text-xs text-ink-soft underline hover:text-ink" onClick={reset}>{t('Другой файл')}</button>
          </p>
        )}

        {table && (
          <section className="flex flex-col gap-1.5">
            <h4 className="text-xs text-ink-soft">{t('Что лежит в столбцах')} · {t('строк')}: {table.rows.length}</h4>
            <div className="overflow-auto rounded-lg border border-border max-h-64">
              <table className="text-xs border-collapse w-full">
                <thead className="sticky top-0 bg-muted">
                  <tr>{table.headers.map((h, i) => (
                    <th key={i} className="p-1.5 text-left font-normal whitespace-nowrap align-top">
                      <div className="text-ink-soft mb-1">{h || '—'}</div>
                      <Select look="small" aria-label={h} value={mapping[i] ?? ''} onChange={(v) => setMapping(mapping.map((m, j) => (j === i ? (v as ColumnField) : m === v ? '' : m)))} options={COLUMN_FIELDS.map(([f, label]) => ({ value: f, label: t(label) }))} />
                    </th>
                  ))}</tr>
                </thead>
                <tbody>{table.rows.slice(0, 4).map((r, i) => <tr key={i} className="border-t border-border">{table.headers.map((_, j) => <td key={j} className={`p-1.5 whitespace-nowrap max-w-48 truncate ${mapping[j] ? '' : 'text-ink-faint'}`}>{r[j]}</td>)}</tr>)}</tbody>
              </table>
            </div>
            {!named && <p className="text-xs text-destructive">{t('Укажите, в каком столбце имя')}</p>}
            {built?.warnings.map((w) => <p key={w.key} className="text-xs text-rust">⚠ {t(w.key)}: {w.detail}</p>)}
          </section>
        )}

        {loaded?.kind === 'gedcom' && <GedcomPlan preview={loaded.preview} mode={mode} onMode={setMode} withFiles={attached > 0} />}

        {loaded?.kind === 'gedcom' && (
          <section className="flex flex-col gap-1.5" data-testid="files-with-tree">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-xs text-ink-soft">{t('Фотографии и файлы к людям')}{extra.length ? ` · ${t('привяжутся')}: ${attached} ${t('из')} ${extra.length}` : ''}</h4>
              <button className="pick text-xs text-ink-soft underline hover:text-ink" onClick={() => more.current?.click()}>{t('Добавить файлы')}</button>
            </div>
            {!extra.length && <p className="text-xs text-ink-faint">{loaded.preview.media.length ? `${t('В дереве указано ссылок на файлы')}: ${loaded.preview.media.length}. ` : ''}{t('Файл подойдёт к человеку, если он указан в дереве, если в имени файла есть номер человека из дерева (P012) или его имя и фамилия. Остальных можно выбрать вручную.')}</p>}
            {extra.length > 0 && (
              <ul className="max-h-48 overflow-auto rounded-md border border-border bg-paper text-xs divide-y divide-border">
                {extra.map((f, i) => {
                  const who = owners(i)
                  const name = (x: string) => tree?.people.find((p) => p.xref === x)?.name ?? x
                  return (
                    <li key={key(f) + i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 px-2 py-1">
                      <span className="truncate" title={f.name}>{f.name}</span>
                      {who.length ? <span className="truncate text-ink-soft">→ {who.map(name).join(', ')}</span> : (
                        <Select look="small" aria-label={f.name} value={chosen[key(f)] ?? ''} onChange={(v) => setChosen({ ...chosen, [key(f)]: v })} options={[{ value: '', label: t('Выбрать человека…') }, ...(tree?.people ?? []).map((p) => ({ value: p.xref, label: `${p.name}${p.year ? ` · ${p.year}` : ''}` }))]} />
                      )}
                      <button className="text-ink-faint hover:text-ink" aria-label={t('Убрать')} title={t('Убрать')} onClick={() => setExtra(extra.filter((_, j) => j !== i))}>×</button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )}

        {plan && text && (
          <div className="grid md:grid-cols-2 gap-3">
            <div className="h-56 rounded-lg bg-paper border border-border overflow-hidden"><MiniGraph text={text} /></div>
            <div className="flex flex-col gap-1 max-h-56 overflow-auto"><PlanSummary plan={plan} choices={choices} onChoose={setChoices} /></div>
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
        {loaded && (
          <div className="flex items-center justify-end gap-2">
            <span className="mr-auto text-xs text-ink-faint">{t('Импорт можно отменить одним действием')}</span>
            <button className="bar-btn" onClick={() => onOpenChange(false)}>{t('Отмена')}</button>
            <button className="bar-btn on disabled:opacity-40" disabled={!ready || busy} aria-busy={busy} onClick={apply}>{busy ? (sending ? `${t('Загружаю файлы')} ${sending.done} ${t('из')} ${sending.total}` : t('Обрабатываю…')) : loaded?.kind === 'gedcom' && loaded.preview.inArchive && mode === 'replace' ? t('Заменить дерево') : loaded?.kind === 'gedcom' && loaded.preview.inArchive && mode === 'merge' ? t('Объединить') : t('Импортировать')}</button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

type Preview = Extract<Loaded, { kind: 'gedcom' }>['preview']

/** What loading the file does to a tree that is not empty, said before anything changes. */
function GedcomPlan({ preview: p, mode, onMode, withFiles }: { preview: Preview; mode: 'add' | 'merge' | 'replace'; onMode: (m: 'add' | 'merge' | 'replace') => void; withFiles: boolean }) {
  const { t, lang, me } = useApp()
  const empty = p.inArchive === 0
  type M = 'add' | 'merge' | 'replace'
  const modes: [M, string, string][] = [
    ['merge', 'Объединить', 'Те, кто уже есть, не повторятся: карточки сольются, недостающее дополнится.'],
    ['add', 'Добавить как новых', 'Всё из файла станет отдельными карточками, возможны повторы.'],
  ]
  if (me.role === 'owner') modes.push(['replace', 'Заменить всё', 'Нынешнее дерево удалится, останется то, что в файле.'])
  return (
    <div className="rounded-lg bg-muted p-3 flex flex-col gap-2">
      <p>{t('В файле')}: <b>{peopleWords(p.persons, lang)}</b>, <b>{familyWords(p.families, lang)}</b> <span className="text-ink-faint">(GEDCOM {p.version})</span>
        {!empty && <> · {t('В архиве сейчас')}: <b>{peopleWords(p.inArchive, lang)}</b></>}</p>
      <p className="text-xs text-ink-soft truncate">{p.sample.join(', ')}</p>
      {!empty && (
        <>
          <div role="radiogroup" aria-label={t('Что сделать с деревом')} className="grid sm:grid-cols-3 gap-2">
            {modes.map(([id, title, hint]) => (
              <button key={id} role="radio" aria-checked={mode === id} onClick={() => onMode(id)} className={`text-left rounded-lg border p-2 transition-colors ${mode === id ? 'border-ink bg-paper' : 'border-border hover:border-ink-faint'} ${id === 'replace' ? 'text-destructive' : ''}`}>
                <b className="font-medium block">{t(title)}</b>
                <span className="text-xs text-ink-soft block">{t(hint)}</span>
              </button>
            ))}
          </div>
          {mode === 'merge' && (
            <div className="flex flex-col gap-2" data-testid="merge-scheme">
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <span className="rounded-md bg-paper border border-border p-1.5"><b className="block text-base">{p.matched}</b>{t('сольются с имеющимися')}</span>
                <span className="rounded-md bg-paper border border-border p-1.5"><b className="block text-base">{p.added}</b>{t('добавятся новыми')}</span>
                <span className="rounded-md bg-paper border border-border p-1.5"><b className="block text-base">{p.newLinks}</b>{t('новых связей')}</span>
              </div>
              {p.pairs.length > 0 && (
                <ul className="max-h-40 overflow-auto rounded-md border border-border bg-paper text-xs divide-y divide-border">
                  {p.pairs.map((x) => (
                    <li key={x.xref} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-2 py-1">
                      <span className="truncate">{x.file}{x.fileYear ? ` · ${x.fileYear}` : ''} <span className="text-ink-faint">{t('в файле')}</span></span>
                      <ArrowRight size={12} className="text-ink-faint" />
                      <span className="truncate">{x.card}{x.cardYear ? ` · ${x.cardYear}` : ''} <span className="text-ink-faint">{t('в архиве')}</span></span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-ink-soft">{t('Совпадение ищется по имени, фамилии, полу и году рождения. Неоднозначных не трогаем: они добавятся новыми.')}</p>
            </div>
          )}
          {mode === 'replace' && <p className="text-xs text-destructive">{t('Все нынешние карточки, связи и тексты о людях удалятся. Фотографии останутся, но без отметок. Аккаунты отвяжутся от карточек. Отменить можно сразу после.')}</p>}
        </>
      )}
      {p.unread.filter((u) => !(withFiles && u.tag === 'OBJE')).length > 0 && <p className="text-xs text-rust">⚠ {t('Не перенесётся')}: {p.unread.filter((u) => !(withFiles && u.tag === 'OBJE')).map((u) => `${TAG_WORDS[u.tag] ? t(TAG_WORDS[u.tag]) : u.tag} (${u.count})`).join(', ')}</p>}
    </div>
  )
}
