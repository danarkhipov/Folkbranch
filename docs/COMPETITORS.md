# Похожие проекты

Исследование 03.11.2026. Демо TreeTree, Parenthese, family.ancestry и Stemmagraph открывались в браузере, Clann смотрели по скриншотам в README. Популярность и зрелость TreeTree и family.ancestry оценены по описаниям, сами репозитории не изучались. Gramps Web смотрели по описанию, в демо не входили.

| Проект | Ссылка | Лицензия, стек | Вид | Сильная сторона |
|---|---|---|---|---|
| Parenthese | https://app.parenthese.io/?demo&lang=en, https://github.com/IliesAllali/parenthese | PolyForm Noncommercial (не open source); Fastify, Prisma, Postgres, React | **Самый красивый:** бумажный фон, портреты-полароиды, мини-фото вокруг человека | Воспоминания (фото, видео, голос), таймлайн жизни, доступ по ссылке, модерация правок родни. Нет API и MCP |
| TreeTree | https://treetree.app/demo, https://github.com/tetrisgm/treetree | MIT; Next.js, Cloudflare Workers, D1, R2 | Тёмный, аккуратные шрифты, плашки без фото | Встроенный MCP и WebMCP, ИИ-архивист, правки ИИ через проверку, откат, 8 видов. Только Cloudflare, проект с хакатона |
| family.ancestry | https://family.ancestry.pit.world, https://github.com/moshcoder/family.ancestry | MIT; Bun, Hono, SQLite (фото в той же базе) | Простые тёмные прямоугольники | API, CLI, MCP, «кем приходится» словами. Лишнее: соцсеть, рекомендации, платные функции |
| Gramps Web | https://www.grampsweb.org | AGPL; Python | Старомодный | Самый зрелый: 40+ языков, ИИ-чат, отметки на фото. Сторонние MCP: https://github.com/Scormave/gramps-web-mcp |
| Clann | https://github.com/thatguy-za/Clann | Лицензию не проверяли; SQLite, один контейнер | Скромный, цветные кружки | Простота, GEDCOM с фото. Автор предупреждает: не выставлять в интернет |
| Belong | https://github.com/rodneyosodo/belong | Apache-2.0; Bun, Elysia, Postgres, shadcn, Better Auth | не смотрели | Почти наш стек, роли, GEDCOM. Нет заметок и ИИ |
| Heirloom | https://heirloom-app.com, https://github.com/Jyok1m/heirloom | AGPL; NestJS, GraphQL, Postgres, React | не смотрели | Сохранение по мере ввода, веерная схема |
| Stemmagraph | https://github.com/ltmoerdani/stemmagraph | AGPL или коммерческая; React Flow, Express, Prisma | Типовой | Неинтересен |

Текстовые форматы: Diagrammo `family` (https://diagrammo.app/docs/chart-family), Genmark (https://github.com/drewherron/genmark), TWF (https://github.com/romforth/twf).

Графовые библиотеки: `family-chart` (https://github.com/donatso/family-chart), `@memoir/tree`, `@reunionpage/react-family-tree`, `reactflow-family-tree`, `relatives-tree`.

## Чего нет ни у кого

| Требование | Статус |
|---|---|
| Страницы под каждого человека с блочным редактором | **Ни у кого** |
| Фото внутри текста | **Ни у кого**, везде отдельная галерея |
| Развёртывание на Railway в один клик | Не нашли |
| Интерфейс на русском в первую очередь | Не нашли |

## Что берём за образец

- **Вид:** Parenthese. Код брать нельзя, лицензия некоммерческая.
- **Работа нейросети:** TreeTree. Лицензия MIT, можно смотреть код и заимствовать, сохраняя уведомление.
- **Простота установки:** Clann, один контейнер и одна папка.
