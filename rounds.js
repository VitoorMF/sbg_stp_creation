// rounds.js
// Rodadas do jogo Startup Creation — tema Bora.ai (venda de ingressos).
// Isto é só um protótipo com 3 rodadas (1, 2 e 6) para validar a engine.
// As outras 6 entram depois, no mesmo formato.

const ROUNDS = [
  {
    id: 1,
    difficulty: 'facil',
    title: 'Lançamento',
    narration: 'Vocês acabaram de fundar a Bora.ai. Primeira decisão técnica.',
    scenario:
      'A Bora.ai vai vender ingressos para shows e festivais. Preciso guardar eventos, lotes, ' +
      'ingressos e compradores, sem vender o mesmo ingresso duas vezes, e os relatórios cruzam ' +
      'tudo (quantos ingressos do lote 2 do evento X já foram vendidos?). Onde guardo isso?',
    options: [
      { id: 'a', label: 'Amazon RDS (banco relacional)', multiplier: 1.5 },
      { id: 'b', label: 'Amazon DynamoDB (NoSQL)', multiplier: 1.1 },
      { id: 'c', label: 'Arquivos JSON no S3', multiplier: 0.7 },
    ],
    correct: 'a',
    explanation:
      'Relatórios que cruzam evento, lote e comprador, com transações para não vender o mesmo ' +
      'ingresso duas vezes, é o caso clássico de banco relacional. DynamoDB funciona, mas cruzar ' +
      'dados assim é mais trabalhoso nele. JSON no S3 não tem transação nem consulta cruzada.',
    // 'immediate' = o multiplicador se aplica assim que a rodada fecha.
    // 'delayed' = só se aplica numa rodada futura (usado na rodada 6).
    resolution: 'immediate',
  },
  {
    id: 2,
    difficulty: 'facil',
    title: 'Divulgação',
    narration: 'A Bora.ai está crescendo e cada evento tem seu próprio material.',
    scenario:
      'Cada evento cadastrado tem cartaz, fotos do line-up e o PDF do ingresso gerado para cada ' +
      'comprador. Esses arquivos só crescem. Onde guardo?',
    options: [
      { id: 'a', label: 'Amazon S3, salvando só o link no banco', multiplier: 1.5 },
      { id: 'b', label: 'No disco (EBS) da própria EC2', multiplier: 1.1 },
      { id: 'c', label: 'Dentro do banco de dados relacional', multiplier: 0.7 },
    ],
    correct: 'a',
    explanation:
      'O S3 foi feito para arquivos, com capacidade praticamente ilimitada e baixo custo. O disco ' +
      'da EC2 funciona até você ter uma segunda máquina — aí cada uma tem arquivos diferentes. ' +
      'Arquivo grande dentro do banco deixa tudo lento e caro.',
    resolution: 'immediate',
  },
  {
    id: 6,
    difficulty: 'media',
    title: 'Produção',
    narration:
      'A Bora.ai já vende ingressos para vários eventos por semana. Hora de montar uma ' +
      'arquitetura de produção de verdade.',
    scenario: 'Como a Bora.ai roda a aplicação?',
    options: [
      { id: 'a', label: 'Duas ou mais instâncias em AZs diferentes, atrás de um Load Balancer', multiplier: 2.0 },
      { id: 'b', label: 'Uma instância só, com backup diário no S3', multiplier: 1.2 },
      { id: 'c', label: 'Uma instância só, sem backup, "porque é mais simples e mais barato"', multiplier: 0.5 },
      // nota: no texto final a opção 'c' vira ×0,5 (rodada média) ou ajuste combinado;
      // mantive os valores da documentação que você já aprovou.
    ],
    correct: 'a',
    explanation:
      'AZs existem justamente para isso, com energia e rede separadas. Quem coloca tudo numa só ' +
      'está apostando que a falha nunca vem.',
    // Esta é a rodada especial: o time decide ANTES, e o multiplicador só
    // é revelado e aplicado minutos depois, quando a "crise" é narrada.
    resolution: 'delayed',
    delayedNarration:
      'Minutos depois da abertura da venda de um festival grande, uma tempestade derruba uma AZ ' +
      'inteira. Vamos ver o que aconteceu com cada time...',
    delayedOutcomes: {
      a: 'A aplicação continua no ar. O Load Balancer redireciona o tráfego. Ninguém percebe.',
      b: 'Fica horas fora do ar até restaurar o backup em outra AZ, mas não perde dados.',
      c: 'Perde tudo: eventos, ingressos e compradores.',
    },
  },
];

module.exports = { ROUNDS };
