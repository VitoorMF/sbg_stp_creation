// config.js
// Todos os números do jogo num lugar só, para ajustar depois do teste com o
// core team sem mexer na engine. Valores em reais e milissegundos.

module.exports = {
  STARTING_VALUATION: 100000, // R$ 100 mil de capital semente

  // Multiplicador por dificuldade e por faixa de resposta.
  MULTIPLIERS: {
    facil: { best: 1.5, mid: 1.1, worst: 0.7 },
    media: { best: 1.6, mid: 1.1, worst: 0.6 },
    dificil: { best: 1.8, mid: 1.1, worst: 0.5 },
  },

  // Rodada de aposta: quanto da parte apostada volta para o time.
  // best = dobra (ganha o valor apostado), mid = perde metade, worst = perde tudo.
  STAKE_RETURN: { best: 2, mid: 0.5, worst: 0 },
  BET_FRACTIONS: [0.25, 0.5, 0.75, 1],
  DEFAULT_BET_FRACTION: 0.5, // quem não aposta a tempo aposta metade
  BET_DURATION_MS: 30000,

  // Tempo de debate por rodada (número da rodada -> ms). Padrão: 75 s.
  ROUND_DURATION_MS: { 1: 60000, 2: 60000, 3: 60000 },
  DEFAULT_ROUND_DURATION_MS: 75000,

  // Tolerância para a resposta que saiu do celular no último segundo.
  ANSWER_GRACE_MS: 750,

  SPEED_BONUS_WINDOW_MS: 25000,
  SPEED_BONUS_MULTIPLIER: 1.1, // +10%
  // Só a melhor opção ganha bônus, para não premiar chute rápido.
  SPEED_BONUS_ONLY_BEST: true,

  // Um evento por rodada (exceto na aposta), sorteado para um time.
  EVENTS_ENABLED: true,
  EVENTS: [
    { id: 'anjo', label: 'Um investidor anjo apostou no time', pct: 0.1 },
    { id: 'viral', label: 'Um post do time viralizou', pct: 0.08 },
    { id: 'reportagem', label: 'Uma reportagem elogiou o time', pct: 0.05 },
    { id: 'bug', label: 'Bug em produção no time', pct: -0.1 },
    { id: 'cancelou', label: 'Um cliente grande cancelou com o time', pct: -0.08 },
    { id: 'concorrente', label: 'Um concorrente copiou o produto do time', pct: -0.05 },
  ],

  // Ranking some do projetor a partir desta rodada até o resultado final.
  HIDE_RANKING_FROM_ROUND: 7,

  // Faixas do resultado final, da maior para a menor.
  TIERS: [
    { min: 5000000, name: 'Unicórnio', emoji: '🦄', message: 'O CTO dorme tranquilo.' },
    { min: 1500000, name: 'Série A', emoji: '🚀', message: 'Boa arquitetura, boa escala.' },
    { min: 300000, name: 'Rodada Seed', emoji: '🌱', message: 'Investidores apostaram em vocês.' },
    { min: 50000, name: 'Sobreviveu', emoji: '🛟', message: 'Bootstrapped: vivo, mas sem grandes saltos.' },
    { min: 0, name: 'Faliu', emoji: '💀', message: 'Faltou arquitetura ou alerta de custo. A startup foi junto.' },
  ],
  // Quem caiu abaixo de BANKRUPT_BELOW em algum momento e terminou com pelo
  // menos PHOENIX_MIN vira Fênix.
  BANKRUPT_BELOW: 50000,
  PHOENIX_MIN: 300000,
  PHOENIX: { name: 'Fênix', emoji: '🔥', message: 'Quebrou e voltou. Todo mundo aprende assim.' },

  // Texto do prêmio no telão final. Ajustar quando os AWS Credits forem confirmados.
  PRIZE_TEXT: 'Ganhou os AWS Credits!',

  MAX_TEAMS: 60,
  MAX_NAME_LENGTH: 24,
};
