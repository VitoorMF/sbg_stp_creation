// server.js
// Liga a engine às três telas (time, projetor e admin) via Socket.IO.
// O servidor é a única fonte da verdade: o celular só manda a opção escolhida
// e cada tela recebe apenas o que pode ver naquele momento.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const { Game, GameError } = require('./gameEngine');

// Versão do protocolo com as telas (a mesma de public/common.js). Uma tela que
// não recebe esta versão ao conectar avisa que o servidor está desatualizado.
const PROTOCOL = 2;
const { ROUNDS, validateRounds } = require('./rounds');
const DEFAULT_CONFIG = require('./config');

// --- Estado em disco ---------------------------------------------------------

function loadState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`Não consegui ler ${file}: ${err.message}`);
    return null;
  }
}

// Escreve num arquivo temporário e renomeia: uma queda no meio da escrita
// nunca deixa o state.json pela metade.
function saveState(file, state) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, file);
}

// Senha do admin: variável de ambiente ou, se não houver, uma senha aleatória
// gravada em data/ para sobreviver a reinícios do pm2.
function resolveAdminPassword(dataDir, fromEnv) {
  if (fromEnv) return { password: fromEnv, source: 'env' };
  const file = path.join(dataDir, 'admin-password.txt');
  try {
    const saved = fs.readFileSync(file, 'utf8').trim();
    if (saved) return { password: saved, source: file };
  } catch {
    // ainda não existe
  }
  const password = crypto.randomBytes(6).toString('base64url');
  fs.writeFileSync(file, `${password}\n`, { mode: 0o600 });
  return { password, source: file };
}

function samePassword(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// --- Endereço que vai no QR code ---------------------------------------------

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const addr of list || []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return null;
}

// Usa PUBLIC_URL se existir; senão, o endereço que o projetor usou para abrir
// a página (o IP público da EC2). Se for localhost, troca pelo IP da rede local
// para dar para testar com celulares no mesmo Wi-Fi.
function joinUrlFor(publicUrl, hostHeader, port) {
  if (publicUrl) return publicUrl.replace(/\/?$/, '/');
  let host = /^[a-zA-Z0-9.\-:[\]]{1,255}$/.test(hostHeader || '') ? hostHeader : `localhost:${port}`;
  const bare = host.replace(/:\d+$/, '');
  if (['localhost', '127.0.0.1', '[::1]'].includes(bare)) {
    const lan = lanAddress();
    if (lan) host = `${lan}${host.slice(bare.length)}`;
  }
  return `http://${host}/`;
}

// --- Servidor ----------------------------------------------------------------

function createServer({
  port = 3002,
  dataDir = path.join(__dirname, 'data'),
  adminPassword,
  publicUrl,
  rounds = ROUNDS,
  config = DEFAULT_CONFIG,
  now,
  random,
  tickMs = 200,
  persist = true,
  logger = console,
} = {}) {
  const roundErrors = validateRounds(rounds);
  if (roundErrors.length) throw new Error(`rounds.js inválido:\n- ${roundErrors.join('\n- ')}`);

  if (persist) fs.mkdirSync(dataDir, { recursive: true });
  const stateFile = path.join(dataDir, 'state.json');
  const admin = persist
    ? resolveAdminPassword(dataDir, adminPassword)
    : { password: adminPassword || 'test', source: 'option' };

  const game = new Game({ rounds, config, now, random });
  if (persist) {
    const saved = loadState(stateFile);
    if (saved && game.load(saved)) {
      logger.log(`Estado restaurado de ${stateFile}: fase "${game.phase}", rodada ${game.state.roundIndex + 1}.`);
    } else if (saved) {
      logger.warn('state.json incompatível com esta versão; começando um jogo novo.');
    }
  }

  const app = express();
  app.disable('x-powered-by');
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, { maxHttpBufferSize: 10 * 1024 });

  const page = (file) => (req, res) => res.sendFile(path.join(__dirname, 'public', file));
  app.get(['/admin', '/operador'], page('admin.html'));
  app.get(['/telao', '/projetor', '/projector'], page('projector.html'));
  app.get('/healthz', (req, res) =>
    res.json({ ok: true, protocol: PROTOCOL, phase: game.phase, teams: Object.keys(game.state.teams).length })
  );
  app.get('/join-qr.svg', async (req, res) => {
    try {
      const url = joinUrlFor(publicUrl, req.get('host'), port);
      const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
      res.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
    } catch (err) {
      logger.error('Falha ao gerar QR code:', err);
      res.status(500).end();
    }
  });
  app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

  // teamId -> Set(socket), para contar conexões e avisar times removidos.
  const teamSockets = new Map();

  function attachTeam(socket, teamId) {
    detachTeam(socket);
    socket.data.teamId = teamId;
    socket.join(`team:${teamId}`);
    if (!teamSockets.has(teamId)) teamSockets.set(teamId, new Set());
    teamSockets.get(teamId).add(socket);
  }

  function detachTeam(socket) {
    const id = socket.data.teamId;
    if (!id) return;
    socket.leave(`team:${id}`);
    const set = teamSockets.get(id);
    if (set) {
      set.delete(socket);
      if (!set.size) teamSockets.delete(id);
    }
    socket.data.teamId = null;
  }

  // Celulares de times que não existem mais voltam para a tela de entrada.
  function kickRemovedTeams() {
    for (const [teamId, sockets] of [...teamSockets.entries()]) {
      if (game.getTeam(teamId)) continue;
      for (const s of [...sockets]) {
        detachTeam(s);
        s.emit('team:removed');
      }
    }
  }

  function connectionCounts() {
    const counts = {};
    for (const [id, set] of teamSockets) counts[id] = set.size;
    return counts;
  }

  function sendState(socket) {
    const role = socket.data.role;
    if (role === 'admin') {
      socket.emit('state', { ...game.viewForAdmin(connectionCounts()), joinUrl: socket.data.joinUrl });
    } else if (role === 'projector') {
      socket.emit('state', { ...game.viewForProjector(), joinUrl: socket.data.joinUrl });
    } else if (socket.data.teamId) {
      socket.emit('state', game.viewForTeam(socket.data.teamId));
    }
  }

  let broadcastScheduled = false;
  function broadcast() {
    broadcastScheduled = false;
    for (const [teamId] of teamSockets) {
      io.to(`team:${teamId}`).emit('state', game.viewForTeam(teamId));
    }
    // Projetor e admin recebem o joinUrl de cada um, então vão um a um.
    const projector = game.viewForProjector();
    for (const s of io.sockets.adapter.rooms.get('projector') || []) {
      const sock = io.sockets.sockets.get(s);
      if (sock) sock.emit('state', { ...projector, joinUrl: sock.data.joinUrl });
    }
    const adminView = game.viewForAdmin(connectionCounts());
    for (const s of io.sockets.adapter.rooms.get('admin') || []) {
      const sock = io.sockets.sockets.get(s);
      if (sock) sock.emit('state', { ...adminView, joinUrl: sock.data.joinUrl });
    }
  }

  function scheduleBroadcast() {
    if (broadcastScheduled) return;
    broadcastScheduled = true;
    setImmediate(broadcast);
  }

  let saveFailed = false;
  function changed() {
    if (persist) {
      try {
        saveState(stateFile, game.toJSON());
        if (saveFailed) logger.log('Gravação do estado voltou a funcionar.');
        saveFailed = false;
      } catch (err) {
        if (!saveFailed) logger.error(`Falha ao gravar ${stateFile}: ${err.message}`);
        saveFailed = true;
      }
    }
    scheduleBroadcast();
  }

  // Todo handler responde pelo callback e nunca derruba o processo.
  function handler(fn) {
    return async (payload, cb) => {
      const reply = typeof cb === 'function' ? cb : () => {};
      try {
        const result = await fn(payload && typeof payload === 'object' ? payload : {});
        reply({ ok: true, ...(result || {}) });
      } catch (err) {
        if (err instanceof GameError) {
          reply({ ok: false, reason: err.code });
        } else {
          logger.error('Erro inesperado:', err);
          reply({ ok: false, reason: 'server_error' });
        }
      }
    };
  }

  const isAdmin = (socket) => socket.data.role === 'admin';

  io.on('connection', (socket) => {
    socket.emit('server:hello', { protocol: PROTOCOL });
    socket.data.joinAttempts = 0;
    socket.data.joinUrl = joinUrlFor(publicUrl, socket.handshake.headers.host, port);

    // --- Time ---
    socket.on(
      'team:resume',
      handler(({ token }) => {
        const team = game.resume(token);
        if (!team) throw new GameError('unknown_token');
        socket.data.role = 'team';
        attachTeam(socket, team.id);
        sendState(socket);
        scheduleBroadcast(); // admin vê o time conectado de novo
        return { name: team.name };
      })
    );

    socket.on(
      'team:join',
      handler(({ name }) => {
        if (socket.data.teamId) throw new GameError('already_joined');
        socket.data.joinAttempts += 1;
        if (socket.data.joinAttempts > 20) throw new GameError('too_many_attempts');
        const team = game.join(name);
        socket.data.role = 'team';
        attachTeam(socket, team.id);
        changed();
        return { token: team.token, name: team.name };
      })
    );

    socket.on(
      'team:answer',
      handler(({ optionId }) => {
        if (!socket.data.teamId) throw new GameError('unknown_team');
        game.submitAnswer(socket.data.teamId, optionId);
        changed();
      })
    );

    socket.on(
      'team:bet',
      handler(({ fraction }) => {
        if (!socket.data.teamId) throw new GameError('unknown_team');
        game.submitBet(socket.data.teamId, fraction);
        changed();
      })
    );

    // --- Projetor ---
    socket.on(
      'projector:watch',
      handler(() => {
        socket.data.role = 'projector';
        socket.join('projector');
        sendState(socket);
      })
    );

    // --- Admin ---
    socket.on(
      'admin:auth',
      handler(async ({ password }) => {
        if (typeof password !== 'string' || !samePassword(password, admin.password)) {
          await new Promise((r) => setTimeout(r, 800)); // freia tentativa e erro
          throw new GameError('wrong_password');
        }
        detachTeam(socket);
        socket.data.role = 'admin';
        socket.join('admin');
        sendState(socket);
      })
    );

    socket.on(
      'admin:action',
      handler(({ type, expect, teamId, name, seconds, keepTeams }) => {
        if (!isAdmin(socket)) throw new GameError('not_admin');
        switch (type) {
          case 'advance':
            game.advance(expect);
            break;
          case 'extend': {
            const s = Number(seconds);
            if (!Number.isFinite(s) || s < 5 || s > 120) throw new GameError('invalid_seconds');
            game.extendTimer(s * 1000);
            break;
          }
          case 'removeTeam':
            game.removeTeam(teamId);
            break;
          case 'renameTeam':
            game.renameTeam(teamId, name);
            break;
          case 'reset':
            game.reset({ keepTeams: !!keepTeams });
            break;
          default:
            throw new GameError('unknown_action');
        }
        kickRemovedTeams();
        changed();
      })
    );

    socket.on('disconnect', () => {
      const hadTeam = !!socket.data.teamId;
      detachTeam(socket);
      if (hadTeam) scheduleBroadcast();
    });
  });

  const ticker = setInterval(() => {
    try {
      if (game.tick()) changed();
    } catch (err) {
      logger.error('Erro no timer:', err);
    }
  }, tickMs);
  ticker.unref();

  return {
    app,
    io,
    game,
    httpServer,
    adminPassword: admin.password,
    adminPasswordSource: admin.source,
    listen() {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, () => resolve(httpServer.address().port));
      });
    },
    close() {
      clearInterval(ticker);
      if (persist) {
        try {
          saveState(stateFile, game.toJSON());
        } catch (err) {
          logger.error(`Falha ao gravar ${stateFile}: ${err.message}`);
        }
      }
      return new Promise((resolve) => {
        io.close(() => resolve());
      });
    },
  };
}

module.exports = { createServer, joinUrlFor, PROTOCOL };

if (require.main === module) {
  const port = Number(process.env.PORT) || 3002;
  const server = createServer({
    port,
    adminPassword: process.env.ADMIN_PASSWORD,
    publicUrl: process.env.PUBLIC_URL,
    dataDir: process.env.DATA_DIR || path.join(__dirname, 'data'),
  });

  server
    .listen()
    .then((p) => {
      const join = joinUrlFor(process.env.PUBLIC_URL, `localhost:${p}`, p);
      console.log(`Startup Creation rodando na porta ${p}`);
      console.log(`  Times:    ${join}`);
      console.log(`  Projetor: ${join}telao`);
      console.log(`  Admin:    ${join}admin`);
      if (server.adminPasswordSource === 'env') {
        console.log('  Senha do admin: definida em ADMIN_PASSWORD');
      } else {
        console.log(`  Senha do admin: ${server.adminPassword}  (gravada em ${server.adminPasswordSource})`);
      }
    })
    .catch((err) => {
      console.error(`Não consegui abrir a porta ${port}: ${err.message}`);
      process.exit(1);
    });

  let closing = false;
  const shutdown = (signal) => {
    if (closing) return;
    closing = true;
    console.log(`${signal} recebido, gravando estado e saindo.`);
    server.close().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
