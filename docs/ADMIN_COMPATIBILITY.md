# Независимая админка: договор совместимости

`lerne-admin` теперь содержит свою выбранную доменную реализацию и не устанавливает
TMA как core package. TMA сохраняет собственные модели/API/services и обычный запуск.
Runtime проектов не зависит от filesystem/cwd/Git друг друга; чистые форматы разделяются через версионированный пакет.
LOCAL UI по-прежнему может открыть loopback URL админки на 8050; это необязательная
HTTP-ссылка, не зависимость сборки или серверной логики.

В `api/admin_contract.json` фиксируются версии и source AST fingerprints schema,
permissions, cards и import. `scripts/verify_admin_contract.py` включён в backend
gate. Изменение значимых источников требует отдельного review artifact и версии:
`python scripts/verify_admin_contract.py --update` готовит только JSON diff и не
изменяет БД. При несовместимых изменениях увеличьте version соответствующей области.
Админка обновляет собственный snapshot отдельно, контролируемой процедурой.

Verifier использует стабильное AST-представление с прежними fingerprints Python
3.14 и на Python 3.12: формат `ast.dump` по умолчанию зависит от интерпретатора.
Пустые/необязательные поля исключены, литерал `None` остаётся значимым. Эта
нормализация не меняет artifact, версии контракта, DB marker или saved jobs.

Независимая админка использует versioned diagnostic profiles, привязанные к
проверенному base contract, вместо обязательного `tmasetting.LERNE_ADMIN_CONTRACT`.
Admin-only model/runtime adapters имеют отдельные provenance hashes; TMA source
artifact остаётся описанием TMA. Проверяются реальные колонки/defaults,
constraints/indexes, privileges/RLS и известные риски NULL. Unknown schema не
считается безопасной автоматически. Warning можно явно подтвердить для текущей
базы/схемы/операции, critical блокирует только затронутые операции. Перед каждой
записью проверка повторяется, DDL запрещён. Полный отчёт/журнал находятся в Admin;
metadata в БД не регистрируется. Существующие JSON V2/permissions/receipts и
проверка `lerne_contract` saved jobs сохранены. Lifecycle профилей и результаты:
`lerne-admin/docs/COMPATIBILITY.md`, `docs/DIAGNOSTICS_REPORT.md`.

При обновлении остановите старые workers, проверьте candidate core и согласованные
contract/profiles, выполните tests и выпустите Admin artifact. Миграции, если они
действительно нужны, остаются отдельным DBA действием; ни migration, ни marker не
являются формальным условием работы с уже проверенной совместимой схемой.

Отдельные tests проверяют TMA-owned LOCAL HTTP link/permissions и media redirect;
они больше не требуют admin package. Исправления offline flag, auth generation и
frontend harness из `codex/fix-offline-flag-and-harness` интегрированы в ветку
отделения. Сериализатор сохраняет явный пользовательский `progress.flag = 0`.
Изменился только source fingerprint области import (она включает весь cards.py);
schema/permissions/cards и все версии остаются прежними: совместимый bug fix не
меняет wire format или схему. Admin snapshot обновляется отдельно через candidate.
DB marker не используется как разрешение записи; profiles и уже версионированные
checkpoint/jobs проходят отдельную проверку согласованности release pair.

Текущая публикация исходников самостоятельна. Результаты объединённого общего gate
фиксируются в отчёте интеграции. Публикация полной истории TMA требует отдельного
решения по старым checkpoint/config/SQLite, оставшимся в истории: обычный commit
их оттуда не удаляет, переписывания истории эта работа не выполняет.


## Shared card package — 2026-10-25

JSON V2, passport validators, answer contracts, legacy parsing and conversion now
have one implementation in `api/card_core/lerne_card_core` (lerne-card-core 0.1.0).
The five old `api/services` modules are compatibility aliases. Admin consumes an
exact wheel release; its DB/models/permissions/runtime remain independently owned.
TMA uses the same package sources inside the existing Vercel `api/` input tree;
no pip registry, sibling checkout or new deployment entry point is required.
Release procedure and scope: `api/card_core/README.md`.

The contract verifier follows the implementation and normalizes relative imports
back to logical service names, so an extraction alone preserves fingerprints and
saved jobs. It also checks aliases; future logic changes still require review.
Database schema, SRS/progress, receipts, permissions and deployment config are unchanged.
