import { tr } from '../i18n/locale.js';
export const TUTORIAL_STEPS = {
  welcome: [
    { 
      isWelcome: true, 
      get title() { return tr("Добро пожаловать в Lerne! 🚀"); }, 
      get content() { return tr("Твой персональный помощник для изучения языков.\n\n✨ С Lerne ты можешь:\n📍 Создавать карточки за секунды с помощью ИИ\n📍 Учить слова эффективно через умные повторения\n📍 Настраивать дизайн карточек под свой вкус"); } 
    },
    { 
      targetId: 'tut-help-button', 
      get title() { return tr("Всегда под рукой ❓"); }, 
      get content() { return tr("Если вдруг возникнут вопросы или вы забудете, как работает функция — просто нажмите на этот знак вопроса. \n\nЯ всегда подскажу, что делать!"); } 
    }
  ],
  decks: [
    { targetId: 'tut-deck-list', get title() { return tr("Твои колоды 📚"); }, get content() { return tr("Здесь отображаются все твои наборы карточек. Нажми на колоду, чтобы начать обучение."); } },
    { targetId: 'tut-deck-cards-btn', get title() { return tr("Управление карточками 🗂"); }, get content() { return tr("Нажми кнопку \"Карточки\", чтобы увидеть список всех слов в колоде, отредактировать их или добавить новые вручную."); } },
    { targetId: 'tut-add-deck', get title() { return tr("Создание и Импорт ➕"); }, get content() { return tr("Это самое важное место! Здесь можно:\n1️⃣ Создать свою колоду\n2️⃣ Добавить свои карточки через \"Пакетное добавление\"\n3️⃣ Импортировать готовые наборы из библиотеки."); } },
    { targetId: 'tut-main-settings', get title() { return tr("Настройки ⚙️"); }, get content() { return tr("Здесь можно настроить внешний вид карточек, голос озвучки и параметры ИИ."); } }
  ],
  cards: [
    { targetId: 'tut-card-list-content', get title() { return tr("Список слов 📝"); }, get content() { return tr("Здесь ты видишь все слова этой колоды. Любое слово можно изменить или удалить."); } },
    { targetId: 'tut-fab-add', get title() { return tr("Создай свою карточку ✍️"); }, get content() { return tr("Нажми на этот плюс, чтобы добавить свою собственную карточку. Ты можешь ввести слово сам или использовать магию ИИ."); } }
  ],
  creator: [
    { targetId: 'tut-creator-front', get title() { return tr("Новое слово 💡"); }, get content() { return tr("Введи слово или фразу, которую хочешь выучить."); } },
    { targetId: 'tut-creator-ai', get title() { return tr("Помощь ИИ ✨"); }, get content() { return tr("Не хочешь писать перевод и примеры вручную? Просто нажми эту кнопку, и ИИ сам заполнит перевод, примеры и даже подберет озвучку!"); } }
  ],
  settings: [
    { targetId: 'tut-settings-tabs', get title() { return tr("Разделы настроек 📑"); }, get content() { return tr("Здесь ты можешь переключаться между категориями: от выбора голоса озвучки до тонкой настройки моделей искусственного интеллекта."); } },
    { targetId: 'tut-settings-general', get title() { return tr("Автоматизация ⚡️"); }, get content() { return tr("Включи \"Авто-звук\", чтобы слышать слово сразу, и \"Авто-показ\", если хочешь, чтобы ответ открывался сам через пару секунд. Это очень экономит время!"); } },
    { targetId: 'tut-settings-design', get title() { return tr("Темы и Дизайн 🎨"); }, get content() { return tr("Сделай обучение красивым! Выбирай из готовых премиум-тем или настрой шрифты, цвета и тени под свой вкус."); } },
    { targetId: 'tut-settings-tabs', get title() { return tr("Промпты ИИ 🤖"); }, get content() { return tr("Во вкладке \"Промпты\" можно изменить инструкции для ИИ, чтобы он переводил или объяснял слова именно в том стиле, который тебе нужен."); } }
  ],
  study: [
    { targetId: 'tut-study-card', get title() { return tr("Лицевая сторона 🎴"); }, get content() { return tr("Перед тобой — «лицо» карточки. Посмотри на слово или фразу и попробуй вспомнить перевод."); }, padding: 40 },
    { targetId: 'tut-study-add-card', get title() { return tr("Быстрое добавление ➕"); }, get content() { return tr("Хочешь создать карточку со своим словом или фразой? Нажми сюда, чтобы мгновенно создать новую карточку!"); } },
    { targetId: 'tut-study-audio', get title() { return tr("Слушай и запоминай 🔊"); }, get content() { return tr("Нажми на динамик на самой карточке, чтобы услышать правильное произношение."); } },
    { targetId: 'tut-study-gen-audio', get title() { return tr("Магия нейросетей ✨"); }, get content() { return tr("Если у карточки нет звука, нажми сюда. ИИ мгновенно озвучит текст идеальным голосом носителя."); } },
    { targetId: 'tut-study-edit-card', get title() { return tr("Редактирование ✏️"); }, get content() { return tr("Заметил ошибку или хочешь добавить свой пример? Нажми \"карандаш\", чтобы изменить карточку."); } },
    { targetId: 'tut-study-card', get title() { return tr("Как увидеть ответ? 🔄"); }, get content() { return tr("Просто нажми на карточку. Она перевернется и покажет тебе ответ."); } }
  ],
  study_back: [
    { targetId: 'tut-study-answer', get title() { return tr("Обратная сторона ✨"); }, get content() { return tr("Здесь ты видишь ответ, примеры и картинку. Это окончательно закрепит слово в памяти."); } },
    { targetId: 'tut-study-grades', get title() { return tr("Оцени свои знания ✅"); }, get content() { return tr("Выбери честную оценку: от \"Снова\", если забыл, до \"Легко\", если слово далось без усилий. Это самое важное для обучения!"); } },
    { targetId: 'tut-study-grades', get title() { return tr("Умные повторения 🧠"); }, get content() { return tr("На основе твоей оценки ИИ рассчитает момент, когда ты начнешь забывать это слово, и покажет его именно тогда."); } }
  ]
};

export const CARD_LIST_BG_PRESETS = [
  { id: 'dark_obsidian', get label() { return tr("Строгий графит 🖤"); }, bgClass: 'bg-dark-obsidian', accent: '#38bdf8' },
  { id: 'dark_minimal', get label() { return tr("Минимализм 🌑"); }, bgClass: 'bg-dark-minimal', accent: '#94a3b8' },
  { id: 'dark_midnight', get label() { return tr("Полуночный синий 🌌"); }, bgClass: 'bg-dark-midnight', accent: '#60a5fa' },
  { id: 'dark_emerald', get label() { return tr("Тёмный изумруд 🌿"); }, bgClass: 'bg-dark-emerald', accent: '#34d399' },
  { id: 'dark_mocha', get label() { return tr("Тёмный мокко ☕"); }, bgClass: 'bg-dark-mocha', accent: '#fb923c' },
  { id: 'emerald_soft', get label() { return tr("Изумрудный поток 🍃"); }, bgClass: 'bg-cardlist-emerald', accent: '#10b981' },
  { id: 'ocean_soft', get label() { return tr("Океанический бриз 🌊"); }, bgClass: 'bg-cardlist-ocean', accent: '#38bdf8' },
  { id: 'sunset_soft', get label() { return tr("Тёплый закат 🌅"); }, bgClass: 'bg-cardlist-sunset', accent: '#f59e0b' },
];
