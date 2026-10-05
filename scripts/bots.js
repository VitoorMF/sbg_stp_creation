// scripts/bots.js — times de mentira para ensaiar o jogo sem plateia.
// Uso: node scripts/bots.js [quantidade] [url]
//   node scripts/bots.js 12 http://localhost:3002
// Cada bot entra, aposta e escolhe uma opção aleatória em um momento
// aleatório da rodada (às vezes não responde, para testar o "sem resposta").

const { io } = require('socket.io-client');

const count = Number(process.argv[2]) || 8;
const url = process.argv[3] || 'http://localhost:3002';

const NAMES = [
  'Os Escaláveis', 'Lambda Lovers', 'Bucket List', 'Multi-AZ Squad', 'Cache Cache',
  'Time Out', 'Os Serverless', 'Região SP', 'Load Balancers', 'Budget Alert',
  'Deploy na Sexta', 'Os Elásticos', 'CloudFronteiros', 'Aurora Boreal', 'Root 53',
  'Instância Única', 'Os Provisionados', 'Pico de Tráfego', 'Zona de Conforto', 'Bora Bill',
];

function bot(i) {
  const name = NAMES[i % NAMES.length] + (i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : '');
  const socket = io(url, { transports: ['websocket'], forceNew: true });
  let token = null;
  let actedKey = null;

  socket.on('connect', () => {
    if (token) socket.emit('team:resume', { token }, () => {});
    else
      socket.emit('team:join', { name }, (res) => {
        if (!res.ok) console.log(`${name}: ${res.reason}`);
        else token = res.token;
      });
  });

  socket.on('state', (v) => {
    const key = `${v.phase}:${v.round && v.round.number}`;
    if (key === actedKey) return;
    if (v.phase === 'bet') {
      actedKey = key;
      const f = v.bet.fractions[Math.floor(Math.random() * v.bet.fractions.length)];
      setTimeout(() => socket.emit('team:bet', { fraction: f }, () => {}), 1000 + Math.random() * 8000);
    }
    if (v.phase === 'question' && !v.myAnswer) {
      actedKey = key;
      if (Math.random() < 0.06) return; // às vezes não responde
      const delay = 3000 + Math.random() * 40000;
      const pick = v.options[Math.floor(Math.random() * v.options.length)];
      setTimeout(() => socket.emit('team:answer', { optionId: pick.id }, () => {}), delay);
    }
  });
}

for (let i = 0; i < count; i += 1) setTimeout(() => bot(i), i * 150);
console.log(`${count} bots conectando em ${url}. Ctrl+C para sair.`);
