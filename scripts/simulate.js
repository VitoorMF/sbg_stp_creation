// scripts/simulate.js — "conta no papel" automática, para calibrar
// multiplicadores e faixas em config.js depois do teste com o core team.
// Uso: node scripts/simulate.js
//
// Joga o jogo inteiro com a engine de verdade (relógio falso) e imprime:
//   1. estratégias fixas (acerta tudo, erra duas etc.), sem bônus nem evento;
//   2. a distribuição de faixas para um time que acerta ~2/3 das rodadas,
//      com bônus, eventos e aposta, como no dia.

const { Game, PHASE } = require('../gameEngine');
const config = require('../config');

const fmt = (v) => `R$ ${Math.round(v).toLocaleString('pt-BR')}`;

function play(picksForRound, { events = false, fastMs = 30000, betFraction = 0.5, random = Math.random } = {}) {
  let t = 0;
  const game = new Game({ config: { ...config, EVENTS_ENABLED: events }, now: () => t, random });
  const team = game.join('Simulado');
  game.join('Outro time'); // evento sorteado nem sempre cai no mesmo time
  game.advance();
  for (let i = 0; i < game.roundsDef.length; i += 1) {
    const round = game.currentRound;
    if (game.phase === PHASE.BET) {
      game.submitBet(team.id, betFraction);
      game.advance();
    }
    t += fastMs;
    const tier = picksForRound(i);
    if (tier) game.submitAnswer(team.id, round.options.find((o) => o.tier === tier).id);
    game.advance();
    if (round.twist) game.advance();
    game.advance();
    game.advance();
  }
  const final = game.getTeam(team.id);
  return { valuation: final.valuation, tier: game.tierFor(final).name, lowest: final.lowest };
}

console.log('Estratégias fixas (sem bônus de velocidade, sem eventos, aposta de 50%)\n');
const fixed = [
  ['Acerta tudo', () => 'best'],
  ['Acerta as 8 primeiras, erra a aposta', (i) => (i < 8 ? 'best' : 'worst')],
  ['Mediana nas rodadas 4 e 7', (i) => (i === 3 || i === 6 ? 'mid' : 'best')],
  ['Pior nas rodadas 2 e 5', (i) => (i === 1 || i === 4 ? 'worst' : 'best')],
  ['Pior nas rodadas 7 e 8 (difíceis)', (i) => (i === 6 || i === 7 ? 'worst' : 'best')],
  ['Sempre a mediana', () => 'mid'],
  ['Sempre a pior', () => 'worst'],
  ['Não responde nada', () => null],
  ['Começa mal (1-5 pior), termina bem', (i) => (i < 5 ? 'worst' : 'best')],
];
for (const [name, fn] of fixed) {
  const r = play(fn);
  console.log(`  ${name.padEnd(38)} ${fmt(r.valuation).padStart(16)}  ${r.tier}`);
}

console.log('\nAntes da aposta final, acertando as 8 primeiras: (o documento estima ~R$ 4,5 mi)');
{
  let t = 0;
  const game = new Game({ config: { ...config, EVENTS_ENABLED: false }, now: () => t });
  const team = game.join('A');
  game.advance();
  for (let i = 0; i < 8; i += 1) {
    t += 30000;
    game.submitAnswer(team.id, game.currentRound.options.find((o) => o.tier === 'best').id);
    game.advance();
    if (game.currentRound.twist) game.advance();
    game.advance();
    game.advance();
  }
  console.log(`  ${fmt(game.getTeam(team.id).valuation)}`);
}

// Time "que prestou atenção": acerta cada rodada com 2/3 de chance; quando
// erra, metade das vezes cai na mediana. Responde rápido em metade das vezes.
const N = 20000;
console.log(`\nMonte Carlo: ${N} partidas de um time que acerta ~2/3 (com bônus, eventos e aposta aleatória)\n`);
const counts = {};
const values = [];
for (let n = 0; n < N; n += 1) {
  const fast = Math.random() < 0.5 ? 10000 : 40000;
  const bet = config.BET_FRACTIONS[Math.floor(Math.random() * config.BET_FRACTIONS.length)];
  const r = play(
    () => {
      const x = Math.random();
      return x < 2 / 3 ? 'best' : x < 5 / 6 ? 'mid' : 'worst';
    },
    { events: true, fastMs: fast, betFraction: bet }
  );
  counts[r.tier] = (counts[r.tier] || 0) + 1;
  values.push(r.valuation);
}
values.sort((a, b) => a - b);
const order = [config.PHOENIX.name, ...config.TIERS.map((t) => t.name)];
for (const name of order) {
  const c = counts[name] || 0;
  const pct = ((c / N) * 100).toFixed(1).padStart(5);
  console.log(`  ${name.padEnd(12)} ${pct}%  ${'█'.repeat(Math.round((c / N) * 50))}`);
}
const q = (p) => fmt(values[Math.floor(p * (values.length - 1))]);
console.log(`\n  Mediana ${q(0.5)} · 10% piores abaixo de ${q(0.1)} · 10% melhores acima de ${q(0.9)}`);
