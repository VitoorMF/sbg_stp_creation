// pm2: reinicia o jogo sozinho se o processo cair. O estado volta de data/state.json.
//   ADMIN_PASSWORD=... pm2 start ecosystem.config.js
//   pm2 logs startup-creation
module.exports = {
  apps: [
    {
      name: 'startup-creation',
      script: 'server.js',
      cwd: __dirname,
      instances: 1, // o estado fica em memória: nunca rode mais de uma instância
      autorestart: true,
      max_restarts: 50,
      restart_delay: 500,
      kill_timeout: 4000,
      // Só repassa o que estiver definido no shell que rodou o pm2 start.
      env: Object.fromEntries(
        Object.entries({
          NODE_ENV: 'production',
          PORT: process.env.PORT || '3002',
          ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
          PUBLIC_URL: process.env.PUBLIC_URL,
        }).filter(([, v]) => v)
      ),
    },
  ],
};
