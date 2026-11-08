'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Loader2, Upload } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { api, useApp } from '@/lib/client'
import { COLUMN_FIELDS, detectKind, guessMapping, jsonToTable, parseCsv, rowsToText, sheetCell, type ColumnField, type ImportKind, type Mapping } from '@/lib/import-formats'
import { familyWords, peopleWords } from '@/lib/names'
import { parseFamilyText, planFamilyText } from '@/lib/textformat'
import { MiniGraph, PlanSummary } from './text-dialog'
import { Select } from '@/components/ui/select'

const KIND_LABEL: Record<ImportKind, string> = { gedcom: 'GEDCOM', table: 'таблица CSV', xlsx: 'таблица Excel', json: 'JSON', text: 'текстовый формат' }

type Loaded =
  | { kind: 'gedcom'; name: string; text: string; preview: { version: string; persons: number; families: number; sample: string[]; existing: number; unread: { tag: string; count: number }[]; inArchive: number; matched: number; added: number; newLinks: number; knownLinks: number; pairs: { xref: string; file: string; fileYear: number | null; card: string; cardYear: number | null }[] } }
  | { kind: 'text'; name: string; text: string }
  | { kind: 'table' | 'xlsx' | 'json'; name: string; headers: string[]; rows: string[][] }

/** One way in for every format: pick or drop a file, see what will change, then decide. */
const TAG_WORDS: Record<string, string> = { OBJE: 'ссылки на файлы', ASSO: 'связи с другими людьми', ALIA: 'другие записи о человеке', SUBM: 'сведения об авторе' }

export function ImportDialog({ open, file, onOpenChange }: { open: boolean; file?: File | null; onOpenChange: (v: boolean) => void }) {
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

  const reset = () => { setLoaded(null); setMapping([]); setChoices({}); setError(''); setMode('merge') }
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
  useEffect(() => { if (open && file) void read(file) }, [open, file]) // eslint-disable-line react-hooks/exhaustive-deps

  const table = loaded && 'rows' in loaded ? loaded : null
  const named = mapping.includes('name') || mapping.includes('given') || mapping.includes('surname')
  const built = useMemo(() => (table && named ? rowsToText(table.rows, mapping, familyName) : null), [table, mapping, named, familyName])
  const text = loaded?.kind === 'text' ? loaded.text : built?.text ?? ''
  const plan = useMemo(() => (text ? planFamilyText(parseFamilyText(text), graph, choices) : null), [text, graph, choices])
  const ready = loaded?.kind === 'gedcom' ? true : !!plan && !plan.errors.length && !plan.ambiguous.length && plan.ops.length > 0

  const apply = async () => {
    setBusy(true)
    setError('')
    try {
      if (loaded?.kind === 'gedcom') await api(`gedcom/import?mode=${loaded.preview.inArchive ? mode : 'add'}`, { method: 'POST', body: loaded.text })
      else await api('text/import', { json: { text, resolutions: choices } })
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
        <input ref={input} type="file" hidden accept=".ged,.gedcom,.csv,.tsv,.xlsx,.json,.txt,.md,text/plain" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void read(f) }} />

        {reading && <p role="status" className="flex items-center gap-2 text-ink-soft py-6 justify-center"><Loader2 size={16} className="animate-spin" /> {t('Читаю файл…')}</p>}

        {!loaded && !reading && (
          <button
            className={`rounded-xl border-2 border-dashed px-6 py-12 flex flex-col items-center gap-2 transition-colors ${over ? 'border-ink bg-muted' : 'border-border hover:border-ink-faint'}`}
            onClick={() => input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true) }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); const f = e.dataTransfer.files[0]; if (f) void read(f) }}
          >
            <Upload size={22} className="text-ink-soft" />
            <span className="font-medium">{t('Перетащите файл сюда или выберите его')}</span>
            <span className="text-ink-soft">{t('Файл программы для родословных, таблица или текст')}</span>
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

        {loaded?.kind === 'gedcom' && <GedcomPlan preview={loaded.preview} mode={mode} onMode={setMode} />}

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
            <button className="bar-btn on disabled:opacity-40" disabled={!ready || busy} aria-busy={busy} onClick={apply}>{busy ? t('Обрабатываю…') : loaded?.kind === 'gedcom' && loaded.preview.inArchive && mode === 'replace' ? t('Заменить дерево') : loaded?.kind === 'gedcom' && loaded.preview.inArchive && mode === 'merge' ? t('Объединить') : t('Импортировать')}</button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

type Preview = Extract<Loaded, { kind: 'gedcom' }>['preview']

/** What loading the file does to a tree that is not empty, said before anything changes. */
function GedcomPlan({ preview: p, mode, onMode }: { preview: Preview; mode: 'add' | 'merge' | 'replace'; onMode: (m: 'add' | 'merge' | 'replace') => void }) {
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
      {p.unread.length > 0 && <p className="text-xs text-rust">⚠ {t('Не перенесётся')}: {p.unread.map((u) => `${TAG_WORDS[u.tag] ? t(TAG_WORDS[u.tag]) : u.tag} (${u.count})`).join(', ')}</p>}
    </div>
  )
}
