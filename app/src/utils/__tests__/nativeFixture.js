const samples = {
  "theory": {
    "id": "plusquamperfekt-theory",
    "type": "theory",
    "info": [
      {
        "type": "task",
        "text": "Lesen Sie die Regel und das Beispiel."
      }
    ],
    "data": {
      "text": "Das Plusquamperfekt beschreibt ein früheres Ereignis in der Vergangenheit.\n\nForm: hatte/war + Partizip II.\nAls ich ankam, hatte sie schon gegessen.",
      "summary": "Предпрошедшее время: hatte/war + Partizip II."
    }
  },
  "standard": {
    "type": "standard",
    "data": {
      "prompt": "Synthetic prompt",
      "answer": "Synthetic answer"
    }
  },
  "trainer": {
    "id": "trainer-input",
    "type": "trainer",
    "info": [
      {
        "type": "task",
        "text": "Ergänzen Sie das Hilfsverb im Plusquamperfekt."
      }
    ],
    "data": {
      "parts": [
        {
          "type": "text",
          "text": "Sie "
        },
        {
          "type": "input",
          "answers": [
            "hatte"
          ]
        },
        {
          "type": "text",
          "text": " den Brief schon geschrieben."
        }
      ]
    },
    "explanation": "Schreiben образует Perfekt с haben."
  },
  "match": {
    "id": "perfekt-match",
    "type": "match",
    "info": [
      {
        "type": "task",
        "text": "Ordnen Sie die Verben dem passenden Hilfsverb zu."
      },
      {
        "type": "source",
        "text": "Die Verben stehen im Infinitiv."
      },
      {
        "type": "example",
        "text": "fahren → sein"
      }
    ],
    "data": {
      "pairs": [
        {
          "left": "kommen",
          "right": "sein"
        },
        {
          "left": "lesen",
          "right": "haben"
        },
        {
          "left": "gehen",
          "right": "sein"
        },
        {
          "left": "lesen",
          "right": "haben"
        }
      ]
    },
    "explanation": "Одинаковые варианты справа взаимозаменяемы; каждый элемент можно использовать один раз.",
    "metadata": {
      "tags": [
        "auxiliary-verbs"
      ]
    }
  },
  "quiz": {
    "id": "quiz",
    "type": "quiz",
    "data": {
      "prompt": "Welche Sätze stehen im Perfekt?",
      "options": [
        {
          "text": "Ich habe gekocht.",
          "correct": true
        },
        {
          "text": "Sie ist angekommen.",
          "correct": true
        },
        {
          "text": "Wir kochten."
        }
      ]
    },
    "explanation": "Perfekt состоит из haben/sein и Partizip II."
  },
  "puzzle": {
    "id": "puzzle",
    "type": "puzzle",
    "data": {
      "tokens": [
        "Gestern",
        "bin",
        "ich",
        "nach",
        "Berlin",
        "gefahren."
      ],
      "translation": "Вчера я ездил в Берлин."
    }
  },
  "word_bank": {
    "id": "word-bank",
    "type": "word_bank",
    "data": {
      "options": [
        "habe",
        "bin",
        "ist"
      ],
      "parts": [
        {
          "type": "text",
          "text": "Ich "
        },
        {
          "type": "gap",
          "option": 0
        },
        {
          "type": "text",
          "text": " gekocht und "
        },
        {
          "type": "gap",
          "option": 1
        },
        {
          "type": "text",
          "text": " dann spazieren gegangen."
        }
      ]
    }
  },
  "free_text": {
    "type": "free_text",
    "data": {
      "prompt": "Synthetic prompt",
      "sample_answer": "Synthetic answer"
    }
  },
  "editable_text": {
    "type": "editable_text",
    "data": {
      "source_text": "Ich gehen.",
      "correct_text": "Ich gehe."
    }
  }
};
export const nativeCard = (type = 'standard', fields = {}, authored = {}) => ({ ...fields,
  content_v2: { schema_version: 2, card: { ...structuredClone(samples[type]), ...authored } } });
