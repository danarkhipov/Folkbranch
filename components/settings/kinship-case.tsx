'use client'
import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FolderOpen, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/ui/section'
import { api, useApp } from '@/lib/client'

interface Preview { people: number; already: number; updated: number; parents: number; unions: number; proved: number; candidates: number; openRelations: number; leftOut: number; living: number; disputed: number; broken: number; trimmed: number }
interface Files { caseId: string; persons: string; relationships?: string; claims?: string; artifacts?: string }

const NAMES: Record<string, keyof Files> = { 'person-register.csv': 'persons', 'relationship-register.csv': 'relationships', 'claims-register.csv': 'claims', 'artifact-register.csv': 'artifacts' }
const depth = (f: File) => f.webkitRelativePath.split('/').length

/** A folder from the kinship research skill: what was proved goes on the chart, the rest stays a note on the card. */
export function KinshipCase() {
  const { t, notify, undoLast } = useApp()
  const qc = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<Files | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pick = async (list: File[]) => {
    setError('')
    setPreview(null)
    setFiles(null)
    // The case's own registers, not a copy in a subfolder.
    const near = [...list].sort((a, b) => depth(a) - depth(b))
    const read: Partial<Files> = {}
    for (const f of near) {
      const key = NAMES[f.name]
      if (key && !read[key]) read[key] = await f.text()
    }
    if (!read.persons) return setError(t('В этой папке нет файла person-register.csv. Выберите папку дела.'))
    const intake = near.find((f) => f.name === 'case-intake.yaml')
    const named = intake && /^case_id:\s*["']?([^"'\n#]*)/m.exec(await intake.text())?.[1].trim()
    read.caseId = named || near[0].webkitRelativePath.split('/')[0] || near[0].name
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
      notify(t('Дело добавлено'), [{ label: t('Отменить'), run: () => void undoLast() }])
      setFiles(null)
      setPreview(null)
    } catch (x) {
      setError(String((x as Error).message ?? x))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section title={t('Добавить дело из исследования')} description={t('Папка с результатами исследования родословной, подготовленная ex-ussr-kinship-research. Возможные родственники останутся отдельными карточками, а неподтверждённые связи не попадут на схему и останутся заметками.')}>
      {/* @ts-expect-error the browser's folder picker has no type in React */}
      <input ref={input} type="file" webkitdirectory="" multiple hidden aria-label={t('Выбрать папку дела')} onChange={(e) => { const list = Array.from(e.target.files ?? []); e.target.value = ''; void pick(list) }} />
      <Button variant="outline" className="self-start" onClick={() => input.current?.click()}><FolderOpen /> {t('Выбрать папку дела')}</Button>
      {preview && (
        <div role="status" className="flex flex-col gap-1 rounded-lg bg-muted p-3 text-xs leading-snug">
          <p>{t('Новых карточек')}: <b>{preview.people}</b>. {t('Из них живых или неизвестно')}: {preview.living}. {t('Кандидатов')}: {preview.candidates}.</p>
          {preview.already > 0 && <p>{t('Уже в архиве')}: {preview.already}. {t('Дополнятся новыми сведениями')}: {preview.updated}. {t('Написанное вами не заменится')}.</p>}
          <p>{t('На схему попадут родителей и детей')}: {preview.parents}, {t('пар')}: {preview.unions}.{preview.proved > 0 ? ` ${t('Связей станут подтверждёнными')}: ${preview.proved}.` : ''}</p>
          <p>{t('Связей, оставшихся заметками')}: {preview.openRelations}. {t('Отклонённых в деле не добавляем')}: {preview.leftOut}.</p>
          {preview.disputed > 0 && <p className="text-rust">⚠ {t('Дело опровергает связи, которые уже на схеме. Они останутся, проверьте их сами')}: {preview.disputed}</p>}
          {preview.broken > 0 && <p className="text-rust">⚠ {t('Связи с людьми, которых нет в списке дела, не перенесутся')}: {preview.broken}</p>}
          {preview.trimmed > 0 && <p className="text-rust">⚠ {t('Карточки, которые не поместились целиком, сокращены')}: {preview.trimmed}</p>}
          <Button size="sm" className="mt-1 self-start" disabled={busy || !(preview.people || preview.updated || preview.parents || preview.unions || preview.proved)} onClick={run}><Upload /> {t('Добавить в архив')}</Button>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </Section>
  )
}
