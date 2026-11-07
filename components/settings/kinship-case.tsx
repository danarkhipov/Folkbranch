'use client'
import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FolderOpen, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/ui/section'
import { api, useApp } from '@/lib/client'

interface Preview { people: number; already: number; parents: number; unions: number; candidates: number; openRelations: number; leftOut: number; living: number }
interface Files { persons: string; relationships?: string; claims?: string; artifacts?: string }

const NAMES: Record<string, keyof Files> = { 'person-register.csv': 'persons', 'relationship-register.csv': 'relationships', 'claims-register.csv': 'claims', 'artifact-register.csv': 'artifacts' }

/** A folder from the kinship research skill: what was proved goes on the chart, the rest stays a note on the card. */
export function KinshipCase() {
  const { t, notify } = useApp()
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<Files | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pick = async (list: FileList | null) => {
    setError('')
    setPreview(null)
    const read: Partial<Files> = {}
    for (const f of Array.from(list ?? [])) if (NAMES[f.name]) read[NAMES[f.name]] = await f.text()
    if (!read.persons) { setFiles(null); return setError(t('В этой папке нет файла person-register.csv. Выберите папку дела.')) }
    try {
      setPreview(await api<Preview>('case/preview', { json: read }))
      setFiles(read as Files)
    } catch (x) {
      setError(String((x as Error).message ?? x))
    }
  }
  const run = async () => {
    setBusy(true)
    try {
      await api('case/import', { json: files })
      await qc.invalidateQueries()
      notify(`${t('Дело добавлено')}: ${preview?.people ?? 0}`)
      setFiles(null)
      setPreview(null)
    } catch (x) {
      setError(String((x as Error).message ?? x))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section title={t('Добавить дело из исследования')} description={t('Папка, которую создал скилл ex-ussr-kinship-research. Кандидаты останутся отдельными карточками, а неподтверждённые связи не попадут на схему и останутся заметками.')}>
      {/* @ts-expect-error the browser's folder picker has no type in React */}
      <input ref={input} type="file" webkitdirectory="" multiple hidden aria-label={t('Выбрать папку дела')} onChange={(e) => pick(e.target.files)} />
      <Button variant="outline" className="self-start" onClick={() => input.current?.click()}><FolderOpen /> {t('Выбрать папку дела')}</Button>
      {preview && (
        <div role="status" className="flex flex-col gap-1 rounded-lg bg-muted p-3 text-xs leading-snug">
          <p>{t('Новых карточек')}: <b>{preview.people}</b>{preview.already ? `, ${t('уже в архиве')}: ${preview.already}` : ''}. {t('Из них живых или неизвестно')}: {preview.living}.</p>
          <p>{t('На схему попадут родителей и детей')}: {preview.parents}, {t('браков')}: {preview.unions}.</p>
          <p>{t('Кандидатов')}: {preview.candidates}. {t('Связей, оставшихся заметками')}: {preview.openRelations}. {t('Отклонённых в деле не добавляем')}: {preview.leftOut}.</p>
          <Button size="sm" className="mt-1 self-start" disabled={busy || !preview.people} onClick={run}><Upload /> {t('Добавить в архив')}</Button>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </Section>
  )
}
