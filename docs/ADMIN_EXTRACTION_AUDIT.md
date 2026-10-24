# Завершающий аудит отделения админки: границы первого этапа

> Исторический отчёт этапа с editable core. Актуальное независимое решение:
> [ADMIN_COMPATIBILITY.md](ADMIN_COMPATIBILITY.md). Runtime зависимости от TMA Git
> и package `lerne-tma-core` устранены; исходное описание ниже сохранено для истории.

TMA предоставляет `lerne-tma-core==0.1.1` из `pyproject.toml`. Core содержит
единственные модели, permissions, content/author/CEFR/media services и LOCAL
runtime. `lerne-admin` устанавливает чистый editable checkout **точного commit
SHA**, заданного в его `src/lerne_admin/core.lock.json`. Один номер версии без
Git pin не считается воспроизводимым подключением. В TMA нет обратных Python
импортов админки; LOCAL UI сохраняет только loopback HTTP-переход.

Для независимой проверки клонируйте оба репозитория, checkout core по lock-файлу
админки, запустите её `tools/bootstrap.py --core-path ABSOLUTE_CORE_PATH`,
`python -m lerne_admin.cli --check-install` и `python -m tests.run` из её `.venv`.
Ни `.env`, ни `.admin-local.json`, ни существующая БД для этих проверок не нужны.
Реальный LOCAL запускается только с явно подготовленным внешним config/data.

## Production source boundary

`.vercelignore` разрешает только `api/`, `app/` и root build manifests.
Root `/data/` и private/generated paths исключены; вложенные source `data/`
сохраняются. Старое незафиксированное корнем правило `data/` исключало
`app/src/data/bundeslaender.js`, LiD JSON и словари обеих реализаций CEFR.
В `vercel.json` Python builder сохраняет прежний entrypoint и excludeFiles;
core packaging metadata и LOCAL package в Production upload не входят.

`python scripts/verify_deploy_files.py --output MANIFEST.json` проверяет все
source JSON, `bundeslaender.js`, build entrypoints, private path exclusions и
Python excludeFiles без login/build/upload Vercel. Это проверка source manifest,
а не утверждение о выпущенном deployment или его runtime bundle.
Регрессии включены в backend gate: `test_deploy_manifest.py`.

HTTP passport persistence tests перенесены в admin `test_deck_passport_http.py`;
чистые domain/CLI проверки `test_deck_passport.py` остаются в TMA. Guard проверяет
также косвенные импорты удалённых test fixtures. Deployment boundaries и passport
tests теперь выполняются обычным backend gate.

## Данные и Git

Две случайно versioned тестовые SQLite-базы, локальные списки файлов и архив
prompt exports сняты с отслеживания **с сохранением файлов на диске**. Секреты,
runtime config/checkpoint, базы, дампы и сгенерированные файлы не должны попадать
в текущий source tree. Учебные JSON с контентом/паспортами, используемые как
регрессионные fixtures, остаются исходниками тестов, а не копиями аккаунтов/БД.

Удаление из текущего tree не очищает Git history: прежние commits TMA содержат
старые тестовые SQLite и административный checkpoint/config. История не
переписывается этим аудитом. Перед публикацией полной истории в новом публичном
репозитории требуется отдельное решение об очистке или публикации чистого
snapshot. Это ограничение нельзя устранить одним обычным extraction commit.

Окончательные результаты clean-checkout тестов и список ограничений фиксируются
в `lerne-admin/docs/FINAL_AUDIT.md`; этот документ описывает стабильный контракт
и не содержит само-ссылочного SHA TMA commit.

## Не входит в первый этап

Core пока требует editable Git checkout и общего schema contract; wheel-only
deployment админки не поддерживается. Приватные domain helpers, LOCAL config
policy и optional legacy backup/audio fallback остаются зависимостями от core.
Следующий этап — публичные версионированные domain/config/resource contracts.
Live Supabase writes, paid AI/TTS calls, push, merge и Production deploy не
требуются для изолированных проверок и в этом аудите не выполняются.
