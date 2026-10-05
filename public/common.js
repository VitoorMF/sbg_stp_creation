// common.js — utilidades compartilhadas pelas três telas.
// Tudo que vem do servidor entra no DOM como texto (nunca innerHTML), então
// nome de time com <script> aparece como texto e não executa.

(function () {
  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  const dec = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

  // Espaço inseparável entre "R$" e o número: nunca quebra a linha no meio.
  function fmtBRL(v) {
    return brl.format(v).replace(/\s/g, '\u00a0');
  }

  // R$ 1,5 mi / R$ 350 mil, para espaços apertados.
  function fmtShort(v) {
    if (Math.abs(v) >= 1e6) return `R$\u00a0${dec.format(Math.round(v / 1e4) / 100)}\u00a0mi`;
    if (Math.abs(v) >= 1e3) return `R$\u00a0${dec.format(Math.round(v / 1e3))}\u00a0mil`;
    return fmtBRL(v);
  }

  function fmtMult(m) {
    return `×${dec.format(m)}`;
  }

  function fmtPct(p) {
    const n = Math.round(p * 100);
    return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}%`;
  }

  function ordinal(n) {
    return `${n}º`;
  }

  // el('div', { class: 'x', onclick: fn }, 'texto', outroEl)
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (k === 'class') node.className = v;
      else if (k === 'style') node.style.cssText = v;
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c === undefined || c === null || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  // Contagem regressiva baseada no tempo restante que o servidor mandou, e não
  // no relógio do celular (que pode estar adiantado ou atrasado).
  class Countdown {
    constructor(onTick) {
      this.onTick = onTick;
      this.endsAt = null;
      this.durationMs = 0;
      this.handle = null;
    }
    set(timer) {
      if (!timer) {
        this.stop();
        return;
      }
      this.endsAt = performance.now() + timer.remainingMs;
      this.durationMs = timer.durationMs;
      if (!this.handle) this.handle = setInterval(() => this.tick(), 100);
      this.tick();
    }
    remaining() {
      return this.endsAt === null ? 0 : Math.max(0, this.endsAt - performance.now());
    }
    tick() {
      const ms = this.remaining();
      this.onTick(ms, this.durationMs ? ms / this.durationMs : 0);
    }
    stop() {
      clearInterval(this.handle);
      this.handle = null;
      this.endsAt = null;
    }
  }

  const REASONS = {
    name_taken: 'Já existe um time com esse nome. Escolham outro.',
    invalid_name: 'Digitem um nome com pelo menos uma letra ou número.',
    game_finished: 'O jogo já terminou.',
    game_full: 'O jogo está lotado. Juntem-se a outro time.',
    too_many_attempts: 'Muitas tentativas. Recarreguem a página.',
    time_up: 'O tempo acabou.',
    already_answered: 'Vocês já responderam.',
    round_not_open: 'A rodada não está aberta.',
    bet_not_open: 'As apostas estão fechadas.',
    invalid_option: 'Opção inválida.',
    invalid_bet: 'Aposta inválida.',
    unknown_team: 'Time não encontrado. Entrem de novo.',
    wrong_password: 'Senha incorreta.',
    not_admin: 'Faça login de novo.',
    stale_action: 'O jogo já tinha avançado. Confira a tela.',
    no_timer: 'Não há timer rodando agora.',
    server_error: 'Erro no servidor. Tentem de novo.',
    timeout: 'Sem resposta do servidor. Confiram a conexão.',
  };

  function reasonText(reason) {
    return REASONS[reason] || `Erro: ${reason}`;
  }

  // emit com timeout: se a rede cair, o callback ainda volta com erro.
  function request(socket, event, payload, ms = 8000) {
    return new Promise((resolve) => {
      socket.timeout(ms).emit(event, payload, (err, res) => {
        resolve(err ? { ok: false, reason: 'timeout' } : res);
      });
    });
  }

  const storage = {
    get(k) {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch {
        // modo anônimo: segue só em memória
      }
    },
    remove(k) {
      try {
        localStorage.removeItem(k);
      } catch {
        // idem
      }
    },
  };

  // Versão do protocolo entre as telas e o servidor (a mesma de server.js).
  // Se o servidor não confirmar esta versão logo depois de conectar, ele está
  // rodando código antigo (processo não reiniciado depois do deploy): a tela
  // avisa em vez de ficar em branco.
  const PROTOCOL = 2;

  function watchServer(socket, message) {
    const banner = document.createElement('div');
    banner.className = 'conn-banner stale';
    banner.setAttribute('role', 'alert');
    banner.textContent = message;
    document.body.append(banner);
    let timer = null;
    socket.on('connect', () => {
      clearTimeout(timer);
      timer = setTimeout(() => banner.classList.add('show'), 4000);
    });
    socket.on('disconnect', () => clearTimeout(timer));
    socket.on('server:hello', (hello) => {
      clearTimeout(timer);
      banner.classList.toggle('show', !hello || hello.protocol !== PROTOCOL);
    });
  }

  window.Bora = { fmtBRL, fmtShort, fmtMult, fmtPct, ordinal, el, Countdown, reasonText, request, storage, watchServer };
})();
