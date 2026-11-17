'use client'
import { useMemo, useState } from 'react'
import { Download, Share2 } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useApp } from '@/lib/client'
import { CARD_H, layoutFamily } from '@/lib/graph/layout'
import { PAPERS, planOneSheet, planSheets, readability, type Paper } from '@/lib/graph/print-plan'
import { lifeYears, personName, type Graph, type Person } from '@/lib/types'
import type { Family } from '@/lib/kinship'
import { peopleInScope, subgraph, type Scope } from '@/lib/graph/select'
import { imagePixels } from '@/lib/chart-image'
import { Select } from '@/components/ui/select'

const SIZES = [7, 8, 9, 10, 12]
const hide = (p: Person): Person => ({ ...p, givenName: '', surname: '', maidenName: '', patronymic: '', birthDate: '', birthYear: null, birthPlace: '', sex: 'U', avatarMediaId: null, avatarCrop: null, hidden: true })

/** What is on the chart now, on paper: the reader sees the real size of the text before anything is printed. */
type Part = 'shown' | 'all' | Exclude<Scope, 'all'>

export function PrintDialog({ graph: shown, whole, family, focusId, onClose }: { graph: Graph; whole: Graph; family: Family; focusId: string | null; onClose: () => void }) {
  const { t, familyName, rootsBelow, canEdit, notify, lang } = useApp()
  const [mode, setMode] = useState<'one' | 'sheets' | 'image'>('one')
  const [paper, setPaper] = useState<Paper>('A3')
  const [sheet, setSheet] = useState<Paper>('A4')
  const [namePt, setNamePt] = useState(8)
  const [hideLiving, setHideLiving] = useState(true)
  const [busy, setBusy] = useState<number | null>(null)
  // Which part of the family: what the chart shows now, all of it, or one person's branch.
  const [part, setPart] = useState<Part>('shown')
  const [rootId, setRootId] = useState(() => focusId ?? whole.persons[0]?.id ?? '')
  const people = useMemo(() => [...whole.persons].filter((p) => !p.hidden).sort((a, b) => personName(a).localeCompare(personName(b))), [whole])
  const graph = useMemo(() => {
    if (part === 'shown') return shown
    if (part === 'all' || !rootId) return whole
    const keep = peopleInScope(family, part, rootId)
    return subgraph(whole, (id) => keep.has(id))
  }, [part, rootId, shown, whole, family])
  const root = whole.persons.find((p) => p.id === rootId)
  // A living person hidden on the cards is not named in the title, the caption or the file name either.
  const rootShown = root && !(hideLiving && (root.living || root.keepPrivate)) ? personName(root) : t('Живой родственник')
  const partName = part === 'shown' || part === 'all' || !root ? '' : `${t(({ ancestors: 'Предки', descendants: 'Потомки', near: 'Ближайшая семья' } as const)[part])}: ${rootShown}`

  const persons = useMemo(() => new Map(graph.persons.map((p) => (hideLiving && (p.living || p.keepPrivate) ? hide(p) : p)).map((p) => [p.id, p])), [graph, hideLiving])
  const printed = useMemo(() => ({ ...graph, persons: [...persons.values()] }), [graph, persons])
  const layout = useMemo(() => layoutFamily(printed, { rootsBelow, print: true }), [printed, rootsBelow])
  const plan = useMemo(() => (mode !== 'sheets' ? planOneSheet(layout, paper) : planSheets(layout, persons, sheet, namePt)), [mode, layout, persons, paper, sheet, namePt])
  const quality = readability(plan.namePt)
  const { x, y, w, h } = layout.bounds

  const save = async () => {
    setBusy(0)
    try {
      const { chartToPdf } = await import('@/lib/print-chart')
      const bytes = await chartToPdf({
        layout, persons: printed.persons, plan, title: partName ? `${familyName}. ${partName}` : familyName, hiddenLabel: t('Живой родственник'),
        sheetLabel: (n, of, row, col) => `${familyName}. ${t('Лист')} ${n} ${t('из')} ${of}, ${t('ряд')} ${row}, ${t('место')} ${col}`,
        onProgress: (done, total) => setBusy(Math.round((done / Math.max(1, total)) * 100)),
      })
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${familyName}-${mode === 'one' ? paper : `${sheet}-${plan.sheets.length}`}.pdf`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch (e) {
      notify(`${t('Не удалось подготовить файл')}: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }
  // The picture's size in pixels, as the browser will make it.
  const pixels = imagePixels(w, h)
  const zoom = pixels.scale
  // A phone can hand the picture straight to a messenger; elsewhere it is downloaded.
  const canShare = typeof navigator !== 'undefined' && !!navigator.canShare?.({ files: [new File([''], 'x.png', { type: 'image/png' })] })
  const picture = async (share: boolean) => {
    setBusy(0)
    try {
      const { chartToPng } = await import('@/lib/chart-image')
      const blob = await chartToPng({
        layout, persons: printed.persons, title: familyName, hiddenLabel: t('Живой родственник'), madeWith: t('Сделано в Folkbranch'),
        subtitle: [partName || t('Семейное древо'), `${printed.persons.length} ${t('чел.')}`, new Date().toLocaleDateString(lang)].join(' · '),
        onProgress: (done, total) => setBusy(Math.round((done / Math.max(1, total)) * 100)),
      })
      const file = new File([blob], `${partName ? `${familyName} - ${partName}` : familyName}.png`.replace(/[\\/:*?"<>|]/g, ''), { type: 'image/png' })
      if (share) {
        await navigator.share({ files: [file], title: familyName }).catch((e: Error) => { if (e.name !== 'AbortError') throw e })
        return
      }
      const url = URL.createObjectURL(file)
      const a = document.createElement('a')
      a.href = url
      a.download = file.name
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch (e) {
      notify((e as Error).message === 'too-large' ? t('Схема слишком большая для одной картинки. Возьмите одну ветвь в «Что взять» или сохраните PDF.') : `${t('Не удалось подготовить картинку')}: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }
  const label = 'flex flex-col gap-1 text-xs text-ink-soft'
  return (
    <Dialog open onOpenChange={(o) => !o && busy === null && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogTitle className="font-serif font-medium text-lg">{t('Печать и картинка')}</DialogTitle>
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <label className="flex flex-col gap-1 text-xs text-ink-soft">{t('Что взять')}
            <Select aria-label={t('Что взять')} value={part} onChange={(v) => setPart(v as Part)} options={[
              { value: 'shown', label: t('Как сейчас на схеме') }, { value: 'all', label: t('Вся семья') },
              { value: 'ancestors', label: t('Предки человека') }, { value: 'descendants', label: t('Потомки человека') }, { value: 'near', label: t('Ближайшая семья человека') },
            ]} />
          </label>
          {part !== 'shown' && part !== 'all' && (
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-ink-soft">{t('Чья ветвь')}
              <Select aria-label={t('Чья ветвь')} value={rootId} onChange={setRootId} options={people.map((p) => ({ value: p.id, label: [personName(p) || t('Без названия'), lifeYears(p)].filter(Boolean).join(', ') }))} />
            </label>
          )}
          <span className="pb-2 text-ink-soft">{printed.persons.length} {t('чел.')}</span>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-4 max-sm:grid-cols-1">
          <svg viewBox={`${x - 10} ${y - 10} ${w + 20} ${h + 20}`} role="img" aria-label={t('Как схема ляжет на бумагу')} className="w-full max-h-[50vh] rounded-lg border border-border bg-white">
            {layout.edges.map((e) => <path key={e.id} d={e.path} fill="none" stroke="#948b7a" strokeWidth={Math.max(1, w / 500)} />)}
            {layout.unions.map((u) => <path key={u.id} d={u.path} fill="none" stroke="#948b7a" strokeWidth={Math.max(1, w / 500)} />)}
            {[...layout.cards.values()].map((c) => <rect key={c.id} x={c.x - 40} y={c.y} width={80} height={CARD_H - 30} rx={8} fill="#e7dfcd" />)}
            {mode === 'sheets' && plan.sheets.map((s) => <rect key={`${s.row}.${s.col}`} x={s.x0} y={s.y0} width={s.x1 - s.x0} height={s.y1 - s.y0} fill="none" stroke="#a4502e" strokeDasharray={`${w / 100} ${w / 150}`} strokeWidth={Math.max(1, w / 400)} />)}
          </svg>
          <div className="flex flex-col gap-3 text-sm">
            <div role="radiogroup" aria-label={t('Как сохранить')} className="flex flex-col gap-1">
              <label className="flex items-center gap-2"><input type="radio" name="print-mode" checked={mode === 'one'} onChange={() => setMode('one')} /> {t('На одном листе')}</label>
              <label className="flex items-center gap-2"><input type="radio" name="print-mode" checked={mode === 'sheets'} onChange={() => setMode('sheets')} /> {t('Склеить из листов')}</label>
              <label className="flex items-center gap-2"><input type="radio" name="print-mode" checked={mode === 'image'} onChange={() => setMode('image')} /> {t('Картинка, чтобы отправить')}</label>
            </div>
            {mode === 'image' ? (
              <p className="text-ink-soft">{t('Одна картинка PNG: её можно отправить в мессенджере, открыть на телефоне и увеличить, или распечатать.')}</p>
            ) : mode === 'one' ? (
              <label className={label}>{t('Бумага')}
                <Select aria-label={t('Бумага')} value={paper} onChange={(v) => setPaper(v as Paper)} options={(Object.keys(PAPERS) as Paper[]).map((p) => ({ value: p, label: `${p}, ${PAPERS[p][0]} × ${PAPERS[p][1]} ${t('мм')}` }))} />
              </label>
            ) : (
              <>
                <label className={label}>{t('Бумага')}
                  <Select aria-label={t('Бумага')} value={sheet} onChange={(v) => setSheet(v as Paper)} options={(['A4', 'A3'] as Paper[]).map((p) => ({ value: p, label: p }))} />
                </label>
                <label className={label}>{t('Размер имён')}
                  <Select aria-label={t('Размер имён')} value={String(namePt)} onChange={(v) => setNamePt(Number(v))} options={SIZES.map((n) => ({ value: String(n), label: `${n} ${t('пт')}` }))} />
                </label>
              </>
            )}
            {canEdit && <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={hideLiving} onChange={(e) => setHideLiving(e.target.checked)} /> {t('Скрыть живых родственников')}</label>}
            {mode === 'image' ? (
              <div role="status" className="rounded-lg bg-muted p-2">
                <p>{t('Размер')}: <b>{pixels.w.toLocaleString(lang)} × {pixels.h.toLocaleString(lang)} {t('пикс.')}</b></p>
                {zoom < 2 && <p className="text-rust">{part === 'shown' || part === 'all' ? t('Семья большая, поэтому картинка мельче. Возьмите одну ветвь выше, в «Что взять».') : t('Ветвь большая, поэтому картинка мельче. Для крупных имён возьмите ветвь поменьше или сохраните PDF.')}</p>}
              </div>
            ) : (
            <div role="status" className="rounded-lg bg-muted p-2">
              <p>{t('Имена на бумаге')}: <b>{plan.namePt.toFixed(1)} {t('пт')}</b></p>
              {mode === 'sheets' && <p>{t('Листов')}: <b>{plan.sheets.length}</b></p>}
              {quality === 'tiny' && <p className="text-destructive">{t('Слишком мелко, прочитать будет трудно. Возьмите бумагу больше или напечатайте одну ветвь.')}</p>}
              {quality === 'small' && <p className="text-rust">{t('Мелковато, но читается вблизи.')}</p>}
              {plan.cutsCard && <p className="text-destructive">{t('При таком размере часть карточек попадёт на стык листов. Выберите другой размер.')}</p>}
            </div>
            )}
            {mode === 'image' ? (
              <div className="flex flex-wrap gap-2">
                <button className="bar-btn on" disabled={busy !== null || !printed.persons.length} onClick={() => void picture(false)}><Download size={14} /> {busy === null ? t('Скачать картинку') : `${t('Готовим картинку')}: ${busy}%`}</button>
                {canShare && <button className="bar-btn" disabled={busy !== null || !printed.persons.length} onClick={() => void picture(true)}><Share2 size={14} /> {t('Отправить')}</button>}
              </div>
            ) : (
              <button className="bar-btn on self-start" disabled={busy !== null || !printed.persons.length} onClick={save}><Download size={14} /> {busy === null ? t('Скачать PDF') : `${t('Готовим файл')}: ${busy}%`}</button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
