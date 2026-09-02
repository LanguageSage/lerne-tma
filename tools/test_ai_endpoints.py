import os, sys, asyncio
from unittest.mock import patch, AsyncMock
sys.stdout.reconfigure(encoding="utf-8")
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from peewee import SqliteDatabase
test_db = SqliteDatabase(":memory:")
from api import models
models.tma_db.initialize(test_db)
models.tma_db.connect()
models.tma_db.create_tables([
    models.TMAUser, models.TMA_Folder, models.TMA_Deck, models.TMA_Card,
    models.TMAProgress, models.TMASetting, models.TMACustomPrompt
], safe=True)

from api import ai_service
from api.routers.ai import classify_cards_batch_endpoint, ClassifyBatchRequest

async def run_tests():
    print("=" * 65)
    print("🧪 ТЕСТИРОВАНИЕ ИНТЕГРАЦИОННЫХ ЭНДПОИНТОВ ИИ")
    print("=" * 65)

    user_id = 999888
    models.TMAUser.create(user_id=user_id, first_name="Tester")
    deck = models.TMA_Deck.create(id=1, user_id=user_id, name="Test Deck")
    models.TMASetting.create(key="AI_PROVIDER", value="google")
    models.TMASetting.create(key="GOOGLE_API_KEY", value="dummy_key")
    models.TMASetting.create(key="DEFAULT_MODEL", value="gemini-2.0-flash")

    print("\n[Test 1] Проверка классификатора CEFR для разных языков...")
    with patch("api.ai_clients.AIService.chat_completion", new_callable=AsyncMock) as mock_chat:
        mock_chat.return_value = ('["A1", "A2", "B2"]', True)
        res_de = await ai_service.classify_phrases_batch(["Hund", "Weil ich müde bin", "Je mehr desto besser"], "de")
        assert len(res_de) == 3
        print("  -> Немецкий язык:  PASSED ✅")

        with patch("api.ai_service.get_ai_config", return_value=("google", None, None)):
            res_local_fallback = await ai_service.classify_phrases_batch(
                ["Ich lerne Deutsch, um in Deutschland zu arbeiten."],
                "de",
            )
            assert res_local_fallback == ["B1"]
            print("  -> Немецкий fallback без AI-модели: PASSED ✅")

        mock_chat.return_value = ('["A1", "B1", "B2"]', True)
        res_en = await ai_service.classify_phrases_batch(["Coffee", "Working for 5 years", "If I had known"], "en")
        assert len(res_en) == 3
        print("  -> Английский язык: PASSED ✅")

        mock_chat.return_value = ('["A1", "A2", "B2"]', True)
        res_no = await ai_service.classify_phrases_batch(["Jeg heter Paul", "Fordi jeg er sulten", "Hadde jeg visst"], "no")
        assert len(res_no) == 3
        print("  -> Норвежский язык: PASSED ✅")

    print("\n[Test 2] Проверка эндпоинта POST /cards/classify-batch...")
    for i in range(3):
        models.TMA_Card.create(
            deck_id=deck.id, front_text=f"Phrase {i}", back_text="Перевод", context="",
            tags="", source="test", position=i+1
        )

    with patch("api.ai_service.classify_phrases_batch", new_callable=AsyncMock) as mock_classify:
        mock_classify.return_value = ["A1", "A2", "B1"]
        req = ClassifyBatchRequest(deck_id=deck.id, target_language="de")
        endpoint_res = await classify_cards_batch_endpoint(req, user_id=user_id)
        assert endpoint_res["status"] == "ok"
        assert endpoint_res["updated_count"] + endpoint_res["pending_background_count"] == 3
        print("  -> Эндпоинт пакетной классификации: PASSED ✅")

    print("\n" + "=" * 65)
    print("🎉 ВСЕ ИНТЕГРАЦИОННЫЕ ТЕСТЫ ЭНДПОИНТОВ ПРОЙДЕНЫ УСПЕШНО!")
    print("=" * 65)

if __name__ == "__main__":
    asyncio.run(run_tests())
