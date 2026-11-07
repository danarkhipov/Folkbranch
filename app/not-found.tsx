import Link from 'next/link'
import { headers } from 'next/headers'
import { Logo } from '@/components/logo'
import { langFromHeader, translate } from '@/lib/i18n'

export default async function NotFound() {
  const lang = langFromHeader((await headers()).get('accept-language'))
  const t = (key: string) => translate(lang, key)
  return (
    <main className="flex min-h-dvh items-center justify-center bg-paper p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <Logo size={40} />
        <h1 className="font-serif text-xl font-medium">{t('Такой страницы нет')}</h1>
        <p className="text-sm text-ink-soft">{t('Возможно, ссылка неполная или устарела. Попросите того, кто её прислал, отправить новую.')}</p>
        <Link href="/" className="bar-btn border border-border">{t('Открыть схему')}</Link>
      </div>
    </main>
  )
}
