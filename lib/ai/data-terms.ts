// How each service keeps what the archive sends it, from its own documents, read on 16 Nov 2026. These texts age:
// the date is shown with them, and each names its source so the owner can read the current terms.
export const TERMS_CHECKED = '2026-11-16'

export interface Terms { trains: string; keeps: string; where: string; tip?: string; source: string }

export const DATA_TERMS: Record<string, Terms> = {
  openrouter: { trains: 'Сам OpenRouter не обучается на запросах. Приложение просит только тех провайдеров, которые не собирают данные', keeps: 'Текст запросов не сохраняет, хранит только служебные сведения: число токенов, время', where: 'США и страна выбранного провайдера', source: 'https://openrouter.ai/docs/guides/privacy/data-collection' },
  anthropic: { trains: 'Не обучается на запросах через API', keeps: 'До 30 дней; нарушения правил — до 2 лет', where: 'Не указано', source: 'https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data' },
  openai: { trains: 'Не обучается на запросах через API с марта 2023 года', keeps: 'Чат — до 30 дней для проверки злоупотреблений; расшифровка речи не хранится', where: 'Не указано', source: 'https://platform.openai.com/docs/guides/your-data' },
  google: { trains: 'На платном тарифе не обучается. На бесплатном использует запросы для улучшения, их могут читать сотрудники', keeps: 'Платный тариф: 55 дней для проверки злоупотреблений', where: 'Любая страна, где у Google есть серверы', tip: 'Подключайте ключ из проекта с включённой оплатой', source: 'https://ai.google.dev/gemini-api/terms' },
  yandex: { trains: 'По умолчанию сохраняет запросы и может обучать на них. Приложение в каждом запросе просит этого не делать', keeps: 'С выключенным журналом — только на время ответа', where: 'Не указано', source: 'https://aistudio.yandex.ru/en/docs/ai-studio/operations/disable-logging' },
  cloudru: { trains: 'Свои модели Cloud.ru не дообучаются на ваших данных. Внешние модели (DeepSeek, Qwen и другие) — по правилам их владельцев', keeps: 'Срок не указан', where: 'Свои модели — серверы Cloud.ru в России; внешние — серверы их владельцев', tip: 'Выбирайте модели, которые размещены у самого Cloud.ru', source: 'https://cloud.ru/documents/contracts/terms-of-service/evolution/foundation-models/description-foundation-models' },
  deepseek: { trains: 'Условия API не дают права обучаться на запросах; общая политика сервиса это допускает', keeps: 'Срок не указан', where: 'Китай', source: 'https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html' },
  moonshot: { trains: 'Сведения противоречат друг другу: справка говорит «нет», условия допускают', keeps: 'Пока жив аккаунт; без хранения — только по договору для компаний', where: 'Сингапур', source: 'https://platform.moonshot.ai/docs/agreement/userprivacy' },
  groq: { trains: 'Не обучается на запросах', keeps: 'Не хранит; до 30 дней — только при разборе сбоя или злоупотребления', where: 'США', tip: 'В консоли Groq можно включить полный запрет хранения (Data Controls)', source: 'https://console.groq.com/docs/your-data' },
  mistral: { trains: 'Не обучается на запросах через API; в настройках организации есть отдельный переключатель — проверьте, что он выключен', keeps: 'Срок не указан; без хранения — по запросу', where: 'Не указано', source: 'https://docs.mistral.ai/admin/security-access/privacy' },
  siliconflow: { trains: 'Не указано', keeps: 'Срок не указан', where: 'Не указано; компания в Сингапуре и Китае', source: 'https://docs.siliconflow.com/en/legals/privacy-policy' },
  rekognition: { trains: 'По умолчанию может хранить фото и использовать их для улучшения сервиса', keeps: 'Срок не указан', where: 'Выбранный регион AWS', tip: 'В AWS Organizations включите отказ: AI services opt-out policy для Rekognition', source: 'https://docs.aws.amazon.com/rekognition/latest/dg/security-data-encryption.html' },
  facepp: { trains: 'Условия разрешают хранить присланные данные для внутренних исследований', keeps: 'Исходные фото удаляет сразу после ответа; журналы — не меньше 6 месяцев', where: 'Китай или Канада', source: 'https://faceplusplus.com/privacy-policy' },
  luxand: { trains: 'Не указано', keeps: 'Шаблоны лиц и фото — до года после последнего обращения, не больше 3 лет', where: 'США', tip: 'Срок хранения можно сократить в настройках аккаунта Luxand', source: 'https://luxand.com/privacy' },
  compreface: { trains: 'Нет: это ваш собственный сервер', keeps: 'Только на вашем сервере', where: 'Ваш сервер', source: 'https://github.com/exadel-inc/CompreFace' },
}
