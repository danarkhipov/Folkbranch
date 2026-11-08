'use client'
import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useApp } from '@/lib/client'
import { CARD_H, layoutFamily } from '@/lib/graph/layout'
import { PAPERS, planOneSheet, planSheets, readability, type Paper } from '@/lib/graph/print-plan'
import type { Graph, Person } from '@/lib/types'
import { Select } from '@/components/ui/select'

const SIZES = [7, 8, 9, 10, 12]
const hide = (p: Person): Person => ({ ...p, givenName: '', surname: '', maidenName: '', patronymic: '', birthDate: '', birthYear: null, birthPlace: '', sex: 'U', avatarMediaId: null, avatarCrop: null, hidden: true })

/** What is on the chart now, on paper: the reader sees the real size of the text before anything is printed. */
export function PrintDialog({ graph, onClose }: { graph: Graph; onClose: () => void }) {
  const { t, familyName, rootsBelow, canEdit, notify } = useApp()
  const [mode, setMode] = useState<'one' | 'sheets'>('one')
  const [paper, setPaper] = useState<Paper>('A3')
  const [sheet, setSheet] = useState<Paper>('A4')
  const [namePt, setNamePt] = useState(8)
  const [hideLiving, setHideLiving] = useState(true)
  const [busy, setBusy] = useState<number | null>(null)

  const persons = useMemo(() => new Map(graph.persons.map((p) => (hideLiving && (p.living || p.keepPrivate) ? hide(p) : p)).map((p) => [p.id, p])), [graph, hideLiving])
  const printed = useMemo(() => ({ ...graph, persons: [...persons.values()] }), [graph, persons])
  const layout = useMemo(() => layoutFamily(printed, { rootsBelow, print: true }), [printed, rootsBelow])
  const plan = useMemo(() => (mode === 'one' ? planOneSheet(layout, paper) : planSheets(layout, persons, sheet, namePt)), [mode, layout, persons, paper, sheet, namePt])
  const quality = readability(plan.namePt)
  const { x, y, w, h } = layout.bounds

  const save = async () => {
    setBusy(0)
    try {
      const { chartToPdf } = await import('@/lib/print-chart')
      const bytes = await chartToPdf({
        layout, persons: printed.persons, plan, title: familyName, hiddenLabel: t('Живой родственник'),
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
  const label = 'flex flex-col gap-1 text-xs text-ink-soft'
  return (
    <Dialog open onOpenChange={(o) => !o && busy === null && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogTitle className="font-serif font-medium text-lg">{t('Печать схемы')}</DialogTitle>
        <p className="text-sm text-ink-soft">{t('Печатается то, что сейчас на схеме. Чтобы напечатать одну ветвь, выберите её кнопкой «Кого показать».')} {printed.persons.length} {t('чел.')}</p>
        <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-4 max-sm:grid-cols-1">
          <svg viewBox={`${x - 10} ${y - 10} ${w + 20} ${h + 20}`} role="img" aria-label={t('Как схема ляжет на бумагу')} className="w-full max-h-[50vh] rounded-lg border border-border bg-white">
            {layout.edges.map((e) => <path key={e.id} d={e.path} fill="none" stroke="#948b7a" strokeWidth={Math.max(1, w / 500)} />)}
            {layout.unions.map((u) => <path key={u.id} d={u.path} fill="none" stroke="#948b7a" strokeWidth={Math.max(1, w / 500)} />)}
            {[...layout.cards.values()].map((c) => <rect key={c.id} x={c.x - 40} y={c.y} width={80} height={CARD_H - 30} rx={8} fill="#e7dfcd" />)}
            {mode === 'sheets' && plan.sheets.map((s) => <rect key={`${s.row}.${s.col}`} x={s.x0} y={s.y0} width={s.x1 - s.x0} height={s.y1 - s.y0} fill="none" stroke="#a4502e" strokeDasharray={`${w / 100} ${w / 150}`} strokeWidth={Math.max(1, w / 400)} />)}
          </svg>
          <div className="flex flex-col gap-3 text-sm">
            <div role="radiogroup" aria-label={t('Как печатать')} className="flex flex-col gap-1">
              <label className="flex items-center gap-2"><input type="radio" name="print-mode" checked={mode === 'one'} onChange={() => setMode('one')} /> {t('На одном листе')}</label>
              <label className="flex items-center gap-2"><input type="radio" name="print-mode" checked={mode === 'sheets'} onChange={() => setMode('sheets')} /> {t('Склеить из листов')}</label>
            </div>
            {mode === 'one' ? (
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
            <div role="status" className="rounded-lg bg-muted p-2">
              <p>{t('Имена на бумаге')}: <b>{plan.namePt.toFixed(1)} {t('пт')}</b></p>
              {mode === 'sheets' && <p>{t('Листов')}: <b>{plan.sheets.length}</b></p>}
              {quality === 'tiny' && <p className="text-destructive">{t('Слишком мелко, прочитать будет трудно. Возьмите бумагу больше или напечатайте одну ветвь.')}</p>}
              {quality === 'small' && <p className="text-rust">{t('Мелковато, но читается вблизи.')}</p>}
              {plan.cutsCard && <p className="text-destructive">{t('При таком размере часть карточек попадёт на стык листов. Выберите другой размер.')}</p>}
            </div>
            <button className="bar-btn on self-start" disabled={busy !== null || !printed.persons.length} onClick={save}><Download size={14} /> {busy === null ? t('Скачать PDF') : `${t('Готовим файл')}: ${busy}%`}</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
