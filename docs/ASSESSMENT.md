# Экзамен с объективным результатом

Колода включается в экзамен только при `pedagogy.lesson_type = assessment` и явной конфигурации `pedagogy.assessment`. Без конфигурации остаётся прежний Classic. SRS и ручные оценки не преобразуются в экзаменационные баллы.

Версия конфигурации 1: `required_count`, `bonus_count`, `bands` (id, title, min, max), `review_routes` (id, title, competency_ids, deck_ids), необязательные `competency_titles`. Диапазоны покрывают 0…required_count без пересечений. Число карточек равно required_count + bonus_count; основные задания идут первыми по position/id. Каждая карточка содержит metadata.assessment.competency_ids, ссылающиеся на pedagogy.competencies. Поддерживаются Trainer и Free Text. Остальные механики выявляет Lesson QA.

Первый проверенный ответ фиксируется окончательно: верно — 1, неверно или пропуск — 0. Пустой свободный ответ нельзя отправить. Недоступный evaluator не засчитывает попытку и разрешает повтор. Пример, перевод, переворот, ручные SRS-кнопки и autoplay отсутствуют. При ошибке локального сохранения можно повторить сохранение исходного результата без нового ответа.

Основной результат и бонус подсчитываются отдельно. Слабые компетенции выбирают authored review_routes; кнопки открывают существующие колоды обычным study navigation. Баллы попытки не являются процентом долгосрочного mastery.

Владельцы: useStudyNavigation выбирает режим, useSessionStore хранит активную сессию, AssessmentView показывает задания/результат, assessment.js считает баллы, assessmentService сохраняет сессию и raw Knowledge Attempt в одной транзакции существующего Dexie. Ключ сессии `assessment:user:deck`, ID события `session:card`. Незавершённая попытка продолжается после reload при совпадении конфигурации, карточек, context и metadata. Новый запуск завершённого экзамена создаёт новую попытку. Последний полный отчёт хранится локально; raw события сохраняются на сервере после sync. Отдельного API архива полных отчётов нет.

GET `/knowledge/decks/{deck_id}` возвращает разрешённому пользователю KI и mappings активных карточек; они кэшируются перед экзаменом. Offline требует предварительно сохранённых mappings. Без primary mapping ответ не сохраняется и показана ошибка. Outbox отправляется существующим Knowledge Sync (startup, online, visibility и каждые 60 секунд). Смена аккаунта запрещает запись в чужую сессию.

Raw evidence: schema_version 3, evaluation_type assessment, status correct/incorrect/skipped, correct boolean; assessment содержит session_id/deck_id/ordinal/required_count/competency_ids. Sync проверяет доступ, активную карточку, matching primary KI, структуру и стабильный ID события. Правильный/неправильный ответ даёт объективное положительное/отрицательное evidence; skipped хранится без mastery evidence. self_rating, TMAProgress и TMAReviewHistory не создаются. Миграция схемы не нужна.

Проверки: assessment.test.js, browser/assessment.spec.cjs, test_knowledge_sync.py, test_knowledge_mastery.py и test_deck_passport.py. Browser использует исправленные реальные D14 fixtures, изолированный Dexie и mock API/evaluator. Точность внешней языковой модели этим не подтверждается.

Подготовленный курс: local/test-data/lesson-qa/corrected.snapshot.json. Неприменённый план update-plan.json содержит 158 карточек, 9 metadata колод, 8 KI и 678 primary mappings. Перед отдельно разрешённым применением сравнить свежий контент с original, сохранить backup, использовать одну транзакцию, сохранить ID/order и learner data, затем повторить QA. Архив 343 исключить. Генератор работает offline и ничего не применяет.
