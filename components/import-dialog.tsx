'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { api, useApp } from '@/lib/client'
import { COLUMN_FIELDS, detectKind, guessMapping, jsonToTable, parseCsv, rowsToText, sheetCell, type ColumnField, type ImportKind, type Mapping } from '@/lib/import-formats'
import { familyWords, peopleWords } from '@/lib/names'
import { parseFamilyText, planFamilyText } from '@/lib/textformat'
import { MiniGraph, PlanSummary } from './ai-panels'

const KIND_LABEL: Record<ImportKind, string> = { gedcom: 'GEDCOM', table: 'таблица CSV', xlsx: 'таблица Excel', json: 'JSON', text: 'текстовый формат' }

type Loaded =
  | { kind: 'gedcom'; name: string; text: string; preview: { version: string; persons: number; families: number; sample: string[]; existing: number } }
  | { kind: 'text'; name: string; text: string }
  | { kind: 'table' | 'xlsx' | 'json'; name: string; headers: string[]; rows: string[][] }

/** One way in for every format: pick or drop a file, see what will change, then decide. */
export function ImportDialog({ open, file, onOpenChange }: { open: boolean; file?: File | null; onOpenChange: (v: boolean) => void }) {
  const { t, graph, familyName, lang, notify, undoLast } = useApp()
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [mapping, setMapping] = useState<Mapping>([])
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)

  const reset = () => { setLoaded(null); setMapping([]); setChoices({}); setError('') }
  useEffect(() => { if (open) reset() }, [open])

  const read = async (f: File) => {
    reset()
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
      if (loaded?.kind === 'gedcom') await api('gedcom/import', { method: 'POST', body: loaded.text })
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
      <DialogContent className="max-w-[min(1000px,calc(100vw-32px))] sm:max-w-[min(1000px,calc(100vw-32px))] max-h-[calc(100vh-64px)] overflow-auto flex flex-col gap-3 text-[13px]">
        <DialogTitle className="font-serif font-medium text-lg">{t('Импорт')}</DialogTitle>
        <input ref={input} type="file" hidden accept=".ged,.gedcom,.csv,.tsv,.xlsx,.json,.txt,.md,text/plain" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void read(f) }} />

        {!loaded && (
          <button
            className={`rounded-xl border-2 border-dashed px-6 py-12 flex flex-col items-center gap-2 transition-colors ${over ? 'border-ink bg-muted' : 'border-border hover:border-ink-faint'}`}
            onClick={() => input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true) }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); const f = e.dataTransfer.files[0]; if (f) void read(f) }}
          >
            <Upload size={22} className="text-ink-soft" />
            <span className="font-medium">{t('Перетащите файл сюда или выберите его')}</span>
            <span className="text-ink-soft">GEDCOM, Excel, CSV, JSON, {t('текст')}</span>
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
                      <select aria-label={h} value={mapping[i] ?? ''} onChange={(e) => setMapping(mapping.map((m, j) => (j === i ? (e.target.value as ColumnField) : m === e.target.value ? '' : m)))} className="w-full rounded border border-input bg-white px-1 py-0.5">
                        {COLUMN_FIELDS.map(([f, label]) => <option key={f} value={f}>{t(label)}</option>)}
                      </select>
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

        {loaded?.kind === 'gedcom' && (
          <div className="rounded-lg bg-muted p-3 flex flex-col gap-1">
            <p>{t('Будет добавлено')}: <b>{peopleWords(loaded.preview.persons, lang)}</b>, <b>{familyWords(loaded.preview.families, lang)}</b> <span className="text-ink-faint">(GEDCOM {loaded.preview.version})</span></p>
            <p className="text-xs text-ink-soft truncate">{loaded.preview.sample.join(', ')}</p>
            {loaded.preview.existing > 0 && <p className="text-xs text-rust">⚠ {t('Совпадают по имени с уже имеющимися, GEDCOM добавит их как новых')}: {loaded.preview.existing}</p>}
          </div>
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
            <button className="bar-btn on disabled:opacity-40" disabled={!ready || busy} onClick={apply}>{t('Импортировать')}</button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
