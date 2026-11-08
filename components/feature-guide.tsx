'use client'
import { Baby, CalendarDays, FileUp, GitMerge, History, Lightbulb, Link2, Map, Mic, MousePointer2, Printer, ScanFace, Share2, Smartphone, Sparkles, Terminal, UsersRound, type LucideIcon } from 'lucide-react'
import { useApp } from '@/lib/client'

export type GuideSection = 'setup' | 'account' | 'smart' | 'general' | 'people' | 'signin' | 'assistant' | 'agents' | 'data'

interface Feature { icon: LucideIcon; title: string; text: string; go?: { section: GuideSection; label: string; owner?: boolean } }

/** What the app can do, in the words a relative would use. Each card can lead to where it is switched on. */
const FEATURES: Feature[] = [
  { icon: Sparkles, title: 'ИИ-ассистент', text: 'Спросите «кто мои двоюродные?» или «где пробелы в роде Егоровых?». Он ищет по архиву и предлагает правки, а вы подтверждаете каждую. Нужен ваш ключ одного из сервисов.', go: { section: 'assistant', label: 'Подключить', owner: true } },
  { icon: Share2, title: 'Позвать родных', text: 'Ссылка-приглашение впускает человека в архив. Ссылка для просмотра показывает семью без входа, а можно отдать только одну ветку.', go: { section: 'people', label: 'Пригласить', owner: true } },
  { icon: ScanFace, title: 'Лица на фото', text: 'Назовите человека на одном снимке, и программа предложит его на остальных, даже в другом возрасте. Всё считается на вашем устройстве, фото никуда не уходят.', go: { section: 'smart', label: 'Включить' } },
  { icon: Mic, title: 'Голос в текст', text: 'Запишите, как бабушка рассказывает историю: запись расшифруется на устройстве. Для русского есть точная модель, для английского и других языков более мощные.', go: { section: 'smart', label: 'Выбрать модель' } },
  { icon: Baby, title: 'Попросить родных рассказать', text: 'Ссылка для одного человека, который не станет регистрироваться: открыть на телефоне, нажать большую кнопку и говорить. Рассказ придёт вам на проверку.', go: { section: 'people', label: 'Создать ссылку', owner: true } },
  { icon: FileUp, title: 'Дерево вместе с фото', text: 'Загрузите файл дерева (GEDCOM, таблицу или текст) и сразу все фотографии. Файлы сами найдут своих людей по тому, что написано в дереве и в названиях файлов.', go: { section: 'data', label: 'Загрузить' } },
  { icon: Map, title: 'Карта мест', text: 'Где жила семья и куда переезжала. На карточке человека места идут по порядку жизни.' },
  { icon: CalendarDays, title: 'Даты и календарь', text: 'Ближайшие дни рождения и годовщины, а ещё файл для календаря на телефоне: никто не забудет поздравить.' },
  { icon: GitMerge, title: 'Двойники', text: 'В «Проверке» собраны похожие карточки. Объедините их: ничего не пропадает, а одно действие вернёт всё обратно.' },
  { icon: History, title: 'История и отмена', text: 'Любую правку видно: кто, когда и что изменил. Любую можно откатить, в том числе импорт.' },
  { icon: Printer, title: 'Печать и веер предков', text: 'Лист о человеке для печати или PDF, схема в виде веера предков, а вся схема печатается на листах.' },
  { icon: Terminal, title: 'Внешние программы', text: 'Claude, Codex и другие программы подключаются по ключу, читают архив и предлагают правки. Ничего не меняется без вашего подтверждения.', go: { section: 'agents', label: 'Подключить', owner: true } },
]

/** Things most people never find on their own. */
const TIPS: { icon: LucideIcon; text: string }[] = [
  { icon: MousePointer2, text: 'Правая кнопка мыши: по человеку добавит родителя, супруга или ребёнка или удалит его, по пустому месту добавит человека туда, где вы нажали, загрузит файл или найдёт кого-нибудь.' },
  { icon: Link2, text: 'Наведите курсор на человека: загорится вся его линия, предки и потомки, и свет пробежит по ней от него вниз и вверх.' },
  { icon: UsersRound, text: 'Кнопка «Кого показать» оставляет на схеме одну ветку, и все списки, поиск и даты тоже начинают показывать только её. Вид можно сохранить и отправить ссылкой.' },
  { icon: Lightbulb, text: 'Потяните за портрет к другой карточке, и появится связь. Потяните за подпись, и карточка сдвинется, а родство не изменится.' },
  { icon: FileUp, text: 'Перетащите файл с деревом прямо на схему: откроется загрузка. Можно сразу с фотографиями.' },
  { icon: Smartphone, text: 'Добавьте архив на главный экран телефона: он откроется как приложение, а страница выдержит короткую недоступность сервера.' },
  { icon: Lightbulb, text: 'Поиск ищет по имени, дате, месту, профессии и понимает слова вроде «жена Ивана».' },
  { icon: Lightbulb, text: 'Если сведения расходятся, не выбирайте одно: запишите оба значения. Они сохранятся как версии, и позже будет видно, какое подтвердилось.' },
]

export function FeatureGuide({ onGo }: { onGo?: (section: GuideSection) => void }) {
  const { t, me } = useApp()
  const owner = me.role === 'owner'
  return (
    <div className="flex min-w-0 flex-col gap-5 text-sm">
      <section>
        <h3 className="mb-2 font-serif text-base font-medium">{t('Что умеет приложение')}</h3>
        <ul className="grid gap-2 sm:grid-cols-2">
          {FEATURES.map(({ icon: Icon, title, text, go }) => (
            <li key={title} className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-white p-3">
              <div className="flex items-center gap-2 font-medium"><Icon size={15} className="flex-none text-ink-soft" aria-hidden /> <span className="min-w-0 break-anywhere">{t(title)}</span></div>
              <p className="text-ink-soft">{t(text)}</p>
              {go && onGo && (!go.owner || owner) && <button type="button" className="pick mt-auto self-start text-xs underline underline-offset-2 hover:text-ink" onClick={() => onGo(go.section)}>{t(go.label)}</button>}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="mb-2 font-serif text-base font-medium">{t('Знаете ли вы')}</h3>
        <ul className="flex flex-col gap-2">
          {TIPS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex gap-2.5"><Icon size={15} className="mt-0.5 flex-none text-accent" aria-hidden /> <span className="min-w-0 break-anywhere">{t(text)}</span></li>
          ))}
        </ul>
      </section>
    </div>
  )
}
