export const LOCALIZED_TUTORIAL_STEPS = {
  uk: {
    welcome: [
      {
        isWelcome: true,
        title: 'Ласкаво просимо до Lerne! 🚀',
        content: 'Твій персональний помічник для вивчення мов.\n\n✨ З Lerne ти можеш:\n📍 Створювати картки за секунди за допомогою ШІ\n📍 Вчити слова ефективно через розумні повторення\n📍 Налаштовувати дизайн карток під свій смак'
      },
      {
        targetId: 'tut-help-button',
        title: 'Завжди під рукою ❓',
        content: 'Якщо виникнуть питання або ви забудете, як працює функція — просто натисніть на цей знак питання.\n\nЯ завжди підкажу, що робити!'
      }
    ],
    decks: [
      { targetId: 'tut-deck-list', title: 'Твої колоди 📚', content: 'Тут відображаються всі твої набори карток. Натисни на колоду, щоб розпочати навчання.' },
      { targetId: 'tut-deck-cards-btn', title: 'Управління картками 🗂', content: 'Натисни кнопку "Картки", щоб побачити список усіх слів у колоді, відредагувати їх або додати нові вручну.' },
      { targetId: 'tut-add-deck', title: 'Створення та Імпорт ➕', content: 'Це найважливіше місце! Тут можна:\n1️⃣ Створити свою колоду\n2️⃣ Додати свої картки через "Пакетне додавання"\n3️⃣ Імпортувати готові набори з бібліотеки.' },
      { targetId: 'tut-main-settings', title: 'Налаштування ⚙️', content: 'Тут можна налаштувати зовнішній вигляд карток, голос озвучки та параметри ШІ.' }
    ],
    cards: [
      { targetId: 'tut-card-list-content', title: 'Список слів 📝', content: 'Тут ти бачиш усі слова цієї колоди. Будь-яке слово можна змінити або видалити.' },
      { targetId: 'tut-fab-add', title: 'Створи свою картку ✍️', content: 'Натисни на цей плюс, щоб додати свою власну картку. Ти можеш ввести слово сам або використати магію ШІ.' }
    ],
    creator: [
      { targetId: 'tut-creator-front', title: 'Нове слово 💡', content: 'Введи слово або фразу, яку хочеш вивчити.' },
      { targetId: 'tut-creator-ai', title: 'Допомога ШІ ✨', content: 'Не хочеш писати переклад і приклади вручну? Просто натисни цю кнопку, і ШІ сам заповнить переклад, приклади і навіть підбере озвучку!' }
    ],
    settings: [
      { targetId: 'tut-settings-tabs', title: 'Розділи налаштувань 📑', content: 'Тут ти можеш переключатися між категоріями: від вибору голосу озвучки до тонкого налаштування моделей штучного інтелекту.' },
      { targetId: 'tut-settings-general', title: 'Автоматизація ⚡️', content: 'Увімкни "Авто-звук", щоб чути слово одразу, та "Авто-показ", якщо хочеш, щоб відповідь відкривалася сама через пару секунд. Це дуже економить час!' },
      { targetId: 'tut-settings-design', title: 'Теми та Дизайн 🎨', content: 'Зроби навчання красивим! Обирай із готових преміум-тем або налаштуй шрифти, кольори та тіні під свій смак.' },
      { targetId: 'tut-settings-tabs', title: 'Промпти ШІ 🤖', content: 'У вкладці "Промпти" можна змінити інструкції для ШІ, щоб він перекладав або пояснював слова саме у тому стилі, який тобі потрібен.' }
    ],
    study: [
      { targetId: 'tut-study-card', title: 'Лицьова сторона 🎴', content: 'Перед тобою — «лице» картки. Подивись на слово або фразу і спробуй згадати переклад.', padding: 40 },
      { targetId: 'tut-study-add-card', title: 'Швидке додавання ➕', content: 'Хочеш створити картку зі своїм словом або фразою? Натисни сюди, щоб миттєво створити нову картку!' },
      { targetId: 'tut-study-audio', title: 'Слухай і запам’ятовуй 🔊', content: 'Натисни на динамік на самій картці, щоб почути правильну вимову.' },
      { targetId: 'tut-study-gen-audio', title: 'Магія нейромереж ✨', content: 'Якщо у картки немає звуку, натисни сюди. ШІ миттєво озвучить текст ідеальним голосом носія.' },
      { targetId: 'tut-study-edit-card', title: 'Редагування ✏️', content: 'Помітив помилку або хочеш додати свій приклад? Натисни "олівець", щоб змінити картку.' },
      { targetId: 'tut-study-card', title: 'Як побачити відповідь? 🔄', content: 'Просто натисни на картку. Вона перевернеться і покаже тобі відповідь.' }
    ],
    study_back: [
      { targetId: 'tut-study-answer', title: 'Зворотна сторона ✨', content: 'Тут ти бачиш відповідь, приклади та картинку. Це остаточно закріпить слово у пам’яті.' },
      { targetId: 'tut-study-grades', title: 'Оціни свої знання ✅', content: 'Обери чесну оцінку: від "Знову", якщо забув, до "Легко", якщо слово далося без зусиль. Це найважливіше для навчання!' },
      { targetId: 'tut-study-grades', title: 'Розумні повторення 🧠', content: 'На основі твоєї оцінки ШІ розрахує момент, коли ти почнеш забувати це слово, і покаже його саме тоді.' }
    ]
  },
  ru: {
    welcome: [
      {
        isWelcome: true,
        title: 'Добро пожаловать в Lerne! 🚀',
        content: 'Твой персональный помощник для изучения языков.\n\n✨ С Lerne ты можешь:\n📍 Создавать карточки за секунды с помощью ИИ\n📍 Учить слова эффективно через умные повторения\n📍 Настраивать дизайн карточек под свой вкус'
      },
      {
        targetId: 'tut-help-button',
        title: 'Всегда под рукой ❓',
        content: 'Если вдруг возникнут вопросы или вы забудете, как работает функция — просто нажмите на этот знак вопроса.\n\nЯ всегда подскажу, что делать!'
      }
    ],
    decks: [
      { targetId: 'tut-deck-list', title: 'Твои колоды 📚', content: 'Здесь отображаются все твои наборы карточек. Нажми на колоду, чтобы начать обучение.' },
      { targetId: 'tut-deck-cards-btn', title: 'Управление карточками 🗂', content: 'Нажми кнопку "Карточки", чтобы увидеть список всех слов в колоде, отредактировать их или добавить новые вручную.' },
      { targetId: 'tut-add-deck', title: 'Создание и Импорт ➕', content: 'Это самое важное место! Здесь можно:\n1️⃣ Создать свою колоду\n2️⃣ Добавить свои карточки через "Пакетное добавление"\n3️⃣ Импортировать готовые наборы из библиотеки.' },
      { targetId: 'tut-main-settings', title: 'Настройки ⚙️', content: 'Здесь можно настроить внешний вид карточек, голос озвучки и параметры ИИ.' }
    ],
    cards: [
      { targetId: 'tut-card-list-content', title: 'Список слов 📝', content: 'Здесь ты видишь все слова этой колоды. Любое слово можно изменить или удалить.' },
      { targetId: 'tut-fab-add', title: 'Создай свою карточку ✍️', content: 'Нажми на этот плюс, чтобы добавить свою собственную карточку. Ты можешь ввести слово сам или использовать магию ИИ.' }
    ],
    creator: [
      { targetId: 'tut-creator-front', title: 'Новое слово 💡', content: 'Введи слово или фразу, которую хочешь выучить.' },
      { targetId: 'tut-creator-ai', title: 'Помощь ИИ ✨', content: 'Не хочешь писать перевод и примеры вручную? Просто нажми эту кнопку, и ИИ сам заполнит перевод, примеры и даже подберет озвучку!' }
    ],
    settings: [
      { targetId: 'tut-settings-tabs', title: 'Разделы настроек 📑', content: 'Здесь ты можешь переключаться между категориями: от выбора голоса озвучки до тонкой настройки моделей искусственного интеллекта.' },
      { targetId: 'tut-settings-general', title: 'Автоматизация ⚡️', content: 'Включи "Авто-звук", чтобы слышать слово сразу, и "Авто-показ", если хочешь, чтобы ответ открывался сам через пару секунд. Это очень экономит время!' },
      { targetId: 'tut-settings-design', title: 'Темы и Дизайн 🎨', content: 'Сделай обучение красивым! Выбирай из готовых премиум-тем или настрой шрифты, цвета и тени под свой вкус.' },
      { targetId: 'tut-settings-tabs', title: 'Промпты ИИ 🤖', content: 'Во вкладке "Промпты" можно изменить инструкции для ИИ, чтобы он переводил или объяснял слова именно в том стиле, который тебе нужен.' }
    ],
    study: [
      { targetId: 'tut-study-card', title: 'Лицевая сторона 🎴', content: 'Перед тобой — «лицо» карточки. Посмотри на слово или фразу и попробуй вспомнить перевод.', padding: 40 },
      { targetId: 'tut-study-add-card', title: 'Быстрое добавление ➕', content: 'Хочешь создать карточку со своим словом или фразой? Нажми сюда, чтобы мгновенно создать новую карточку!' },
      { targetId: 'tut-study-audio', title: 'Слушай и запоминай 🔊', content: 'Нажми на динамик на самой карточке, чтобы услышать правильное произношение.' },
      { targetId: 'tut-study-gen-audio', title: 'Магия нейросетей ✨', content: 'Если у карточки нет звука, нажми сюда. ИИ мгновенно озвучит текст идеальным голосом носителя.' },
      { targetId: 'tut-study-edit-card', title: 'Редактирование ✏️', content: 'Заметил ошибку или хочешь добавить свой пример? Нажми "карандаш", чтобы изменить карточку.' },
      { targetId: 'tut-study-card', title: 'Как увидеть ответ? 🔄', content: 'Просто нажми на карточку. Она перевернется и покажет тебе ответ.' }
    ],
    study_back: [
      { targetId: 'tut-study-answer', title: 'Обратная сторона ✨', content: 'Здесь ты видишь ответ, примеры и картинку. Это окончательно закрепит слово в памяти.' },
      { targetId: 'tut-study-grades', title: 'Оцени свои знания ✅', content: 'Выбери честную оценку: от "Снова", если забыл, до "Легко", если слово далось без усилий. Это самое важное для обучения!' },
      { targetId: 'tut-study-grades', title: 'Умные повторения 🧠', content: 'На основе твоей оценки ИИ рассчитает момент, когда ты начнешь забывать это слово, и покажет его именно тогда.' }
    ]
  },
  en: {
    welcome: [
      {
        isWelcome: true,
        title: 'Welcome to Lerne! 🚀',
        content: 'Your personal assistant for learning languages.\n\n✨ With Lerne you can:\n📍 Create flashcards in seconds using AI\n📍 Learn words effectively via smart repetitions\n📍 Customize card designs to your taste'
      },
      {
        targetId: 'tut-help-button',
        title: 'Always at hand ❓',
        content: 'If you have any questions or forget how a feature works — just click this question mark.\n\nI will always guide you!'
      }
    ],
    decks: [
      { targetId: 'tut-deck-list', title: 'Your Decks 📚', content: 'All your card sets are displayed here. Click on a deck to start learning.' },
      { targetId: 'tut-deck-cards-btn', title: 'Card Management 🗂', content: 'Click "Cards" to see a list of all words in the deck, edit them, or add new ones manually.' },
      { targetId: 'tut-add-deck', title: 'Create & Import ➕', content: 'This is the main place! Here you can:\n1️⃣ Create your own deck\n2️⃣ Batch add cards\n3️⃣ Import ready-made sets from library.' },
      { targetId: 'tut-main-settings', title: 'Settings ⚙️', content: 'Customize card appearance, TTS voice, and AI parameters here.' }
    ],
    cards: [
      { targetId: 'tut-card-list-content', title: 'Word List 📝', content: 'Here you see all words in this deck. Any word can be edited or deleted.' },
      { targetId: 'tut-fab-add', title: 'Create Your Card ✍️', content: 'Click this plus icon to add your own card. You can type words manually or use AI magic.' }
    ],
    creator: [
      { targetId: 'tut-creator-front', title: 'New Word 💡', content: 'Enter the word or phrase you want to learn.' },
      { targetId: 'tut-creator-ai', title: 'AI Assistant ✨', content: 'Don\'t want to write translations manually? Click this button and AI will fill translations, examples, and audio!' }
    ],
    settings: [
      { targetId: 'tut-settings-tabs', title: 'Settings Sections 📑', content: 'Switch between categories: from TTS voice selection to AI models tuning.' },
      { targetId: 'tut-settings-general', title: 'Automation ⚡️', content: 'Enable "Auto sound" and "Auto reveal" to speed up learning!' },
      { targetId: 'tut-settings-design', title: 'Themes & Design 🎨', content: 'Make learning beautiful! Choose from premium themes or adjust fonts, colors, and shadows.' },
      { targetId: 'tut-settings-tabs', title: 'AI Prompts 🤖', content: 'In the "Prompts" tab you can edit instructions for AI to translate or explain words.' }
    ],
    study: [
      { targetId: 'tut-study-card', title: 'Front Side 🎴', content: 'Look at the word or phrase and try to recall the translation.', padding: 40 },
      { targetId: 'tut-study-add-card', title: 'Quick Add ➕', content: 'Click here to instantly create a new card!' },
      { targetId: 'tut-study-audio', title: 'Listen & Remember 🔊', content: 'Click the speaker on the card to hear correct pronunciation.' },
      { targetId: 'tut-study-gen-audio', title: 'Neural Magic ✨', content: 'If the card has no audio, AI will generate it with a native voice.' },
      { targetId: 'tut-study-edit-card', title: 'Editing ✏️', content: 'Click the pencil icon to edit card text or examples.' },
      { targetId: 'tut-study-card', title: 'How to see answer? 🔄', content: 'Click the card to flip it and reveal the answer.' }
    ],
    study_back: [
      { targetId: 'tut-study-answer', title: 'Back Side ✨', content: 'Here you see the translation, examples, and picture.' },
      { targetId: 'tut-study-grades', title: 'Grade Your Knowledge ✅', content: 'Choose a honest rating: from "Again" to "Easy". This is essential for SRS learning!' },
      { targetId: 'tut-study-grades', title: 'Smart Repetitions 🧠', content: 'AI calculates the exact moment when you start forgetting this word.' }
    ]
  }
};

export function getLocalizedTutorialSteps(lang, context) {
  const langSteps = LOCALIZED_TUTORIAL_STEPS[lang] || LOCALIZED_TUTORIAL_STEPS.uk;
  return langSteps[context] || [];
}
