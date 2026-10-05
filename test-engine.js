// test-engine.js — teste manual rápido, roda com: node test-engine.js
const { GameEngine } = require('./gameEngine');

const game = new GameEngine();

const teamA = game.addTeam('t1', 'Os Escaláveis'); // sempre acerta
const teamB = game.addTeam('t2', 'Mediana Capital'); // sempre opção mediana
const teamC = game.addTeam('t3', 'Falência Ltda'); // sempre erra

console.log('--- Início ---');
console.log(game.getRanking());

function playRound(answers, { closeAsDelayed } = {}) {
  const round = game.startNextRound();
  console.log(`\n=== Rodada ${round.id}: ${round.title} (${round.resolution}) ===`);
  for (const [teamId, optionId] of Object.entries(answers)) {
    const res = game.submitAnswer(teamId, optionId);
    if (!res.ok) console.log(`  ERRO ao responder ${teamId}: ${res.reason}`);
  }
  const result = game.closeRound();
  console.log('  Fechou. applied =', result.applied);
  console.log('  Ranking agora:', game.getRanking());
  return round;
}

// Rodada 1 — todos respondem na hora (sem testar bônus de velocidade aqui)
playRound({ t1: 'a', t2: 'b', t3: 'c' });

// Rodada 2
playRound({ t1: 'a', t2: 'b', t3: 'c' });

// Rodada 6 — resolution 'delayed': valuation NÃO muda até resolveDelayedRound
const round6 = playRound({ t1: 'a', t2: 'b', t3: 'c' });
console.log('  (esperado: ranking IGUAL ao anterior, pois é delayed)');

console.log('\n=== Revelando resultado atrasado da rodada 6 ===');
const delayedResult = game.resolveDelayedRound(round6.id);
console.log('  Narração:', delayedResult.round.delayedNarration);
console.log('  Outcomes:', delayedResult.outcomes);
console.log('  Ranking final:', game.getRanking());

console.log('\n=== Resultados finais ===');
for (const team of game.listTeams()) {
  console.log(`  ${team.name}: R$ ${team.valuation.toLocaleString('pt-BR')} -> ${game.getFinalResult(team)}`);
}

console.log('\n--- Teste de nome duplicado ---');
try {
  game.addTeam('t4', 'Os Escaláveis');
  console.log('  ERRO: deveria ter bloqueado nome duplicado');
} catch (e) {
  console.log('  OK, bloqueado:', e.message);
}

console.log('\n--- Teste de responder duas vezes ---');
game.startNextRound(); // não existe rodada 3 nesse protótipo -> deve retornar null e marcar FINISHED
