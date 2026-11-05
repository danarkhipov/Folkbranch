# Folkbranch

Свой дом для истории семьи: понятное дерево, страница как в Notion с фото для каждого родственника, совместная правка по приглашению и агенты, которые работают с архивом через MCP и не видят лишнего.

[English version](README.md)

![Схема семьи с открытой карточкой человека](docs/images/chart.png)

- **Дерево:** поколения на одном экране, родственник добавляется с любой стороны карточки, поиск, степень родства.
- **Страницы:** текст с фото, ссылками на родню, тегами, источниками и пометками о непроверенных абзацах.
- **Данные у вас:** один файл SQLite и папка с фото на вашем сервере. GEDCOM, Excel, CSV, JSON и обычный текст загружаются и выгружаются.
- **Приватность:** читатели и агенты только для чтения не видят живых родственников, это проверяет сервер.
- **Агенты:** MCP и REST с токенами, которые можно ограничить по сроку и отозвать. Их правки ждут вашей проверки, если вы не решите иначе. Любое изменение можно отменить.

## Установка

Нужен [Docker](https://docs.docker.com/get-docker/). Одна команда на вашем компьютере:

```bash
curl -fsSL https://raw.githubusercontent.com/danarkhipov/folkbranch/main/install.sh | sh
```

Она скачает готовый образ и напечатает ссылку. Откройте её, назовите семью, а приложение само покажет, что ещё можно настроить и чего не хватает. Работает примерно на 130 МБ памяти. На сервере, с автоматическим HTTPS:

```bash
curl -fsSL https://raw.githubusercontent.com/danarkhipov/folkbranch/main/install.sh | sh -s -- --domain family.example.com
```

**Пусть это сделает агент.** Скажите Codex, Claude Code или другому агенту:

> Установи Folkbranch по инструкции https://raw.githubusercontent.com/danarkhipov/folkbranch/main/skills/folkbranch/SKILL.md

Копии, обновления и хостинг на Railway: [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

## Подключить агента

```bash
cd ~/folkbranch && ./family connect
```

Команда создаст ключ и подключит найденные на компьютере Claude Code или Codex по MCP. Для Cursor, Windsurf и других приложение даёт готовый текст: **Настройки → Агенты и MCP**. Правки ждут вашей проверки, если вы не решите иначе. Роли и возможности агента: [docs/AGENTS.md](docs/AGENTS.md).

## Разработка

```bash
pnpm install && pnpm dev
```

Приложение откроется на http://localhost:3417, данные лежат в `./data`. См. [CONTRIBUTING.md](CONTRIBUTING.md).

## Лицензия

[AGPL-3.0](LICENSE). Нашли уязвимость: [SECURITY.md](SECURITY.md).
