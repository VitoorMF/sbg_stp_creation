// gameEngine.js
// Núcleo do jogo Startup Creation. Não sabe nada de Socket.IO nem de HTTP —
// só gerencia estado. Quem fala com os clientes é o server.js.

const { ROUNDS } = require('./rounds');

const STARTING_VALUATION = 100000; // R$ 100 mil
const SPEED_BONUS_WINDOW_MS = 25000; // responde nos primeiros 25s -> bônus
const SPEED_BONUS_MULTIPLIER = 1.1; // +10%
const ROUND_DURATION_MS = {
  facil: 60000,
  media: 75000,
  dificil: 75000,
};

// Fases do jogo, nessa ordem.
const PHASE = {
  LOBBY: 'lobby', // esperando times entrarem
  SCENARIO: 'scenario', // rodada aberta, times respondendo
  REVEAL: 'reveal', // rodada fechada, mostrando resultado
  DELAYED_REVEAL: 'delayed_reveal', // revelação atrasada (rodada 6 etc)
  FINISHED: 'finished', // jogo acabou
};

class GameEngine {
  constructor(rounds = ROUNDS) {
    this.rounds = rounds;
    this.teams = new Map(); // teamId -> { id, name, valuation, history: [] }
    this.currentRoundIndex = -1;
    this.phase = PHASE.LOBBY;
    this.roundStartedAt = null;
    this.answers = new Map(); // teamId -> { optionId, answeredAt }
    // Guarda respostas de rodadas 'delayed' até a revelação acontecer.
    this.pendingDelayed = new Map(); // roundId -> Map(teamId -> optionId)
  }

  // --- Times -------------------------------------------------------------

  addTeam(teamId, name) {
    if (this.teams.has(teamId)) {
      throw new Error('team_exists');
    }
    const nameTaken = [...this.teams.values()].some(
      (t) => t.name.trim().toLowerCase() === name.trim().toLowerCase()
    );
    if (nameTaken) {
      throw new Error('name_taken');
    }
    this.teams.set(teamId, {
      id: teamId,
      name,
      valuation: STARTING_VALUATION,
      history: [], // [{ roundId, optionId, multiplier, valuationAfter }]
      wentBankrupt: false,
    });
    return this.teams.get(teamId);
  }

  getTeam(teamId) {
    return this.teams.get(teamId);
  }

  listTeams() {
    return [...this.teams.values()];
  }

  // --- Rodadas -------------------------------------------------------------

  get currentRound() {
    return this.rounds[this.currentRoundIndex] || null;
  }

  startNextRound() {
    if (this.currentRoundIndex + 1 >= this.rounds.length) {
      this.phase = PHASE.FINISHED;
      return null;
    }
    this.currentRoundIndex += 1;
    this.phase = PHASE.SCENARIO;
    this.roundStartedAt = Date.now();
    this.answers = new Map();
    return this.currentRound;
  }

  getRoundDuration(round) {
    return ROUND_DURATION_MS[round.difficulty] || 75000;
  }

  // Time envia a resposta. Retorna { ok, reason? }
  submitAnswer(teamId, optionId) {
    const round = this.currentRound;
    if (!round) return { ok: false, reason: 'no_active_round' };
    if (this.phase !== PHASE.SCENARIO) return { ok: false, reason: 'round_not_open' };
    if (!this.teams.has(teamId)) return { ok: false, reason: 'unknown_team' };
    if (this.answers.has(teamId)) return { ok: false, reason: 'already_answered' };

    const validOption = round.options.some((o) => o.id === optionId);
    if (!validOption) return { ok: false, reason: 'invalid_option' };

    this.answers.set(teamId, { optionId, answeredAt: Date.now() });
    return { ok: true };
  }

  // Fecha a rodada atual (chamado pelo timer ou manualmente pelo admin).
  // Aplica o multiplicador na hora, EXCETO se a rodada for 'delayed':
  // nesse caso só guarda a escolha e aplica depois, em resolveDelayedRound().
  closeRound() {
    const round = this.currentRound;
    if (!round) return null;

    // Preenche quem não respondeu com a pior opção.
    const worstOption = [...round.options].sort((a, b) => a.multiplier - b.multiplier)[0];
    for (const team of this.teams.values()) {
      if (!this.answers.has(team.id)) {
        this.answers.set(team.id, { optionId: worstOption.id, answeredAt: null });
      }
    }

    if (round.resolution === 'delayed') {
      this.phase = PHASE.REVEAL; // mostra só "resposta registrada", sem multiplicador
      this.pendingDelayed.set(round.id, new Map(this.answers));
      return { round, applied: false };
    }

    this._applyMultipliers(round, this.answers);
    this.phase = PHASE.REVEAL;
    return { round, applied: true };
  }

  // Chamado pelo admin quando chega a hora de revelar uma rodada 'delayed'.
  resolveDelayedRound(roundId) {
    const round = this.rounds.find((r) => r.id === roundId);
    const stored = this.pendingDelayed.get(roundId);
    if (!round || !stored) return null;

    this._applyMultipliers(round, stored);
    this.pendingDelayed.delete(roundId);
    this.phase = PHASE.DELAYED_REVEAL;
    return { round, outcomes: round.delayedOutcomes };
  }

  _applyMultipliers(round, answersMap) {
    for (const [teamId, answer] of answersMap.entries()) {
      const team = this.teams.get(teamId);
      if (!team) continue;

      const option = round.options.find((o) => o.id === answer.optionId);
      let multiplier = option.multiplier;

      // Bônus de velocidade: só vale para resposta real dentro da janela.
      if (
        answer.answeredAt &&
        this.roundStartedAt &&
        answer.answeredAt - this.roundStartedAt <= SPEED_BONUS_WINDOW_MS
      ) {
        multiplier *= SPEED_BONUS_MULTIPLIER;
      }

      team.valuation = Math.round(team.valuation * multiplier);
      if (team.valuation <= 50000) team.wentBankrupt = true; // marca p/ "Fênix"

      team.history.push({
        roundId: round.id,
        optionId: answer.optionId,
        multiplier,
        valuationAfter: team.valuation,
      });
    }
  }

  // --- Ranking -------------------------------------------------------------

  getRanking() {
    return this.listTeams()
      .map((t) => ({ id: t.id, name: t.name, valuation: t.valuation }))
      .sort((a, b) => b.valuation - a.valuation);
  }

  getFinalResult(team) {
    const v = team.valuation;
    let tier;
    if (v < 50000) tier = 'Faliu';
    else if (v < 300000) tier = 'Sobreviveu';
    else if (v < 1500000) tier = 'Rodada Seed';
    else if (v < 5000000) tier = 'Série A';
    else tier = 'Unicórnio';

    if (team.wentBankrupt && v >= 300000) tier = 'Fênix';
    return tier;
  }
}

module.exports = { GameEngine, PHASE, STARTING_VALUATION };
