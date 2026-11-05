'use client'
import { useRef, useState } from 'react'
import Cropper from 'react-easy-crop'
import 'react-easy-crop/react-easy-crop.css'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { api, avatarUrl, useApp, useWrite } from '@/lib/client'
import { type Media, type Person } from '@/lib/types'

export function AvatarButton({ person }: { person: Person }) {
  const { canEdit, t } = useApp()
  const input = useRef<HTMLInputElement>(null)
  const [src, setSrc] = useState<File | null>(null)
  const [srcUrl, setSrcUrl] = useState('')
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const area = useRef({ x: 0, y: 0, width: 100, height: 100 })

  const save = useWrite(async () => {
    const form = new FormData()
    form.set('file', src!)
    form.set('personId', person.id)
    const m = await api<Media>('media', { body: form })
    const a = area.current
    await api(`persons/${person.id}/avatar`, { method: 'PUT', json: { mediaId: m.id, crop: { x: a.x / 100, y: a.y / 100, w: a.width / 100, h: a.height / 100 } } })
  }, [['media', person.id]])

  return (
    <>
      <button disabled={!canEdit} aria-label={t('Сменить фото')} title={canEdit ? t('Сменить фото') : undefined} className="w-[48px] h-[48px] flex-none rounded-full overflow-hidden bg-[#e7dfcd] flex-none shadow-[0_0_0_3px_#fffdf8,0_2px_10px_rgb(60_45_20/.25)] enabled:hover:opacity-85 transition" onClick={() => input.current?.click()}>
        <img src={avatarUrl(person)} alt="" className="w-full h-full object-cover" />
      </button>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => {
        const f = e.target.files?.[0]
        if (f) { setSrc(f); setSrcUrl(URL.createObjectURL(f)); setZoom(1); setCrop({ x: 0, y: 0 }) }
        e.target.value = ''
      }} />
      <Dialog open={!!src} onOpenChange={(o) => !o && setSrc(null)}>
        <DialogContent className="max-w-md">
          <DialogTitle className="font-serif font-medium">{t('Кадрировать аватарку')}</DialogTitle>
          <div className="relative h-80 rounded-lg overflow-hidden bg-ink">
            <Cropper image={srcUrl} crop={crop} zoom={zoom} aspect={1} cropShape="round" showGrid={false} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(a) => (area.current = a)} />
          </div>
          <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZoom(+e.target.value)} className="w-full accent-[var(--ink)]" />
          <div className="flex justify-end gap-2">
            <button className="bar-btn" onClick={() => setSrc(null)}>{t('Отмена')}</button>
            <button className="bar-btn on" disabled={save.isPending} onClick={async () => { await save.mutateAsync(); setSrc(null) }}>{t('Сохранить')}</button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
