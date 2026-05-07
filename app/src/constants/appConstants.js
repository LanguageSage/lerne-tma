export const TUTORIAL_STEPS = {
  decks: [
    { targetId: 'tut-deck-list', title: 'Твои колоды 📚', content: 'Здесь отображаются все твои наборы карточек. Нажми на колоду, чтобы начать обучение.' },
    { targetId: 'tut-add-deck', title: 'Добавить новое ➕', content: 'Хочешь создать свою колоду или импортировать готовую из библиотеки? Тебе сюда!' },
    { targetId: 'tut-main-settings', title: 'Настройки ⚙️', content: 'Здесь можно настроить внешний вид карточек, голос озвучки и параметры ИИ.' }
  ],
  settings: [
    { targetId: 'tut-settings-tabs', title: 'Разделы настроек 📑', content: 'Здесь ты можешь переключаться между категориями: от выбора голоса озвучки до тонкой настройки моделей искусственного интеллекта.' },
    { targetId: 'tut-settings-general', title: 'Автоматизация ⚡️', content: 'Включи "Авто-звук", чтобы слышать слово сразу, и "Авто-показ", если хочешь, чтобы ответ открывался сам через пару секунд. Это очень экономит время!' },
    { targetId: 'tut-settings-design', title: 'Темы и Дизайн 🎨', content: 'Сделай обучение красивым! Выбирай из готовых премиум-тем или настрой шрифты, цвета и тени под свой вкус.' },
    { targetId: 'tut-settings-tabs', title: 'Промпты ИИ 🤖', content: 'Во вкладке "Промпты" можно изменить инструкции для ИИ, чтобы он переводил или объяснял слова именно в том стиле, который тебе нужен.' }
  ],
  study: [
    { targetId: 'tut-study-card', title: 'Лицевая сторона 🎴', content: 'Перед тобой — «лицо» карточки. Посмотри на слово или фразу и попробуй перевести или ответить на вопрос.' },
    { targetId: 'tut-study-audio', title: 'Слушай и запоминай 🔊', content: 'Нажми на динамик на самой карточке, чтобы услышать правильное произношение.' },
    { targetId: 'tut-study-add-image', title: 'Визуальные образы 🖼', content: 'Добавь картинку, чтобы создать яркую ассоциацию! Можно загрузить свою или найти в Google прямо здесь.' },
    { targetId: 'tut-study-gen-audio', title: 'Магия нейросетей ✨', content: 'Если у карточки нет звука, нажми сюда. ИИ мгновенно озвучит текст идеальным голосом носителя.' },
    { targetId: 'tut-study-edit-card', title: 'Редактирование ✏️', content: 'Заметил ошибку или хочешь добавить свой пример? Нажми "карандаш", чтобы изменить карточку.' },
    { targetId: 'tut-study-card', title: 'Как увидеть ответ? 🔄', content: 'Просто нажми на карточку. Она перевернется и покажет тебе ответ.' }
  ],
  study_back: [
    { targetId: 'tut-study-answer', title: 'Обратная сторона ✨', content: 'Здесь ты видишь ответ, примеры и картинку. Это окончательно закрепит слово в памяти.' },
    { targetId: 'tut-study-grades', title: 'Оцени свои знания ✅', content: 'Выбери честную оценку: от "Снова", если забыл, до "Легко", если слово далось без усилий. Это самое важное для обучения!' },
    { targetId: 'tut-study-grades', title: 'Умные повторения 🧠', content: 'На основе твоей оценки ИИ рассчитает момент, когда ты начнешь забывать это слово, и покажет его именно тогда.' }
  ]
};

export const DESIGN_PRESETS = [
  {
    id: 'lerne_2026',
    name: 'Lerne 2026 ✨',
    settings: {
      cardBgFront: "liquid_morning",
      cardBgBack: "liquid_morning",
      cardFont: "Comfortaa",
      cardTextColor: "#ffff00",
      cardFontSize: 1.8,
      contextFont: "Inter",
      contextTextColor: "#080c03",
      contextFontSize: 1.35,
      cardTextShadow: "glow",
      contextTextShadow: "outline",
      cardFontWeight: "700",
      cardFontStyle: "normal",
      contextFontWeight: "400",
      contextFontStyle: "normal"
    }
  },
  {
    id: 'premium',
    name: 'Премиум 💎',
    settings: {
      cardBgFront: 'liquid',
      cardBgBack: 'liquid_cosmic',
      cardFont: 'Outfit',
      cardTextColor: '#ffffff',
      cardFontSize: 1.8,
      contextFont: 'Inter',
      contextTextColor: '#cbd5e1',
      contextFontSize: 1.35,
      cardTextShadow: 'glow',
      contextTextShadow: 'none',
      cardFontWeight: '700',
      cardFontStyle: 'normal',
      contextFontWeight: '400',
      contextFontStyle: 'normal'
    }
  },
  {
    id: 'aurora',
    name: 'Сияние 🌌',
    settings: {
      cardBgFront: 'aurora',
      cardBgBack: 'aurora',
      cardFont: 'Outfit',
      cardTextColor: '#ffffff',
      cardFontSize: 1.8,
      contextFont: 'Inter',
      contextTextColor: '#ffffff',
      contextFontSize: 1.1,
      cardTextShadow: 'glow',
      contextTextShadow: 'shadow'
    }
  },
  {
    id: 'morning_sea',
    name: 'Утреннее море 🌊',
    settings: {
      cardBgFront: 'liquid_morning',
      cardBgBack: 'liquid_morning',
      cardFont: 'Inter',
      cardTextColor: '#5d0e0e',
      cardFontSize: 1.8,
      cardFontWeight: '700',
      cardFontStyle: 'normal',
      contextFont: 'Inter',
      contextTextColor: '#30172e',
      contextFontSize: 1.35,
      contextFontWeight: '400',
      contextFontStyle: 'normal',
      cardTextShadow: 'glass',
      contextTextShadow: 'outline'
    }
  },
  {
    id: 'cyberpunk',
    name: 'Киберпанк 🤖',
    settings: {
      cardBgFront: "holographic",
      cardBgBack: "holographic",
      cardFont: "Roboto",
      cardTextColor: "#00ffff",
      cardFontSize: 1.9,
      contextFont: "Roboto",
      contextTextColor: "#57d6ce",
      contextFontSize: 1.2,
      cardTextShadow: "glow",
      contextTextShadow: "glow",
      cardFontWeight: "600",
      cardFontStyle: "normal",
      contextFontWeight: "400",
      contextFontStyle: "italic"
    }
  },
  {
    id: 'deep_ocean',
    name: 'Океан 🌊',
    settings: {
      cardBgFront: 'liquid_ocean',
      cardBgBack: 'liquid_ocean',
      cardFont: 'Playfair Display',
      cardTextColor: '#ffffff',
      cardFontSize: 1.8,
      contextFont: 'Inter',
      contextTextColor: '#94a3b8',
      contextFontSize: 1.1,
      cardTextShadow: 'shadow',
      contextTextShadow: 'none'
    }
  }
];
