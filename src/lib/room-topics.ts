/** Temas de conversa do nível Intermediário (o servidor sorteia o índice; todos veem o mesmo). */
export interface RoomTopic {
  en: string;
  pt: string;
  /** Pergunta pra puxar o assunto. */
  ask: string;
}

export const ROOM_TOPICS: readonly RoomTopic[] = [
  { en: "Your favorite food", pt: "Sua comida favorita", ask: "What's the best thing you've eaten this year?" },
  { en: "Weekend plans", pt: "Planos pro fim de semana", ask: "What are you up to this weekend?" },
  { en: "Dream trip", pt: "Viagem dos sonhos", ask: "If you could fly anywhere tomorrow, where would you go?" },
  { en: "Movies and series", pt: "Filmes e séries", ask: "What are you watching these days?" },
  { en: "Music", pt: "Música", ask: "What song is stuck in your head right now?" },
  { en: "Work or school", pt: "Trabalho ou estudo", ask: "What's the hardest part of your week?" },
  { en: "Childhood", pt: "Infância", ask: "What did you love doing as a kid?" },
  { en: "Pets", pt: "Bichos de estimação", ask: "Are you a dog person or a cat person?" },
  { en: "Sports", pt: "Esportes", ask: "Do you play or watch any sports?" },
  { en: "Your city", pt: "Sua cidade", ask: "What would you show a tourist in your city?" },
  { en: "Cooking", pt: "Cozinhar", ask: "What's something you can cook really well?" },
  { en: "Phones and apps", pt: "Celular e apps", ask: "Which app do you use the most?" },
  { en: "Superpowers", pt: "Superpoderes", ask: "If you could have one superpower, what would it be?" },
  { en: "Morning routine", pt: "Rotina da manhã", ask: "What's the first thing you do when you wake up?" },
  { en: "Best day ever", pt: "O melhor dia da sua vida", ask: "Tell us about a day you'll never forget." },
  { en: "Learning English", pt: "Aprendendo inglês", ask: "What's the hardest English word for you?" },
  { en: "Food from other countries", pt: "Comida de outros países", ask: "What foreign dish would you like to try?" },
  { en: "Hobbies", pt: "Hobbies", ask: "What do you do when you have free time?" },
  { en: "Funny mistakes", pt: "Micos", ask: "What's a funny mistake you've made?" },
  { en: "The future", pt: "O futuro", ask: "Where do you see yourself in five years?" },
];
