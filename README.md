# Startup Creation — protótipo

Protótipo da engine do jogo (3 rodadas de exemplo: 1, 2 e 6, a mais complexa).
Mesma lógica das outras 6 rodadas, só falta escrever o conteúdo em `rounds.js`.

## Rodar localmente ou na EC2

```bash
npm install
node server.js
```

Por padrão sobe na porta **3002** (troque com `PORT=3003 node server.js` se precisar).
Na EC2, libere essa porta no security group, igual você já fez com o King of the Server.

## Telas

- **Time (celular):** `http://<ip>:3002/` — nome do time, depois responde cada rodada
- **Admin (você controla):** `http://<ip>:3002/admin.html` — senha padrão `bora-admin`
  (troque em `ADMIN_PASSWORD` no `server.js` ou via variável de ambiente antes do evento)
- **Projetor:** `http://<ip>:3002/projector.html` — cenário, timer e ranking

## Como testar sozinho, sem o evento

1. `node server.js`
2. Abra `admin.html` numa aba, autentique
3. Abra `index.html` em 2-3 abas (ou celulares), entre com nomes diferentes
4. Abra `projector.html` numa terceira aba
5. No admin, clique "Próxima rodada" e responda nos times
6. Deixe o timer zerar (ou clique "Fechar rodada agora")
7. Observe: rodadas 1 e 2 revelam na hora; a rodada 6 (delayed) só mostra
   "resultado pendente" até você clicar "Revelar resultado atrasado" no admin

## O que falta

- [ ] Escrever as rodadas 3, 4, 5, 7, 8 e 9 em `rounds.js`, no mesmo formato
- [ ] Rodada 9 (aposta): a engine ainda não tem a mecânica de aposta — avisar
      quando for implementar, porque muda `submitAnswer` e `closeRound`
- [ ] Eventos aleatórios (investidor anjo, bug em produção etc) — ainda não
      implementados na engine, por simplicidade no protótipo
- [ ] Trocar `ADMIN_PASSWORD` antes do evento
- [ ] Testar carga real na t3.small com ~20-25 conexões simultâneas
- [ ] Gerar QR code apontando para o IP/porta corretos no dia

## Teste rápido da engine (sem subir servidor)

```bash
node test-engine.js
```

Simula 3 times (sempre acerta / sempre mediano / sempre erra) jogando as
3 rodadas, incluindo a revelação atrasada da rodada 6, e imprime o resultado
final de cada um.
