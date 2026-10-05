const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { io: connect } = require('socket.io-client');
const { createServer, joinUrlFor, PROTOCOL } = require('../server');
const config = require('../config');

const quiet = { log() {}, warn() {}, error() {} };

async function start(opts = {}) {
  const server = createServer({
    port: 0,
    adminPassword: 'segredo',
    persist: false,
    config: { ...config, EVENTS_ENABLED: false },
    tickMs: 20,
    logger: quiet,
    ...opts,
  });
  const port = await server.listen();
  const sockets = [];
  const client = () => {
    const s = connect(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true, reconnection: false });
    s.on('state', (view) => {
      s.lastState = view;
    });
    sockets.push(s);
    return s;
  };
  const stop = async () => {
    sockets.forEach((s) => s.close());
    await server.close();
  };
  return { server, port, client, stop };
}

const call = (socket, event, payload = {}) => new Promise((resolve) => socket.emit(event, payload, resolve));

// Espera um "state" que satisfaça a condição (o último recebido também vale,
// para não perder um broadcast que chegou antes de começar a esperar).
function waitState(socket, predicate = () => true, ms = 2000, { fresh = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!fresh && socket.lastState && predicate(socket.lastState)) {
      resolve(socket.lastState);
      return;
    }
    const timer = setTimeout(() => {
      socket.off('state', onState);
      reject(new Error('state não chegou'));
    }, ms);
    function onState(view) {
      if (!predicate(view)) return;
      clearTimeout(timer);
      socket.off('state', onState);
      resolve(view);
    }
    socket.on('state', onState);
  });
}

test('fluxo completo por socket: entrar, responder, revelar, reconectar', async (t) => {
  const { client, stop, server } = await start();
  t.after(stop);

  const admin = client();
  assert.equal((await call(admin, 'admin:auth', { password: 'errada' })).reason, 'wrong_password');
  assert.equal((await call(admin, 'admin:action', { type: 'advance' })).reason, 'not_admin');
  const adminState = waitState(admin);
  assert.equal((await call(admin, 'admin:auth', { password: 'segredo' })).ok, true);
  assert.equal((await adminState).phase, 'lobby');

  const projector = client();
  const projState = waitState(projector);
  await call(projector, 'projector:watch');
  assert.ok((await projState).joinUrl.startsWith('http://'));

  const phone = client();
  const joined = await call(phone, 'team:join', { name: 'Os Escaláveis' });
  assert.equal(joined.ok, true);
  assert.ok(joined.token);
  assert.equal((await call(client(), 'team:join', { name: 'os escalaveis' })).reason, 'name_taken');
  assert.equal((await call(phone, 'team:join', { name: 'Outro' })).reason, 'already_joined');

  const lobby = await waitState(projector, (v) => v.teams && v.teams.length === 1);
  assert.deepEqual(lobby.teams, ['Os Escaláveis']);

  // Abre a rodada 1
  const phoneQuestion = waitState(phone, (v) => v.phase === 'question');
  const advanced = await call(admin, 'admin:action', { type: 'advance', expect: { phase: 'lobby', roundIndex: -1 } });
  assert.equal(advanced.ok, true);
  const q = await phoneQuestion;
  assert.equal(q.options.length, 3);
  assert.ok(q.timer.remainingMs > 50000);
  assert.ok(!JSON.stringify(q).includes('tier'));

  // Clique duplo é recusado
  const dup = await call(admin, 'admin:action', { type: 'advance', expect: { phase: 'lobby', roundIndex: -1 } });
  assert.equal(dup.reason, 'stale_action');

  const best = server.game.currentRound.options.find((o) => o.tier === 'best').id;
  assert.equal((await call(phone, 'team:answer', { optionId: 'lixo' })).reason, 'invalid_option');
  assert.equal((await call(phone, 'team:answer', { optionId: best })).ok, true);
  await waitState(projector, (v) => v.answeredCount === 1);

  // Celular cai e volta com o token
  phone.close();
  const phone2 = client();
  const resumedState = waitState(phone2);
  const resumed = await call(phone2, 'team:resume', { token: joined.token });
  assert.equal(resumed.ok, true);
  const rs = await resumedState;
  assert.equal(rs.myAnswer, best);
  assert.equal((await call(client(), 'team:resume', { token: 'falso' })).reason, 'unknown_token');

  // Fecha e revela
  await call(admin, 'admin:action', { type: 'advance', expect: { phase: 'question', roundIndex: 0 } });
  const revealState = waitState(phone2, (v) => v.phase === 'reveal');
  await call(admin, 'admin:action', { type: 'advance', expect: { phase: 'closed', roundIndex: 0 } });
  const reveal = await revealState;
  assert.equal(reveal.result.tier, 'best');
  assert.equal(reveal.result.speedBonus, true);
  assert.equal(reveal.team.valuation, Math.round(100000 * 1.5 * 1.1));
  assert.equal(reveal.position, 1);
});

test('timer do servidor fecha a rodada sozinho', async (t) => {
  const { client, stop } = await start({
    config: { ...config, EVENTS_ENABLED: false, ROUND_DURATION_MS: { 1: 150 }, ANSWER_GRACE_MS: 50 },
  });
  t.after(stop);
  const admin = client();
  await call(admin, 'admin:auth', { password: 'segredo' });
  const phone = client();
  await call(phone, 'team:join', { name: 'A' });
  await call(admin, 'admin:action', { type: 'advance' });
  const closed = await waitState(phone, (v) => v.phase === 'closed');
  assert.equal(closed.myAnswer, null);
});

test('operador remove time e o celular volta para a entrada', async (t) => {
  const { client, stop } = await start();
  t.after(stop);
  const admin = client();
  await call(admin, 'admin:auth', { password: 'segredo' });
  const phone = client();
  await call(phone, 'team:join', { name: 'Nome Feio' });
  const view = await waitState(admin, (v) => v.teams.length === 1);
  assert.equal(view.teams[0].connected, 1);
  const removed = new Promise((resolve) => phone.once('team:removed', resolve));
  await call(admin, 'admin:action', { type: 'removeTeam', teamId: view.teams[0].id });
  await removed;
  assert.equal((await call(phone, 'team:answer', { optionId: 'x' })).reason, 'unknown_team');
  // Mesmo celular consegue entrar de novo com outro nome
  assert.equal((await call(phone, 'team:join', { name: 'Nome Bom' })).ok, true);
});

test('payloads malformados não derrubam o servidor', async (t) => {
  const { client, stop } = await start();
  t.after(stop);
  const s = client();
  assert.equal((await call(s, 'team:join', null)).reason, 'invalid_name');
  assert.equal((await call(s, 'team:join', { name: 12345 })).reason, 'invalid_name');
  assert.equal((await call(s, 'team:answer', 'x')).reason, 'unknown_team');
  assert.equal((await call(s, 'admin:auth', { password: { $ne: 1 } })).reason, 'wrong_password');
  s.emit('team:join', { name: 'sem callback' }); // não pode quebrar
  assert.equal((await call(s, 'team:join', { name: 'ok' })).reason, 'already_joined');
});

test('estado é gravado em disco e restaurado no reinício', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-creation-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const first = await start({ persist: true, dataDir: dir });
  const phone = first.client();
  const { token } = await call(phone, 'team:join', { name: 'Persistente' });
  const admin = first.client();
  await call(admin, 'admin:auth', { password: 'segredo' });
  await call(admin, 'admin:action', { type: 'advance' });
  await first.stop();
  assert.ok(fs.existsSync(path.join(dir, 'state.json')));

  const second = await start({ persist: true, dataDir: dir });
  t.after(second.stop);
  const phone2 = second.client();
  const state = waitState(phone2);
  assert.equal((await call(phone2, 'team:resume', { token })).ok, true);
  const v = await state;
  assert.equal(v.phase, 'question');
  assert.equal(v.team.name, 'Persistente');
});

test('senha do admin gerada é gravada e reaproveitada', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-creation-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const a = createServer({ port: 0, dataDir: dir, logger: quiet });
  const b = createServer({ port: 0, dataDir: dir, logger: quiet });
  assert.ok(a.adminPassword.length >= 8);
  assert.equal(a.adminPassword, b.adminPassword);
  await a.close();
  await b.close();
});

test('servidor anuncia a versão do protocolo, a mesma das telas', async (t) => {
  const { client, port, stop } = await start();
  t.after(stop);
  const s = client();
  const hello = await new Promise((resolve) => s.once('server:hello', resolve));
  const clientSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'common.js'), 'utf8');
  const clientProtocol = Number(/const PROTOCOL = (\d+);/.exec(clientSrc)[1]);
  assert.equal(hello.protocol, PROTOCOL);
  assert.equal(clientProtocol, PROTOCOL, 'public/common.js e server.js com versões diferentes');
  const health = await (await fetch(`http://localhost:${port}/healthz`)).json();
  assert.equal(health.protocol, PROTOCOL);
});

test('QR code e atalhos de página respondem', async (t) => {
  const { port, stop } = await start();
  t.after(stop);
  const qr = await fetch(`http://localhost:${port}/join-qr.svg`);
  assert.equal(qr.status, 200);
  assert.match(await qr.text(), /<svg/);
  for (const p of ['/', '/admin', '/telao', '/healthz']) {
    assert.equal((await fetch(`http://localhost:${port}${p}`)).status, 200, p);
  }
});

test('joinUrlFor: PUBLIC_URL, host do projetor e host inválido', () => {
  assert.equal(joinUrlFor('http://bora.example', 'x', 3002), 'http://bora.example/');
  assert.equal(joinUrlFor(undefined, '54.1.2.3:3002', 3002), 'http://54.1.2.3:3002/');
  assert.ok(joinUrlFor(undefined, '<script>', 3002).startsWith('http://'));
  assert.ok(!joinUrlFor(undefined, '<script>', 3002).includes('<'));
});
