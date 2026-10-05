// gameEngine.js
// Núcleo do jogo Startup Creation. Não sabe nada de Socket.IO nem de HTTP:
// guarda o estado, aplica as regras e monta o que cada tela pode ver.
// Relógio e sorteio são injetáveis, para os testes serem determinísticos.

const crypto = require('crypto');
const DEFAULT_CONFIG = require('./config');
const { ROUNDS } = require('./rounds');

const STATE_VERSION = 2;

const PHASE = {
  LOBBY: 'lobby', // times entrando
  BET: 'bet', // só na rodada de aposta: times apostam antes de ver a pergunta
  QUESTION: 'question', // rodada aberta, times respondendo
  CLOSED: 'closed', // respostas travadas, esperando o apresentador revelar
  TWIST: 'twist', // crise narrada (rodada 6), resultado ainda escondido
  REVEAL: 'reveal', // melhor opção, explicação e placar atualizado
  FINAL: 'final', // resultado final
};

const DIFFICULTY_LABEL = { facil: 'Fácil', media: 'Média', dificil: 'Difícil' };

class GameError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

// Nome como aparece na tela: sem caracteres de controle e com espaços simples.
function cleanName(raw, maxLength) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

// Chave para bloquear duplicados: "Os Escaláveis" e "os  escalaveis" colidem.
function nameKey(name) {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function freshState() {
  return {
    version: STATE_VERSION,
    phase: PHASE.LOBBY,
    roundIndex: -1,
    seq: 0,
    teams: {}, // id -> team
    rounds: [], // estado de cada rodada já aberta, pelo índice
    log: [],
  };
}

class Game {
  constructor({ rounds = ROUNDS, config = DEFAULT_CONFIG, now = Date.now, random = Math.random, state } = {}) {
    this.roundsDef = rounds;
    this.config = config;
    this.now = now;
    this.random = random;
    this.state = freshState();
    if (state) this.load(state);
  }

  // --- Persistência --------------------------------------------------------

  toJSON() {
    return this.state;
  }

  // Retorna false se o arquivo não for compatível (o jogo começa do zero).
  load(saved) {
    if (!saved || saved.version !== STATE_VERSION || !saved.teams || !Array.isArray(saved.rounds)) {
      return false;
    }
    if (saved.roundIndex >= this.roundsDef.length) return false;
    this.state = saved;
    return true;
  }

  reset({ keepTeams = false } = {}) {
    const old = this.state;
    this.state = freshState();
    if (keepTeams) {
      this.state.seq = old.seq;
      for (const t of Object.values(old.teams)) {
        this.state.teams[t.id] = this._newTeam(t.id, t.name, t.token, t.joinedAt);
      }
    }
    this._log(keepTeams ? 'Jogo reiniciado (times mantidos).' : 'Jogo reiniciado do zero.');
  }

  // --- Times ---------------------------------------------------------------

  _newTeam(id, name, token, joinedAt) {
    const v = this.config.STARTING_VALUATION;
    return { id, name, token, joinedAt, valuation: v, lowest: v, totalAnswerMs: 0 };
  }

  _validateName(raw, ignoreId) {
    const name = cleanName(raw, this.config.MAX_NAME_LENGTH);
    const key = nameKey(name);
    if (!key) throw new GameError('invalid_name');
    const taken = Object.values(this.state.teams).some((t) => t.id !== ignoreId && nameKey(t.name) === key);
    if (taken) throw new GameError('name_taken');
    return name;
  }

  join(rawName) {
    if (this.state.phase === PHASE.FINAL) throw new GameError('game_finished');
    const name = this._validateName(rawName);
    if (Object.keys(this.state.teams).length >= this.config.MAX_TEAMS) throw new GameError('game_full');

    this.state.seq += 1;
    const id = `t${this.state.seq}`;
    const token = crypto.randomBytes(16).toString('hex');
    const team = this._newTeam(id, name, token, this.now());
    this.state.teams[id] = team;

    // Entrou com a rodada aberta: ganha a ordem embaralhada dela também.
    const rs = this._rs();
    if (rs && !rs.orders[id]) rs.orders[id] = this._shuffledIds(this.currentRound);

    this._log(`Time "${name}" entrou.`);
    return team;
  }

  resume(token) {
    if (typeof token !== 'string' || !token) return null;
    return Object.values(this.state.teams).find((t) => t.token === token) || null;
  }

  getTeam(id) {
    return this.state.teams[id] || null;
  }

  removeTeam(id) {
    const team = this.state.teams[id];
    if (!team) throw new GameError('unknown_team');
    delete this.state.teams[id];
    for (const rs of this.state.rounds) {
      if (!rs) continue;
      delete rs.orders[id];
      delete rs.answers[id];
      delete rs.bets[id];
      delete rs.results[id];
      if (rs.participants) rs.participants = rs.participants.filter((p) => p !== id);
    }
    this._log(`Time "${team.name}" removido pelo operador.`);
  }

  renameTeam(id, rawName) {
    const team = this.state.teams[id];
    if (!team) throw new GameError('unknown_team');
    const name = this._validateName(rawName, id);
    this._log(`Time "${team.name}" renomeado para "${name}".`);
    team.name = name;
  }

  // --- Rodadas -------------------------------------------------------------

  get phase() {
    return this.state.phase;
  }

  get currentRound() {
    return this.roundsDef[this.state.roundIndex] || null;
  }

  _rs() {
    if (this.state.phase === PHASE.LOBBY || this.state.phase === PHASE.FINAL) return null;
    return this.state.rounds[this.state.roundIndex] || null;
  }

  roundDuration(index = this.state.roundIndex) {
    return this.config.ROUND_DURATION_MS[index + 1] || this.config.DEFAULT_ROUND_DURATION_MS;
  }

  _shuffledIds(round) {
    const ids = round.options.map((o) => o.id);
    for (let i = ids.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    return ids;
  }

  // Ordem do telão: embaralhada, e nunca a do rounds.js, onde a melhor opção
  // vem sempre primeiro (o telão entregaria a resposta).
  _projectorOrder(round) {
    const canonical = round.options.map((o) => o.id);
    const ids = this._shuffledIds(round);
    if (ids.every((id, i) => id === canonical[i])) ids.push(ids.shift());
    return ids;
  }

  // Ação principal do operador. `expect` evita que um clique duplo pule etapas:
  // se o jogo já mudou de fase, a ação é recusada.
  advance(expect) {
    const { phase, roundIndex } = this.state;
    if (expect && (expect.phase !== phase || expect.roundIndex !== roundIndex)) {
      throw new GameError('stale_action');
    }
    switch (phase) {
      case PHASE.LOBBY:
        return this._openRound(0);
      case PHASE.BET:
        return this._closeBets();
      case PHASE.QUESTION:
        return this._closeAnswers();
      case PHASE.CLOSED:
        return this.currentRound.twist ? this._showTwist() : this._reveal();
      case PHASE.TWIST:
        return this._reveal();
      case PHASE.REVEAL:
        if (roundIndex + 1 >= this.roundsDef.length) return this._finish();
        return this._openRound(roundIndex + 1);
      default:
        throw new GameError('game_over');
    }
  }

  nextActionLabel() {
    const { phase, roundIndex } = this.state;
    const round = this.currentRound;
    switch (phase) {
      case PHASE.LOBBY:
        return 'Começar rodada 1';
      case PHASE.BET:
        return 'Encerrar apostas e mostrar a pergunta';
      case PHASE.QUESTION:
        return 'Encerrar respostas agora';
      case PHASE.CLOSED:
        return round.twist ? 'Revelar a crise' : 'Revelar a resposta';
      case PHASE.TWIST:
        return 'Mostrar o resultado';
      case PHASE.REVEAL:
        return roundIndex + 1 >= this.roundsDef.length ? 'Mostrar resultado final' : `Começar rodada ${roundIndex + 2}`;
      default:
        return null;
    }
  }

  _openRound(index) {
    const round = this.roundsDef[index];
    const rs = {
      index,
      openedAt: null,
      deadline: null,
      betOpenedAt: null,
      betDeadline: null,
      closedAt: null,
      orders: {},
      bets: {},
      answers: {},
      participants: null,
      results: {},
      event: null,
    };
    for (const id of Object.keys(this.state.teams)) rs.orders[id] = this._shuffledIds(round);
    rs.projectorOrder = this._projectorOrder(round);
    this.state.rounds[index] = rs;
    this.state.roundIndex = index;

    if (round.bet) {
      const now = this.now();
      rs.betOpenedAt = now;
      rs.betDeadline = now + this.config.BET_DURATION_MS;
      this.state.phase = PHASE.BET;
      this._log(`Rodada ${index + 1} (${round.moment}): apostas abertas.`);
    } else {
      this._openQuestion();
    }
  }

  _openQuestion() {
    const rs = this.state.rounds[this.state.roundIndex];
    const now = this.now();
    rs.openedAt = now;
    rs.deadline = now + this.roundDuration();
    this.state.phase = PHASE.QUESTION;
    this._log(`Rodada ${rs.index + 1} (${this.currentRound.moment}): pergunta aberta.`);
  }

  _closeBets() {
    this._log(`Apostas encerradas (${Object.keys(this._rs().bets).length} apostas).`);
    this._openQuestion();
  }

  _closeAnswers() {
    const rs = this._rs();
    rs.closedAt = this.now();
    rs.participants = Object.keys(this.state.teams);
    this.state.phase = PHASE.CLOSED;
    const answered = rs.participants.filter((id) => rs.answers[id]).length;
    this._log(`Respostas encerradas: ${answered}/${rs.participants.length} responderam.`);
  }

  _showTwist() {
    this.state.phase = PHASE.TWIST;
    this._log(`Crise revelada: ${this.currentRound.twist.title}.`);
  }

  _reveal() {
    const round = this.currentRound;
    const rs = this._rs();
    const cfg = this.config;
    const byId = Object.fromEntries(round.options.map((o) => [o.id, o]));
    const worst = round.options.find((o) => o.tier === 'worst');
    const duration = this.roundDuration();

    for (const teamId of rs.participants) {
      const team = this.state.teams[teamId];
      if (!team) continue;
      // Resposta com id desconhecido (rounds.js editado com jogo salvo) vira "sem resposta".
      const answer = rs.answers[teamId] && byId[rs.answers[teamId].optionId] ? rs.answers[teamId] : null;
      const option = answer ? byId[answer.optionId] : worst;
      const answerMs = answer ? Math.max(0, answer.at - rs.openedAt) : duration;
      const before = team.valuation;
      const result = {
        optionId: option.id,
        tier: option.tier,
        auto: !answer,
        answerMs: answer ? answerMs : null,
        before,
        multiplier: null,
        speedBonus: false,
        bet: null,
        after: before,
      };

      if (round.bet) {
        const fraction = rs.bets[teamId] ? rs.bets[teamId].fraction : cfg.DEFAULT_BET_FRACTION;
        const stake = Math.round(before * fraction);
        const back = Math.round(stake * cfg.STAKE_RETURN[option.tier]);
        result.bet = { fraction, stake, auto: !rs.bets[teamId], delta: back - stake };
        result.after = before - stake + back;
      } else {
        let multiplier = cfg.MULTIPLIERS[round.difficulty][option.tier];
        result.multiplier = multiplier;
        const fast = answer && answerMs <= cfg.SPEED_BONUS_WINDOW_MS;
        if (fast && (!cfg.SPEED_BONUS_ONLY_BEST || option.tier === 'best')) {
          result.speedBonus = true;
          multiplier *= cfg.SPEED_BONUS_MULTIPLIER;
        }
        result.after = Math.round(before * multiplier);
      }

      team.valuation = result.after;
      team.lowest = Math.min(team.lowest, team.valuation);
      team.totalAnswerMs += answerMs;
      rs.results[teamId] = result;
    }

    rs.event = this._drawEvent(round, rs);
    this.state.phase = PHASE.REVEAL;
    const best = round.options.find((o) => o.tier === 'best');
    this._log(`Rodada ${rs.index + 1} revelada. Melhor opção: ${best.label}.`);
    if (rs.event) {
      const sign = rs.event.pct > 0 ? '+' : '';
      this._log(`Evento: ${rs.event.label} "${rs.event.teamName}" (${sign}${Math.round(rs.event.pct * 100)}%).`);
    }
  }

  _drawEvent(round, rs) {
    const cfg = this.config;
    if (!cfg.EVENTS_ENABLED || round.bet || !cfg.EVENTS.length) return null;
    const candidates = rs.participants.filter((id) => this.state.teams[id]);
    if (!candidates.length) return null;
    const team = this.state.teams[candidates[Math.floor(this.random() * candidates.length)]];
    const ev = cfg.EVENTS[Math.floor(this.random() * cfg.EVENTS.length)];
    const before = team.valuation;
    team.valuation = Math.round(before * (1 + ev.pct));
    team.lowest = Math.min(team.lowest, team.valuation);
    return { teamId: team.id, teamName: team.name, id: ev.id, label: ev.label, pct: ev.pct, before, after: team.valuation };
  }

  _finish() {
    this.state.phase = PHASE.FINAL;
    const top = this.ranking()[0];
    this._log(top ? `Jogo encerrado. Vencedor: "${top.name}".` : 'Jogo encerrado.');
  }

  // Encerra apostas ou respostas quando o prazo passa. Chamado pelo servidor
  // a cada fração de segundo; retorna true se algo mudou.
  tick() {
    const rs = this._rs();
    const now = this.now();
    const grace = this.config.ANSWER_GRACE_MS;
    if (this.state.phase === PHASE.BET && now > rs.betDeadline + grace) {
      this._closeBets();
      return true;
    }
    if (this.state.phase === PHASE.QUESTION && now > rs.deadline + grace) {
      this._closeAnswers();
      return true;
    }
    return false;
  }

  extendTimer(ms) {
    const rs = this._rs();
    const now = this.now();
    if (this.state.phase === PHASE.BET) {
      rs.betDeadline = Math.max(rs.betDeadline, now) + ms;
    } else if (this.state.phase === PHASE.QUESTION) {
      rs.deadline = Math.max(rs.deadline, now) + ms;
    } else {
      throw new GameError('no_timer');
    }
    this._log(`Tempo estendido em ${Math.round(ms / 1000)} s.`);
  }

  submitBet(teamId, fraction) {
    if (this.state.phase !== PHASE.BET) throw new GameError('bet_not_open');
    const rs = this._rs();
    if (!this.state.teams[teamId]) throw new GameError('unknown_team');
    if (this.now() > rs.betDeadline + this.config.ANSWER_GRACE_MS) throw new GameError('time_up');
    if (!this.config.BET_FRACTIONS.includes(fraction)) throw new GameError('invalid_bet');
    // Aposta pode ser trocada até o fim do prazo: não há bônus de velocidade aqui.
    rs.bets[teamId] = { fraction, at: this.now() };
  }

  submitAnswer(teamId, optionId) {
    if (this.state.phase !== PHASE.QUESTION) throw new GameError('round_not_open');
    const rs = this._rs();
    if (!this.state.teams[teamId]) throw new GameError('unknown_team');
    if (this.now() > rs.deadline + this.config.ANSWER_GRACE_MS) throw new GameError('time_up');
    if (rs.answers[teamId]) throw new GameError('already_answered');
    if (!this.currentRound.options.some((o) => o.id === optionId)) throw new GameError('invalid_option');
    rs.answers[teamId] = { optionId, at: this.now() };
  }

  // --- Ranking e resultado -------------------------------------------------

  // Empate no valuation: vence quem respondeu mais rápido no total.
  ranking() {
    return Object.values(this.state.teams)
      .sort((a, b) => b.valuation - a.valuation || a.totalAnswerMs - b.totalAnswerMs || a.joinedAt - b.joinedAt)
      .map((t, i) => ({ position: i + 1, id: t.id, name: t.name, valuation: t.valuation }));
  }

  rankingVisible() {
    const { phase, roundIndex } = this.state;
    if (phase === PHASE.FINAL || phase === PHASE.LOBBY) return true;
    return roundIndex + 1 < this.config.HIDE_RANKING_FROM_ROUND;
  }

  tierFor(team) {
    const cfg = this.config;
    if (team.lowest < cfg.BANKRUPT_BELOW && team.valuation >= cfg.PHOENIX_MIN) {
      return { ...cfg.PHOENIX };
    }
    const tier = cfg.TIERS.find((t) => team.valuation >= t.min) || cfg.TIERS[cfg.TIERS.length - 1];
    return { name: tier.name, emoji: tier.emoji, message: tier.message };
  }

  finalStandings() {
    return this.ranking().map((r) => ({ ...r, tier: this.tierFor(this.state.teams[r.id]) }));
  }

  // --- O que cada tela vê --------------------------------------------------
  // Nada de faixa, multiplicador ou resposta certa sai do servidor antes da
  // revelação, e o ranking não sai nas rodadas em suspense.

  _publicRound({ withQuestion }) {
    const round = this.currentRound;
    const index = this.state.roundIndex;
    const base = {
      number: index + 1,
      total: this.roundsDef.length,
      moment: round.moment,
      difficulty: round.difficulty,
      difficultyLabel: DIFFICULTY_LABEL[round.difficulty],
      bet: !!round.bet,
      narration: round.narration,
    };
    if (!withQuestion) return base;
    return { ...base, title: round.title, scenario: round.scenario };
  }

  _timer() {
    const rs = this._rs();
    const now = this.now();
    if (this.state.phase === PHASE.BET) {
      return { remainingMs: Math.max(0, rs.betDeadline - now), durationMs: this.config.BET_DURATION_MS };
    }
    if (this.state.phase === PHASE.QUESTION) {
      return { remainingMs: Math.max(0, rs.deadline - now), durationMs: this.roundDuration() };
    }
    return null;
  }

  _optionText(round, optionId) {
    if (round.twist) return round.twist.outcomes[optionId];
    return round.options.find((o) => o.id === optionId).feedback;
  }

  _revealCommon() {
    const round = this.currentRound;
    const rs = this._rs();
    const best = round.options.find((o) => o.tier === 'best');
    const distribution = Object.fromEntries(round.options.map((o) => [o.id, 0]));
    let noAnswer = 0;
    let speedBonusCount = 0;
    for (const r of Object.values(rs.results)) {
      distribution[r.optionId] += 1;
      if (r.auto) noAnswer += 1;
      if (r.speedBonus) speedBonusCount += 1;
    }
    return {
      bestOptionId: best.id,
      bestLabel: best.label,
      explanation: round.explanation,
      distribution,
      noAnswer,
      speedBonusCount,
      event: rs.event ? { teamName: rs.event.teamName, label: rs.event.label, pct: rs.event.pct } : null,
    };
  }

  viewForTeam(teamId) {
    const team = this.state.teams[teamId];
    if (!team) return null;
    const { phase } = this.state;
    const round = this.currentRound;
    const rs = this._rs();
    const visible = this.rankingVisible();
    const ranking = this.ranking();
    const me = ranking.find((r) => r.id === teamId);

    const view = {
      role: 'team',
      phase,
      team: { id: team.id, name: team.name, valuation: team.valuation },
      teamCount: ranking.length,
      position: visible ? me.position : null,
      totalRounds: this.roundsDef.length,
      round: null,
      timer: this._timer(),
    };

    if (phase === PHASE.FINAL) {
      view.final = {
        position: me.position,
        teamCount: ranking.length,
        tier: this.tierFor(team),
        winnerName: ranking[0].name,
      };
      return view;
    }
    if (!rs) return view;

    const withQuestion = phase !== PHASE.BET;
    view.round = this._publicRound({ withQuestion });

    if (round.bet) {
      const bet = rs.bets[teamId];
      view.bet = {
        fractions: this.config.BET_FRACTIONS,
        defaultFraction: this.config.DEFAULT_BET_FRACTION,
        choice: bet ? bet.fraction : null,
      };
    }

    if (withQuestion) {
      const byId = Object.fromEntries(round.options.map((o) => [o.id, o]));
      const saved = rs.orders[teamId];
      const order = saved && saved.length === round.options.length && saved.every((id) => byId[id]) ? saved : Object.keys(byId);
      view.options = order.map((id) => ({ id, label: byId[id].label }));
      const answer = rs.answers[teamId];
      view.myAnswer = answer ? answer.optionId : null;
      // Rodadas sem aposta mostram a janela do bônus de velocidade.
      if (phase === PHASE.QUESTION && !round.bet) {
        view.speedBonusRemainingMs = Math.max(0, rs.openedAt + this.config.SPEED_BONUS_WINDOW_MS - this.now());
      }
      view.participating = !rs.participants || rs.participants.includes(teamId);
    }

    if ((phase === PHASE.TWIST || phase === PHASE.REVEAL) && round.twist) {
      view.twist = { title: round.twist.title, narration: round.twist.narration };
    }

    if (phase === PHASE.REVEAL) {
      const common = this._revealCommon();
      const r = rs.results[teamId];
      view.reveal = {
        bestOptionId: common.bestOptionId,
        bestLabel: common.bestLabel,
        explanation: common.explanation,
        event: common.event,
      };
      if (r) {
        const option = round.options.find((o) => o.id === r.optionId);
        view.result = {
          optionId: r.optionId,
          optionLabel: option.label,
          tier: r.tier,
          auto: r.auto,
          text: this._optionText(round, r.optionId),
          before: r.before,
          after: r.after,
          multiplier: r.multiplier,
          speedBonus: r.speedBonus,
          speedBonusMultiplier: this.config.SPEED_BONUS_MULTIPLIER,
          bet: r.bet,
          event: rs.event && rs.event.teamId === teamId ? { label: rs.event.label, pct: rs.event.pct, after: rs.event.after } : null,
        };
      }
    }
    return view;
  }

  viewForProjector() {
    const { phase } = this.state;
    const round = this.currentRound;
    const rs = this._rs();
    const visible = this.rankingVisible();
    const view = {
      role: 'projector',
      phase,
      totalRounds: this.roundsDef.length,
      teamCount: Object.keys(this.state.teams).length,
      rankingVisible: visible,
      ranking: visible ? this.ranking() : null,
      timer: this._timer(),
      round: null,
    };

    if (phase === PHASE.LOBBY) {
      view.teams = Object.values(this.state.teams)
        .sort((a, b) => a.joinedAt - b.joinedAt)
        .map((t) => t.name);
      return view;
    }
    if (phase === PHASE.FINAL) {
      view.final = this.finalStandings();
      view.prize = this.config.PRIZE_TEXT || '';
      return view;
    }

    const withQuestion = phase !== PHASE.BET;
    view.round = this._publicRound({ withQuestion });
    if (withQuestion) {
      const byId = Object.fromEntries(round.options.map((o) => [o.id, o]));
      const saved = rs.projectorOrder;
      const order =
        saved && saved.length === round.options.length && saved.every((id) => byId[id]) ? saved : this._projectorOrder(round);
      view.options = order.map((id) => ({ id, label: byId[id].label }));
    }
    view.answeredCount = Object.keys(rs.answers).length;
    view.betCount = Object.keys(rs.bets).length;

    if ((phase === PHASE.TWIST || phase === PHASE.REVEAL) && round.twist) {
      view.twist = { title: round.twist.title, narration: round.twist.narration };
    }
    if (phase === PHASE.REVEAL) {
      view.reveal = {
        ...this._revealCommon(),
        optionTexts: Object.fromEntries(round.options.map((o) => [o.id, this._optionText(round, o.id)])),
      };
    }
    return view;
  }

  viewForAdmin(connections = {}) {
    const { phase, roundIndex } = this.state;
    const round = this.currentRound;
    const rs = this.state.rounds[roundIndex] || null;
    const ranking = this.ranking();
    const view = {
      role: 'admin',
      phase,
      roundIndex,
      totalRounds: this.roundsDef.length,
      nextAction: this.nextActionLabel(),
      timer: this._timer(),
      rankingVisibleOnProjector: this.rankingVisible(),
      round: null,
      teams: ranking.map((r) => {
        const t = this.state.teams[r.id];
        const row = {
          ...r,
          lowest: t.lowest,
          connected: connections[r.id] || 0,
          answer: null,
          bet: null,
          result: null,
        };
        if (rs && phase !== PHASE.LOBBY) {
          const a = rs.answers[r.id];
          if (a) row.answer = { optionId: a.optionId, ms: rs.openedAt ? a.at - rs.openedAt : null };
          if (rs.bets[r.id]) row.bet = rs.bets[r.id].fraction;
          if (rs.results[r.id]) row.result = rs.results[r.id];
        }
        if (phase === PHASE.FINAL) row.tier = this.tierFor(t);
        return row;
      }),
      log: this.state.log.slice(-60),
    };

    if (round && phase !== PHASE.FINAL) {
      const mult = this.config.MULTIPLIERS[round.difficulty];
      view.round = {
        ...this._publicRound({ withQuestion: true }),
        options: round.options.map((o) => ({
          id: o.id,
          label: o.label,
          tier: o.tier,
          multiplier: round.bet ? null : mult[o.tier],
          stakeReturn: round.bet ? this.config.STAKE_RETURN[o.tier] : null,
          text: this._optionText(round, o.id),
        })),
        explanation: round.explanation,
        notes: round.notes || '',
        twist: round.twist ? { title: round.twist.title, narration: round.twist.narration } : null,
        answeredCount: rs ? Object.keys(rs.answers).length : 0,
        betCount: rs ? Object.keys(rs.bets).length : 0,
        event: rs ? rs.event : null,
      };
    }
    const next = this.roundsDef[roundIndex + 1];
    if (next && (phase === PHASE.REVEAL || phase === PHASE.LOBBY)) {
      view.nextRound = { number: roundIndex + 2, moment: next.moment, title: next.title };
    }
    return view;
  }

  _log(msg) {
    this.state.log.push({ at: this.now(), msg });
    if (this.state.log.length > 200) this.state.log.splice(0, this.state.log.length - 200);
  }
}

module.exports = { Game, GameError, PHASE, STATE_VERSION, cleanName, nameKey };
