const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, PHASE } = require('../gameEngine');
const { ROUNDS, validateRounds } = require('../rounds');
const config = require('../config');

// Relógio manual e sorteio previsível para os testes.
function setup({ events = false, random } = {}) {
  let t = 1_000_000;
  const clock = {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
  const cfg = { ...config, EVENTS_ENABLED: events };
  const game = new Game({ config: cfg, now: clock.now, random: random || (() => 0.42) });
  return { game, clock, cfg };
}

const tierId = (round, tier) => round.options.find((o) => o.tier === tier).id;

// Joga a rodada atual: cada time responde a faixa pedida depois de `ms`.
function playRound(game, clock, picks, { ms = 30000, bets = {} } = {}) {
  const round = game.currentRound;
  if (game.phase === PHASE.BET) {
    for (const [id, f] of Object.entries(bets)) game.submitBet(id, f);
    game.advance();
  }
  assert.equal(game.phase, PHASE.QUESTION);
  clock.advance(ms);
  for (const [id, tier] of Object.entries(picks)) {
    if (tier) game.submitAnswer(id, tierId(round, tier));
  }
  game.advance(); // fecha
  if (round.twist) {
    game.advance();
    assert.equal(game.phase, PHASE.TWIST);
  }
  game.advance(); // revela
  assert.equal(game.phase, PHASE.REVEAL);
}

test('rounds.js está completo e válido', () => {
  assert.equal(ROUNDS.length, 9);
  assert.deepEqual(validateRounds(ROUNDS), []);
  assert.ok(ROUNDS[5].twist, 'rodada 6 tem a crise');
  assert.ok(ROUNDS[8].bet, 'rodada 9 é a aposta');
});

test('validateRounds pega erros de formato', () => {
  const broken = [{ ...ROUNDS[0], options: ROUNDS[0].options.map((o) => ({ ...o, tier: 'best' })) }];
  assert.ok(validateRounds(broken).length > 0);
});

test('nomes: limpa, bloqueia duplicado sem diferenciar acento e caixa', () => {
  const { game } = setup();
  const t = game.join('  Os   Escaláveis \n');
  assert.equal(t.name, 'Os Escaláveis');
  assert.throws(() => game.join('os escalaveis'), { code: 'name_taken' });
  assert.throws(() => game.join('   '), { code: 'invalid_name' });
  assert.throws(() => game.join('!!!'), { code: 'invalid_name' });
  assert.throws(() => game.join(null), { code: 'invalid_name' });
  assert.equal(game.join('x'.repeat(100)).name.length, config.MAX_NAME_LENGTH);
});

test('token permite reconectar ao mesmo time', () => {
  const { game } = setup();
  const t = game.join('Time A');
  assert.equal(game.resume(t.token).id, t.id);
  assert.equal(game.resume('errado'), null);
  assert.equal(game.resume(undefined), null);
});

test('acertar as 8 primeiras sem bônus nem evento dá ~R$ 4,5 mi (conta do documento)', () => {
  const { game, clock } = setup();
  const a = game.join('A');
  game.advance();
  for (let i = 0; i < 8; i += 1) {
    playRound(game, clock, { [a.id]: 'best' }, { ms: 30000 });
    game.advance();
  }
  const v = game.getTeam(a.id).valuation;
  assert.ok(v > 4_400_000 && v < 4_550_000, `valuation ${v}`);
});

test('multiplicadores por dificuldade e sem resposta = pior opção', () => {
  const { game, clock } = setup();
  const best = game.join('best');
  const mid = game.join('mid');
  const none = game.join('none');
  game.advance();
  playRound(game, clock, { [best.id]: 'best', [mid.id]: 'mid' }, { ms: 30000 });
  assert.equal(game.getTeam(best.id).valuation, 150000);
  assert.equal(game.getTeam(mid.id).valuation, 110000);
  assert.equal(game.getTeam(none.id).valuation, 70000);
  const r = game.viewForTeam(none.id).result;
  assert.equal(r.auto, true);
  assert.equal(r.tier, 'worst');
});

test('bônus de velocidade: só na melhor opção e dentro de 25 s', () => {
  const { game, clock } = setup();
  const fastBest = game.join('fastBest');
  const fastWorst = game.join('fastWorst');
  game.advance();
  clock.advance(10000);
  game.submitAnswer(fastBest.id, tierId(game.currentRound, 'best'));
  game.submitAnswer(fastWorst.id, tierId(game.currentRound, 'worst'));
  game.advance();
  game.advance();
  assert.equal(game.getTeam(fastBest.id).valuation, Math.round(100000 * 1.5 * 1.1));
  assert.equal(game.getTeam(fastWorst.id).valuation, 70000);
  assert.equal(game.viewForTeam(fastBest.id).result.speedBonus, true);
});

test('resposta fora do prazo é recusada e o tick fecha a rodada', () => {
  const { game, clock } = setup();
  const a = game.join('A');
  game.advance();
  clock.advance(60000 + config.ANSWER_GRACE_MS + 1);
  assert.throws(() => game.submitAnswer(a.id, tierId(game.currentRound, 'best')), { code: 'time_up' });
  assert.equal(game.tick(), true);
  assert.equal(game.phase, PHASE.CLOSED);
});

test('resposta no limite (dentro da tolerância) é aceita', () => {
  const { game, clock } = setup();
  const a = game.join('A');
  game.advance();
  clock.advance(60000 + config.ANSWER_GRACE_MS - 1);
  game.submitAnswer(a.id, tierId(game.currentRound, 'best'));
  assert.equal(game.tick(), false);
});

test('não dá para responder duas vezes nem opção inexistente', () => {
  const { game } = setup();
  const a = game.join('A');
  game.advance();
  assert.throws(() => game.submitAnswer(a.id, 'nao-existe'), { code: 'invalid_option' });
  game.submitAnswer(a.id, tierId(game.currentRound, 'best'));
  assert.throws(() => game.submitAnswer(a.id, tierId(game.currentRound, 'mid')), { code: 'already_answered' });
  assert.throws(() => game.submitAnswer('t999', tierId(game.currentRound, 'mid')), { code: 'unknown_team' });
});

test('estender o tempo adia o fechamento', () => {
  const { game, clock } = setup();
  game.join('A');
  game.advance();
  clock.advance(59000);
  game.extendTimer(15000);
  clock.advance(5000);
  assert.equal(game.tick(), false);
  assert.ok(game.viewForProjector().timer.remainingMs > 9000);
});

test('clique duplo do operador não pula etapa', () => {
  const { game } = setup();
  game.join('A');
  const expect = { phase: game.phase, roundIndex: game.state.roundIndex };
  game.advance(expect);
  assert.throws(() => game.advance(expect), { code: 'stale_action' });
  assert.equal(game.state.roundIndex, 0);
});

test('ordem das opções é embaralhada por time e estável', () => {
  let i = 0;
  const seq = [0.1, 0.9, 0.5, 0.2, 0.7, 0.3, 0.8, 0.05];
  const { game } = setup({ random: () => seq[i++ % seq.length] });
  const a = game.join('A');
  const b = game.join('B');
  game.advance();
  const oa = game.viewForTeam(a.id).options.map((o) => o.id);
  const ob = game.viewForTeam(b.id).options.map((o) => o.id);
  assert.notDeepEqual(oa, ob);
  assert.deepEqual(game.viewForTeam(a.id).options.map((o) => o.id), oa);
  assert.deepEqual([...oa].sort(), game.currentRound.options.map((o) => o.id).sort());
});

test('nenhuma view pública vaza a resposta antes da revelação', () => {
  const { game } = setup();
  const a = game.join('A');
  game.advance();
  for (const view of [game.viewForTeam(a.id), game.viewForProjector()]) {
    const json = JSON.stringify(view);
    assert.ok(!json.includes('"tier"'), 'tier vazou');
    assert.ok(!json.includes('bestOptionId'), 'resposta vazou');
    assert.ok(!json.includes('feedback'), 'feedback vazou');
    assert.ok(!json.includes('notes'), 'notas do apresentador vazaram');
  }
});

test('rodada 6: crise entre o fechamento e o resultado, com o texto de cada escolha', () => {
  const { game, clock } = setup();
  const a = game.join('A');
  const b = game.join('B');
  game.advance();
  for (let i = 0; i < 5; i += 1) {
    playRound(game, clock, { [a.id]: 'best', [b.id]: 'best' });
    game.advance();
  }
  assert.ok(game.currentRound.twist);
  const before = game.getTeam(b.id).valuation;
  game.submitAnswer(a.id, tierId(game.currentRound, 'best'));
  game.submitAnswer(b.id, tierId(game.currentRound, 'mid'));
  game.advance(); // fecha
  assert.equal(game.phase, PHASE.CLOSED);
  assert.equal(game.viewForTeam(b.id).twist, undefined, 'crise não aparece antes');
  game.advance(); // crise
  assert.equal(game.phase, PHASE.TWIST);
  assert.equal(game.getTeam(b.id).valuation, before, 'valuation não muda na crise');
  assert.ok(game.viewForProjector().twist.title);
  game.advance(); // resultado
  const r = game.viewForTeam(b.id).result;
  assert.equal(r.text, game.currentRound.twist.outcomes[r.optionId]);
  assert.equal(game.getTeam(b.id).valuation, Math.round(before * 1.1));
});

test('bônus de velocidade usa o início da própria rodada', () => {
  const { game, clock } = setup();
  const a = game.join('A');
  game.advance();
  clock.advance(24000);
  game.submitAnswer(a.id, tierId(game.currentRound, 'best'));
  clock.advance(10 * 60 * 1000); // apresentador demora para revelar
  game.advance();
  game.advance();
  assert.equal(game.viewForTeam(a.id).result.speedBonus, true);
  game.advance(); // rodada 2
  clock.advance(40000);
  game.submitAnswer(a.id, tierId(game.currentRound, 'best'));
  game.advance();
  game.advance();
  assert.equal(game.viewForTeam(a.id).result.speedBonus, false);
});

test('rodada 9: aposta antes da pergunta, dobra, perde metade ou perde tudo', () => {
  const { game, clock } = setup();
  const w = game.join('win');
  const m = game.join('mid');
  const l = game.join('lose');
  const d = game.join('default');
  game.advance();
  for (let i = 0; i < 8; i += 1) {
    playRound(game, clock, { [w.id]: 'best', [m.id]: 'best', [l.id]: 'best', [d.id]: 'best' });
    game.advance();
  }
  assert.equal(game.phase, PHASE.BET);
  const tv = game.viewForTeam(w.id);
  assert.equal(tv.options, undefined, 'pergunta escondida durante a aposta');
  assert.equal(tv.round.scenario, undefined);
  assert.equal(game.viewForProjector().round.scenario, undefined);
  assert.throws(() => game.submitBet(w.id, 0.33), { code: 'invalid_bet' });
  assert.throws(() => game.submitAnswer(w.id, 'x'), { code: 'round_not_open' });

  const base = game.getTeam(w.id).valuation;
  game.submitBet(w.id, 0.25);
  game.submitBet(w.id, 1); // pode trocar
  game.submitBet(m.id, 0.5);
  game.submitBet(l.id, 0.75);
  clock.advance(config.BET_DURATION_MS + config.ANSWER_GRACE_MS + 1);
  assert.equal(game.tick(), true, 'prazo da aposta abre a pergunta');
  assert.equal(game.phase, PHASE.QUESTION);
  const round = game.currentRound;
  game.submitAnswer(w.id, tierId(round, 'best'));
  game.submitAnswer(m.id, tierId(round, 'mid'));
  game.submitAnswer(l.id, tierId(round, 'worst'));
  // d não responde: pior opção, com a aposta padrão
  game.advance();
  game.advance();
  assert.equal(game.getTeam(w.id).valuation, base * 2);
  assert.equal(game.getTeam(m.id).valuation, base - Math.round(base * 0.5) + Math.round(base * 0.5 * 0.5));
  assert.equal(game.getTeam(l.id).valuation, base - Math.round(base * 0.75));
  assert.equal(game.getTeam(d.id).valuation, base - Math.round(base * config.DEFAULT_BET_FRACTION));
  assert.equal(game.viewForTeam(d.id).result.bet.auto, true);
  assert.equal(game.viewForProjector().reveal.event, null, 'sem evento na aposta');
  assert.equal(game.viewForTeam(w.id).result.speedBonus, false, 'sem bônus na aposta');
  game.advance();
  assert.equal(game.phase, PHASE.FINAL);
});

test('evento aleatório atinge um time e entra no valuation', () => {
  const { game, clock } = setup({ events: true, random: () => 0 });
  const a = game.join('A');
  const b = game.join('B');
  game.advance();
  playRound(game, clock, { [a.id]: 'best', [b.id]: 'best' });
  const ev = game.viewForProjector().reveal.event;
  assert.equal(ev.teamName, 'A'); // random 0 -> primeiro time, primeiro evento
  assert.equal(ev.pct, config.EVENTS[0].pct);
  assert.equal(game.getTeam(a.id).valuation, Math.round(150000 * (1 + config.EVENTS[0].pct)));
  assert.equal(game.getTeam(b.id).valuation, 150000);
  assert.ok(game.viewForTeam(a.id).result.event);
  assert.equal(game.viewForTeam(b.id).result.event, null);
});

test('ranking some do projetor e do celular nas rodadas 7 a 9 e volta no final', () => {
  const { game, clock } = setup();
  const a = game.join('A');
  game.advance();
  for (let i = 0; i < 6; i += 1) {
    playRound(game, clock, { [a.id]: 'best' });
    assert.ok(game.viewForProjector().ranking, `visível na rodada ${i + 1}`);
    game.advance();
  }
  assert.equal(game.state.roundIndex, 6);
  assert.equal(game.viewForProjector().ranking, null);
  assert.equal(game.viewForTeam(a.id).position, null);
  playRound(game, clock, { [a.id]: 'best' });
  assert.equal(game.viewForProjector().ranking, null);
  game.advance();
  playRound(game, clock, { [a.id]: 'best' });
  game.advance();
  playRound(game, clock, { [a.id]: 'best' });
  game.advance();
  assert.equal(game.phase, PHASE.FINAL);
  assert.ok(game.viewForProjector().final.length === 1);
  assert.equal(game.viewForTeam(a.id).final.position, 1);
});

test('faixas finais e Fênix', () => {
  const { game } = setup();
  const t = game.join('A');
  const team = game.getTeam(t.id);
  const tier = (v, lowest = v) => {
    team.valuation = v;
    team.lowest = lowest;
    return game.tierFor(team).name;
  };
  assert.equal(tier(49999), 'Faliu');
  assert.equal(tier(50000), 'Sobreviveu');
  assert.equal(tier(299999), 'Sobreviveu');
  assert.equal(tier(300000), 'Rodada Seed');
  assert.equal(tier(1500000), 'Série A');
  assert.equal(tier(5000000), 'Unicórnio');
  assert.equal(tier(300000, 49999), 'Fênix');
  assert.equal(tier(299999, 49999), 'Sobreviveu');
  assert.equal(tier(300000, 50000), 'Rodada Seed');
});

test('empate no valuation: vence quem respondeu mais rápido no total', () => {
  const { game, clock } = setup();
  const slow = game.join('Lento');
  const fast = game.join('Rápido');
  game.advance();
  clock.advance(26000); // fora da janela do bônus
  game.submitAnswer(fast.id, tierId(game.currentRound, 'mid'));
  clock.advance(20000);
  game.submitAnswer(slow.id, tierId(game.currentRound, 'mid'));
  game.advance();
  game.advance();
  assert.equal(game.ranking()[0].id, fast.id);
});

test('time que entra depois do fechamento não leva pior opção naquela rodada', () => {
  const { game } = setup();
  const a = game.join('A');
  game.advance();
  game.submitAnswer(a.id, tierId(game.currentRound, 'best'));
  game.advance(); // fecha
  const late = game.join('Atrasado');
  game.advance(); // revela
  assert.equal(game.getTeam(late.id).valuation, config.STARTING_VALUATION);
  assert.equal(game.viewForTeam(late.id).result, undefined);
  game.advance(); // rodada 2: atrasado já participa
  assert.equal(game.viewForTeam(late.id).options.length, 3);
});

test('time que entra com a rodada aberta recebe as opções', () => {
  const { game } = setup();
  game.join('A');
  game.advance();
  const late = game.join('B');
  assert.equal(game.viewForTeam(late.id).options.length, 3);
  game.submitAnswer(late.id, tierId(game.currentRound, 'best'));
});

test('remover e renomear time', () => {
  const { game } = setup();
  const a = game.join('A');
  const b = game.join('B');
  game.advance();
  game.submitAnswer(a.id, tierId(game.currentRound, 'best'));
  game.removeTeam(a.id);
  assert.equal(game.getTeam(a.id), null);
  assert.equal(game.viewForProjector().answeredCount, 0);
  game.join('C');
  assert.throws(() => game.renameTeam(b.id, 'c'), { code: 'name_taken' });
  game.renameTeam(b.id, 'b'); // trocar só a caixa do próprio nome pode
  game.renameTeam(b.id, 'Nome Novo');
  assert.equal(game.getTeam(b.id).name, 'Nome Novo');
  game.join('A'); // nome liberado
});

test('estado sobrevive a salvar e carregar (reinício do processo)', () => {
  const { game, clock, cfg } = setup();
  const a = game.join('A');
  game.advance();
  game.submitAnswer(a.id, tierId(game.currentRound, 'best'));
  const json = JSON.parse(JSON.stringify(game.toJSON()));

  const restored = new Game({ config: cfg, now: clock.now });
  assert.equal(restored.load(json), true);
  assert.equal(restored.phase, PHASE.QUESTION);
  assert.equal(restored.resume(a.token).id, a.id);
  assert.throws(() => restored.submitAnswer(a.id, tierId(restored.currentRound, 'mid')), { code: 'already_answered' });
  clock.advance(120000);
  assert.equal(restored.tick(), true);
  restored.advance();
  assert.ok(restored.getTeam(a.id).valuation > 100000);

  assert.equal(new Game({ config: cfg }).load({ version: 1 }), false);
});

test('reiniciar mantendo times zera valuation e preserva tokens', () => {
  const { game, clock } = setup();
  const a = game.join('A');
  game.advance();
  playRound(game, clock, { [a.id]: 'best' });
  game.reset({ keepTeams: true });
  assert.equal(game.phase, PHASE.LOBBY);
  assert.equal(game.resume(a.token).valuation, config.STARTING_VALUATION);
  game.reset();
  assert.equal(game.resume(a.token), null);
});

test('não entra time depois do fim', () => {
  const { game, clock } = setup();
  const a = game.join('A');
  game.advance();
  for (let i = 0; i < 9; i += 1) {
    playRound(game, clock, { [a.id]: 'best' }, { bets: { [a.id]: 0.25 } });
    game.advance();
  }
  assert.equal(game.phase, PHASE.FINAL);
  assert.throws(() => game.join('B'), { code: 'game_finished' });
  assert.throws(() => game.advance(), { code: 'game_over' });
});

test('rounds.js editado com jogo salvo não derruba a revelação', () => {
  const { game, clock, cfg } = setup();
  const a = game.join('A');
  game.advance();
  game.submitAnswer(a.id, tierId(game.currentRound, 'best'));
  const saved = JSON.parse(JSON.stringify(game.toJSON()));

  const edited = ROUNDS.map((r, i) =>
    i === 0 ? { ...r, options: r.options.map((o) => ({ ...o, id: `${o.id}-novo` })) } : r
  );
  const restored = new Game({ rounds: edited, config: cfg, now: clock.now });
  assert.equal(restored.load(saved), true);
  assert.equal(restored.viewForTeam(a.id).options.length, 3);
  restored.advance();
  restored.advance();
  assert.equal(restored.viewForTeam(a.id).result.auto, true);
});
