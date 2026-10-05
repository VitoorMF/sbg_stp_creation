# Startup Creation

Jogo de 9 rodadas em que times decidem a arquitetura da Bora.ai (venda de ingressos para shows e festivais). Cada escolha multiplica o valuation do time, e o maior valuation no final ganha. Cada time joga com um celular, no estilo Kahoot.

## Rodar

```bash
npm install
npm start
```

O servidor sobe na porta **3002** (`PORT=3003 npm start` para trocar) e imprime os três endereços e a senha do admin:

| Tela | Endereço | Quem usa |
| --- | --- | --- |
| Time | `http://<ip>:3002/` | um celular por time, aberto pelo QR code |
| Telão | `http://<ip>:3002/telao` | projetor (tecla **F** para tela cheia) |
| Operador | `http://<ip>:3002/admin` | quem controla o jogo. **Não projete esta tela**: ela mostra as respostas |

**Senha do admin:** use `ADMIN_PASSWORD=...`. Sem a variável, o servidor gera uma senha, grava em `data/admin-password.txt` e imprime no terminal. A mesma senha vale depois de um reinício.

## Ensaiar sozinho

```bash
npm start
npm run bots -- 15
```

O segundo comando entra com 15 times-robô que apostam e respondem sozinhos (alguns não respondem). Abra o telão e o admin, entre com o seu celular e jogue a partida inteira. Para ver o placar de novo do zero, use "Zerar placar e manter times" no admin.

## Como o operador conduz

O admin tem um botão principal que muda de nome conforme a fase. Um clique duplo nunca pula uma etapa.

1. **Começar rodada N:** abre a pergunta nos celulares e o timer no telão (60 s nas rodadas 1 a 3, 75 s nas demais).
2. O timer encerra as respostas sozinho. **Encerrar respostas agora** antecipa o fim, e **+15 s** dá mais tempo.
3. **Revelar a resposta:** mostra a melhor opção, a explicação, quantos times escolheram cada opção, o evento sorteado e o ranking.
4. Na **rodada 6**, o botão vira **Revelar a crise** (a queda da AZ aparece no telão sem placar) e depois **Mostrar o resultado**.
5. Na **rodada 9**, os times apostam 25%, 50%, 75% ou 100% do valuation antes de ver a pergunta. A pergunta abre sozinha quando o prazo da aposta (30 s) acaba.
6. **Mostrar resultado final:** o telão revela a classificação de baixo para cima e o vencedor por último.

O painel "Roteiro" do admin traz a narração, o cenário, as três opções com a faixa e o multiplicador de cada uma, a explicação e as notas do apresentador (o detalhe do cenário que desempata as opções).

O admin também pode **renomear** ou **remover** times. Um time removido volta para a tela de entrada no celular.

## Regras implementadas

- Valuation inicial de R$ 100 mil. Os multiplicadores por dificuldade e as faixas finais seguem o documento de design (`config.js`).
- **Sem resposta** conta como a pior opção.
- **Bônus de velocidade:** +10% para quem confirma a resposta nos primeiros 25 s.
- **Evento aleatório:** um por rodada, da 1 à 8, sorteado para um time.
- **Ranking:** some do telão e dos celulares nas rodadas 7 a 9 e volta no resultado final. O celular sempre mostra o valuation do próprio time.
- **Fênix:** time que caiu abaixo de R$ 50 mil em algum momento e terminou com R$ 300 mil ou mais.
- **Anticola:** a ordem das opções é embaralhada por time e fica a mesma se o celular recarregar.
- **Pontuação** calculada só no servidor. Nada sobre a resposta certa sai do servidor antes da revelação.

### Decisões em pontos que o documento deixou em aberto

Todas podem ser trocadas em `config.js`:

- O bônus de velocidade vale **só para a melhor opção** (`SPEED_BONUS_ONLY_BEST`), para não premiar chute rápido. Não há bônus na aposta.
- Na aposta, a **opção mediana perde metade** do valor apostado (`STAKE_RETURN.mid`). O documento deixou essa célula vazia.
- Time que **não aposta** a tempo aposta 50% (`DEFAULT_BET_FRACTION`).
- **Desempate** no valuation: vence quem respondeu mais rápido somando todas as rodadas.
- **Times que entram atrasados** começam com R$ 100 mil. Se entram depois que a rodada fechou, essa rodada não conta para eles.
- O texto do prêmio no telão (`PRIZE_TEXT`) diz "Ganhou os AWS Credits!". Troque se os créditos não forem confirmados.

## Ajustar o jogo

- **Números** (multiplicadores, tempos, eventos, faixas, prêmio): `config.js`.
- **Texto das rodadas:** `rounds.js`. O servidor confere o formato ao subir e recusa uma rodada sem as três faixas ou sem feedback.
- **Calibrar depois do teste:** `npm run simulate` joga milhares de partidas com a engine de verdade e mostra o valuation de cada estratégia e a distribuição de faixas para um time que acerta cerca de dois terços.

## Deploy na EC2

Cabe na t3.small do King of the Server. A carga é de cerca de 25 conexões.

```bash
# na instância, com Node 18 ou mais novo
git clone <repo> startup-creation && cd startup-creation
npm ci
npm test
sudo npm install -g pm2
ADMIN_PASSWORD='troque-isto' pm2 start ecosystem.config.js
pm2 save && pm2 startup   # volta sozinho se a instância reiniciar
```

- **Security group:** liberar a porta 3002 (TCP) para `0.0.0.0/0`.
- **IP:** use um Elastic IP. Sem ele, o QR code do telão usa o endereço que você digitou para abrir o telão, então abra pelo IP público do dia. Para fixar o endereço, use `PUBLIC_URL=http://<ip>:3002`.
- **Queda do processo:** o pm2 reinicia sozinho. O estado é gravado em `data/state.json` a cada mudança (inclusive a cada resposta) e volta no reinício, e os celulares reconectam ao mesmo time sozinhos.
- **Jogo novo:** "Apagar tudo" no admin, ou pare o processo e apague `data/state.json`.

### Atualizar uma instalação que já está rodando

O Node carrega o código só quando o processo sobe. Copiar os arquivos novos atualiza as telas na hora, mas o servidor continua com o código antigo até reiniciar. Nesse caso as telas mostram uma faixa laranja: "O servidor está rodando o código antigo do jogo".

```bash
# na instância, dentro da pasta do jogo, com todos os arquivos novos copiados
# (tudo menos node_modules/ e data/)
npm install                  # dependências novas, como o qrcode
pm2 ls                       # veja o nome do processo do jogo
pm2 restart startup-creation # ou: pm2 delete <processo antigo> e o pm2 start acima
curl localhost:3002/healthz  # precisa responder {"ok":true,"protocol":2,...}
```

Se a instância também roda o King of the Server, não use `pm2 delete all`. Se o jogo antigo foi iniciado com `node server.js` fora do pm2, ache o PID dele com `sudo lsof -i :3002` e pare com `kill <PID>`. Não use `pkill node`, que derruba o King of the Server junto.

## Checklist antes do evento

- [ ] `ADMIN_PASSWORD` definido e anotado com o operador
- [ ] Instância rodando desde antes da aula, `curl http://<ip>:3002/healthz` respondendo
- [ ] Telão aberto pelo IP público e QR code testado com um celular no 4G e um no Wi-Fi da sala
- [ ] Ensaio completo com `npm run bots -- 25`, depois "Apagar tudo"
- [ ] Teste com alguém de fora do core team, e depois rodar `npm run simulate` para ajustar `config.js`
- [ ] Plano B: placar manual (planilha) se a instância cair de vez

## Testes

```bash
npm test
```

São 37 testes. Cobrem a engine (pontuação, bônus, aposta, crise, eventos, faixas, ranking escondido, nada vazando antes da revelação, persistência) e o servidor por socket (entrada, reconexão, clique duplo, timer, remoção de time, payload malformado, reinício com estado salvo).
