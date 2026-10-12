# Lerne: инструкции для агента

Карта проекта и скиллы:

- Сквозная таблица связей (UI $\to$ API $\to$ DB): `.agents/ARCHITECTURE.md`. Консоль администратора: `.agents/ADMIN_ARCHITECTURE.md`.
- Детальные правила по направлениям читай по необходимости в соответствующих скиллах (`.agents/skills/`):
  - `.agents/skills/tma-ui/SKILL.md`: React UI, visual design, responsive layout, accessibility, interaction states, design consistency and visual QA.
  - `.agents/skills/fastapi-backend/SKILL.md`: эндпоинты FastAPI, сервисы, потоки, медиа-стриминг.
  - `.agents/skills/db-mgmt/SKILL.md`: Peewee ORM, миграции, транзакции, Dexie офлайн-синхронизация.
  - `.agents/skills/lean-code/SKILL.md`: переиспользование модулей, компактный код без лишних абстракций.
  - не принимай решения самостоятельно, предлагай и согласовывай варианты решений. после того как пользователь подтвердил вариант решения только тогда можно приступать к плану или выполнению задания.

Перед работой прочитайте [общие инструкции](.agents/AGENTS.md).
Для новой задачи выберите подсистему через [AGENT_INDEX](.agents/AGENT_INDEX.md) и прочитайте только её документ.
Если файлы уже известны из задачи или текущей сессии, продолжайте точечное исследование без повторного обхода проекта.
Общие границы — в [ARCHITECTURE](.agents/ARCHITECTURE.md); админка — в [ADMIN_ARCHITECTURE](.agents/ADMIN_ARCHITECTURE.md).
Тематические правила и skills подключайте по необходимости, как указано в общих инструкциях.
