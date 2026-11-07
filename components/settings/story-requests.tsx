'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Mic, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyField } from '@/components/ui/copy'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { List, ListRow, Section } from '@/components/ui/section'
import { api, useApp } from '@/lib/client'
import { personName } from '@/lib/types'
import { PersonPopover } from '../person-pickers'

interface Request { id: string; about: string; tellerName: string; received: number }

/** For a relative who will never sign up: a link with one button, and what they send waits for review. */
export function StoryRequests() {
  const { t, graph, confirm: ask } = useApp()
  const qc = useQueryClient()
  const { data: rows = [] } = useQuery({ queryKey: ['story-requests'], queryFn: () => api<Request[]>('story-requests') })
  const [personId, setPersonId] = useState('')
  const [tellerName, setTellerName] = useState('')
  const [question, setQuestion] = useState('')
  const [link, setLink] = useState('')
  const [error, setError] = useState('')
  const person = graph.persons.find((p) => p.id === personId)
  const refresh = () => qc.invalidateQueries({ queryKey: ['story-requests'] })
  const hereOnly = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
  return (
    <Section title={t('Попросить рассказать')} description={t('Ссылка для одного человека: открыть на телефоне, нажать большую кнопку и говорить. Аккаунт не нужен, архив по ссылке не виден, а запись ждёт вашей проверки.')}>
      <form className="flex flex-col gap-3" onSubmit={async (e) => {
        e.preventDefault()
        setError('')
        try {
          const { token } = await api<{ token: string }>('story-requests', { json: { personId, tellerName: tellerName.trim(), question: question.trim() } })
          setLink(`${location.origin}/tell/${token}`)
          setTellerName('')
          setQuestion('')
          refresh()
        } catch (x) {
          setError(String((x as Error).message ?? x))
        }
      }}>
        <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          <div className="flex min-w-0 flex-col gap-1 text-xs text-ink-soft">{t('О ком рассказ')}
            <PersonPopover onPick={setPersonId}><button type="button" className="flex h-9 min-w-0 items-center rounded-lg border border-input bg-white px-3 text-left text-sm text-ink"><span className="truncate">{person ? personName(person) : t('Выбрать карточку')}</span></button></PersonPopover>
          </div>
          <Field label={t('Кого просите')}><Input maxLength={120} placeholder={t('Например, бабушка Нина')} value={tellerName} onChange={(e) => setTellerName(e.target.value)} /></Field>
        </div>
        <Field label={t('Вопрос (необязательно)')}><Input maxLength={400} placeholder={t('Например, как вы познакомились с дедушкой?')} value={question} onChange={(e) => setQuestion(e.target.value)} /></Field>
        <Button className="self-start" disabled={!personId}><Mic /> {t('Создать ссылку')}</Button>
      </form>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {link && <CopyField value={link} primary />}
      {link && hereOnly && <p role="status" className="text-xs leading-snug text-ink-soft">{t('Сейчас адрес работает только на этом компьютере. Чтобы ссылка открылась у родственника, приложение должно быть доступно снаружи: на сервере или через ./folkbranch share.')}</p>}
      {rows.length > 0 && (
        <List>
          {rows.map((r) => <ListRow key={r.id} title={`${r.tellerName || t('Без имени')}: ${r.about}`} meta={`${t('Записей получено')}: ${r.received}`} actions={<Button size="sm" variant="danger" title={`${t('Закрыть ссылку')}: ${r.about}`} onClick={async () => { if (await ask(t('Закрыть ссылку? По ней больше нельзя будет отправить запись.'), t('Закрыть'))) { await api(`story-requests/${r.id}`, { method: 'DELETE' }); refresh() } }}><X /> {t('Закрыть')}</Button>} />)}
        </List>
      )}
    </Section>
  )
}
