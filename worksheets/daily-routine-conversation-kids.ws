worksheet {
  title: "Daily Routine — Ana and Leo's Conversation"
  description: "Listen to two kids talking about their daily routine and answer the questions."

  block {
    title: "Part 1: Listen"
    instructions: "Listen to the conversation between Ana and Leo, then answer the question."
    conversation {
      lines:
      - f: "Hi, Leo! What time do you get up?"
      - m: "I get up at seven o'clock. What about you, Ana?"
      - f: "I get up at half past six. Do you have breakfast at home?"
      - m: "Yes, I have cereal and milk. Then I walk to school."
      - f: "I go by bus. What do you do after school?"
      - m: "I do my homework, then I play with my dog."
      female_voice: en-US-AnaNeural
      male_voice: en-US-RogerNeural
      question: "What time does Leo get up?"
      answer: "at seven o'clock"
    }
  }

  block {
    title: "Part 2: Listening Comprehension"
    instructions: "Listen and choose the correct answer."
    listeningmultiplechoice {
      audio_text: "Leo has cereal and milk for breakfast."
      question: "What does Leo have for breakfast?"
      options:
      - Cereal and milk
      - Eggs and toast
      - Nothing
      answer: "Cereal and milk"
    }
    listeningfillblank {
      audio_text: "I do my homework, then I play with my dog."
      text: "Leo does his homework, then he _____ with his dog."
      answer: "plays"
    }
  }

  block {
    title: "Part 3: True or False"
    instructions: "Read each sentence about the conversation. Is it true or false?"
    truefalse {
      statements:
      - Leo gets up at seven o'clock. | true
      - Ana walks to school. | false
      - Leo has breakfast at school. | false
      - Leo plays with his dog after school. | true
    }
  }

  block {
    title: "Part 4: Write About You"
    textbox {
      prompt: "Write three sentences about your daily routine. Use: get up, have breakfast, go to school, do homework."
      instructions: "Write in English, using the Present Simple."
    }
  }
}
