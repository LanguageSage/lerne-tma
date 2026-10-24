# Независимая админка: договор совместимости

`lerne-admin` теперь содержит свою выбранную доменную реализацию и не устанавливает
TMA как core package. TMA сохраняет собственные модели/API/services и обычный запуск.
Ни Python imports, ни filesystem/cwd/Git dependency между runtime проектов нет.
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

Для разрешения admin writes DBA отдельно подтверждает полный contract и fingerprint
реальной public schema в `tmasetting`, key `LERNE_ADMIN_CONTRACT`. Неизвестный,
устаревший contract или изменённая schema блокируют запись админки; DDL запрещён.
Админка не создаёт marker и не применяет миграции автоматически. В этом изменении
никакие metadata/DDL/data operations на существующих базах не выполнялись.

При выпуске изменения остановите старые admin workers, согласуйте миграции и
artifact обеих реализаций, отдельно подтвердите metadata после review и проверок,
затем разрешите операции. TMA semantic change без DDL тоже требует обновления
artifact/metadata: один physical schema fingerprint не заменяет format/rights
contract. CI проверяет исходники/artifact, а процедура выпуска отвечает за
публикацию metadata в общей БД; автоматического Production шага нет.

Отдельные tests проверяют TMA-owned LOCAL HTTP link/permissions и media redirect;
они больше не требуют admin package. Исправления offline flag, auth generation и
frontend harness из `codex/fix-offline-flag-and-harness` интегрированы в ветку
отделения. Сериализатор сохраняет явный пользовательский `progress.flag = 0`.
Изменился только source fingerprint области import (она включает весь cards.py);
schema/permissions/cards и все версии остаются прежними: совместимый bug fix не
меняет wire format или схему. Admin snapshot обновляется отдельно через candidate.
Старый exact marker не принимается новым core автоматически: DBA review metadata
и уже версионированных checkpoint/jobs остаётся отдельным шагом, даже при version 1.

Текущая публикация исходников самостоятельна. Результаты объединённого общего gate
фиксируются в отчёте интеграции. Публикация полной истории TMA требует отдельного
решения по старым checkpoint/config/SQLite, оставшимся в истории: обычный commit
их оттуда не удаляет, переписывания истории эта работа не выполняет.
