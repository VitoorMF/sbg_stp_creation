// server.js
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { GameEngine, PHASE } = require('./gameEngine');

const PORT = process.env.PORT || 3002;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'bora-admin'; // troque antes do evento

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const game = new GameEngine();
let roundTimer = null;

// socket.id -> teamId, para saber quem é quem quando a conexão cai.
const socketTeam = new Map();

function broadcastRanking() {
  io.emit('ranking:update', game.getRanking());
}

function broadcastTeams() {
  io.emit('teams:update', game.listTeams().map((t) => ({ id: t.id, name: t.name })));
}

function startRoundTimer(round) {
  clearTimeout(roundTimer);
  const duration = game.getRoundDuration(round);
  roundTimer = setTimeout(() => {
    closeCurrentRound();
  }, duration);

  io.emit('round:started', {
    round: publicRound(round),
    durationMs: duration,
    serverStartedAt: game.roundStartedAt,
  });
}

// Nunca manda a opção certa nem o multiplicador para o cliente antes da hora.
function publicRound(round) {
  return {
    id: round.id,
    title: round.title,
    narration: round.narration,
    scenario: round.scenario,
    options: round.options.map((o) => ({ id: o.id, label: o.label })),
  };
}

function closeCurrentRound() {
  clearTimeout(roundTimer);
  const result = game.closeRound();
  if (!result) return;

  const { round, applied } = result;

  if (!applied) {
    // Rodada 'delayed': só avisa que fechou, sem mostrar quem acertou.
    io.emit('round:closed_pending', { roundId: round.id });
    return;
  }

  io.emit('round:revealed', {
    roundId: round.id,
    correct: round.correct,
    explanation: round.explanation,
    ranking: game.getRanking(),
  });
  broadcastRanking();
}

// --- Rotas de admin simples (sem dashboard por enquanto, só eventos) -----

io.on('connection', (socket) => {
  // --- Time entra ---
  socket.on('team:join', ({ name }, cb) => {
    try {
      const teamId = socket.id;
      const team = game.addTeam(teamId, name.trim());
      socketTeam.set(socket.id, teamId);
      socket.join('teams');
      cb({ ok: true, teamId: team.id });
      broadcastTeams();
    } catch (err) {
      cb({ ok: false, reason: err.message });
    }
  });

  // --- Time responde ---
  socket.on('team:answer', ({ optionId }, cb) => {
    const teamId = socketTeam.get(socket.id);
    const result = game.submitAnswer(teamId, optionId);
    cb(result);
    if (result.ok) {
      // Avisa só o admin/projetor quantos já responderam, sem revelar a opção.
      io.emit('round:answer_count', { count: game.answers.size, total: game.teams.size });
    }
  });

  // --- Admin: autenticação simples por senha enviada no evento ---
  socket.on('admin:auth', ({ password }, cb) => {
    if (password !== ADMIN_PASSWORD) return cb({ ok: false });
    socket.join('admin');
    cb({ ok: true, state: adminSnapshot() });
  });

  socket.on('admin:startNextRound', (_, cb) => {
    if (!socket.rooms.has('admin')) return cb({ ok: false, reason: 'not_admin' });
    const round = game.startNextRound();
    if (!round) {
      io.emit('game:finished', { ranking: game.getRanking() });
      return cb({ ok: true, finished: true });
    }
    startRoundTimer(round);
    cb({ ok: true, round: publicRound(round) });
  });

  socket.on('admin:closeRoundNow', (_, cb) => {
    if (!socket.rooms.has('admin')) return cb({ ok: false, reason: 'not_admin' });
    closeCurrentRound();
    cb({ ok: true });
  });

  socket.on('admin:resolveDelayed', ({ roundId }, cb) => {
    if (!socket.rooms.has('admin')) return cb({ ok: false, reason: 'not_admin' });
    const result = game.resolveDelayedRound(roundId);
    if (!result) return cb({ ok: false, reason: 'not_found' });
    io.emit('round:delayed_revealed', {
      roundId,
      narration: result.round.delayedNarration,
      outcomes: result.outcomes,
      ranking: game.getRanking(),
    });
    cb({ ok: true });
  });

  socket.on('disconnect', () => {
    socketTeam.delete(socket.id);
  });
});

function adminSnapshot() {
  return {
    phase: game.phase,
    currentRound: game.currentRound ? publicRound(game.currentRound) : null,
    teams: game.listTeams().map((t) => ({ id: t.id, name: t.name, valuation: t.valuation })),
    totalRounds: game.rounds.length,
    currentRoundIndex: game.currentRoundIndex,
  };
}

server.listen(PORT, () => {
  console.log(`Startup Creation rodando na porta ${PORT}`);
});
