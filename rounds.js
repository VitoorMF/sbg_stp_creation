// rounds.js
// As 9 rodadas da Bora.ai, em ordem cronológica. Cada opção tem uma faixa
// (best, mid, worst) e o multiplicador sai da dificuldade, em config.js.
//
// Campos:
//   moment       momento da startup (aparece no cabeçalho)
//   title        a decisão, curta
//   difficulty   facil | media | dificil
//   narration    o que o apresentador conta antes (projetor)
//   scenario     o problema, com o detalhe que desempata (celular e projetor)
//   options      3 opções; feedback aparece para quem escolheu, na revelação
//   explanation  a frase da revelação
//   notes        só para o admin: o detalhe que desempata e cuidados ao narrar
//   twist        (opcional) crise revelada depois da decisão
//   bet          (opcional) rodada de aposta: o time aposta antes da pergunta

const ROUNDS = [
  {
    moment: 'Lançamento',
    title: 'Onde guardar ingressos e compradores?',
    difficulty: 'facil',
    narration:
      'A Bora.ai acabou de nascer. Antes de vender o primeiro ingresso, vocês precisam decidir onde ficam os dados.',
    scenario:
      'A Bora.ai vai guardar eventos, lotes, ingressos e compradores. Dois fãs não podem levar o último ' +
      'ingresso do lote ao mesmo tempo, e o financeiro quer relatórios como "quantos ingressos do lote 2 ' +
      'do show X foram vendidos para compradores de SP?". Onde vocês guardam esses dados?',
    options: [
      {
        id: 'rds',
        tier: 'best',
        label: 'Amazon RDS, um banco relacional com tabelas ligadas entre si',
        feedback:
          'Tabelas relacionadas e transações: o banco garante que o último ingresso vai para um só comprador, e o relatório vira uma consulta SQL.',
      },
      {
        id: 'dynamo',
        tier: 'mid',
        label: 'Amazon DynamoDB, um banco NoSQL que escala automaticamente',
        feedback:
          'Ele até evita a venda dupla com escrita condicional, mas cruzar evento, lote e comprador em relatórios dá muito mais trabalho do que num banco relacional.',
      },
      {
        id: 's3json',
        tier: 'worst',
        label: 'Arquivos JSON no Amazon S3, um arquivo por evento',
        feedback:
          'O S3 guarda arquivos, não faz consulta nem transação. Dois fãs salvando o mesmo arquivo ao mesmo tempo podem levar o mesmo ingresso.',
      },
    ],
    explanation:
      'Dados que se relacionam, relatórios cruzados e a garantia de não vender o mesmo ingresso duas vezes apontam para um banco relacional como o RDS.',
    notes:
      'Desempate: o relatório que cruza evento, lote e comprador. É o forte do banco relacional.',
  },
  {
    moment: 'Divulgação',
    title: 'Onde guardar cartazes e PDFs?',
    difficulty: 'facil',
    narration:
      'Os primeiros eventos estão no ar. Cada um tem cartaz e fotos, e cada compra gera um PDF do ingresso.',
    scenario:
      'Cada evento tem cartaz e fotos do line-up, e cada compra gera um PDF do ingresso. Esses arquivos só ' +
      'crescem, e no mês que vem a Bora.ai vai rodar em mais de um servidor. Onde vocês guardam os arquivos?',
    options: [
      {
        id: 's3',
        tier: 'best',
        label: 'No Amazon S3, guardando no banco só o endereço de cada arquivo',
        feedback:
          'Armazenamento praticamente ilimitado, barato e acessível de qualquer servidor. O banco fica leve, só com o link.',
      },
      {
        id: 'ebs',
        tier: 'mid',
        label: 'No disco (EBS) da própria instância EC2',
        feedback:
          'Funciona com um servidor só. Com o segundo servidor, cada máquina fica com arquivos diferentes, e o disco precisa ser aumentado à mão.',
      },
      {
        id: 'db',
        tier: 'worst',
        label: 'Dentro do banco de dados, junto com os dados de cada ingresso',
        feedback:
          'Imagens e PDFs deixam o banco pesado, lento e caro, e o backup demora cada vez mais.',
      },
    ],
    explanation:
      'Arquivos que só crescem e precisam ser lidos por vários servidores vão para o S3. O banco guarda só o link.',
    notes: 'Desempate: "mais de um servidor" derruba o disco da EC2.',
  },
  {
    moment: 'Primeiro mês',
    title: 'A fatura veio alta',
    difficulty: 'facil',
    narration: 'Chegou a primeira fatura da AWS. Ninguém no time esperava aquele número.',
    scenario:
      'A fatura veio com R$ 5.000 a mais: um ambiente de testes ficou ligado o mês inteiro e ninguém lembrou ' +
      'de desligar. A fatura só chega depois que o mês acaba. O que vocês fazem para isso não se repetir?',
    options: [
      {
        id: 'budgets',
        tier: 'best',
        label: 'Criar um orçamento no AWS Budgets com alerta por e-mail quando o gasto passar do limite',
        feedback:
          'O alerta chega durante o mês, quando ainda dá tempo de desligar o que ficou esquecido.',
      },
      {
        id: 'sexta',
        tier: 'mid',
        label: 'Combinar que alguém do time confere o console da AWS toda sexta-feira',
        feedback:
          'Ajuda, mas depende da memória de alguém. Na semana de prova, ninguém confere.',
      },
      {
        id: 'producao',
        tier: 'worst',
        label: 'Apagar o ambiente de testes e passar a testar direto em produção',
        feedback:
          'Economiza agora, mas o próximo bug vai direto para quem está comprando ingresso.',
      },
    ],
    explanation:
      'O AWS Budgets avisa assim que o gasto real ou previsto passa do limite, sem depender da memória de ninguém. Ele alerta, mas não desliga nada sozinho.',
    notes:
      'Desempate: "a fatura só chega depois que o mês acaba". O Budgets não está no roteiro da aula: vale uma frase sobre ele na revelação.',
  },
  {
    moment: 'Expansão',
    title: 'Fãs no Japão reclamam de lentidão',
    difficulty: 'media',
    narration: 'Um artista brasileiro anunciou turnê no Japão, e a Bora.ai vai vender os ingressos.',
    scenario:
      'Fãs no Japão reclamam que a página do evento demora para abrir. A página tem fotos grandes, vídeo e ' +
      'line-up, iguais para todo mundo. Os servidores ficam na Região de São Paulo e estão usando só 15% de ' +
      'CPU. O que vocês fazem?',
    options: [
      {
        id: 'cloudfront',
        tier: 'best',
        label: 'Colocar o Amazon CloudFront na frente do site, com cache perto dos fãs',
        feedback:
          'O CloudFront guarda cópias em pontos de presença no mundo todo, inclusive no Japão. A página sai de perto do fã.',
      },
      {
        id: 'toquio',
        tier: 'mid',
        label: 'Subir uma cópia completa da aplicação na Região de Tóquio',
        feedback:
          'Resolve a distância, mas dobra a infraestrutura e o custo e cria o problema de manter dois bancos sincronizados.',
      },
      {
        id: 'maior',
        tier: 'worst',
        label: 'Trocar a instância EC2 por uma maior',
        feedback:
          'O servidor não está sobrecarregado (15% de CPU). A demora é a distância até o Brasil, e máquina maior não encurta o caminho.',
      },
    ],
    explanation:
      'A lentidão vem da distância, não da CPU. Conteúdo igual para todos é caso de CDN: o CloudFront entrega a partir de servidores perto de quem acessa.',
    notes: 'Desempate: "15% de CPU" elimina a EC2 maior, e "iguais para todo mundo" favorece o cache.',
  },
  {
    moment: 'Nova funcionalidade',
    title: 'QR code por e-mail',
    difficulty: 'media',
    narration:
      'Os fãs pediram: querem receber o ingresso com QR code no e-mail logo depois da compra.',
    scenario:
      'O envio do QR code por e-mail passa dias quase sem uso. Quando abre a venda de um show grande, chegam ' +
      'milhares de pedidos em poucos minutos. Como vocês rodam esse envio?',
    options: [
      {
        id: 'lambda',
        tier: 'best',
        label: 'Uma função AWS Lambda, executada a cada compra confirmada',
        feedback:
          'Paga só quando executa, fica parada sem custo nos dias tranquilos e escala sozinha no pico.',
      },
      {
        id: 'ec2grande',
        tier: 'mid',
        label: 'Uma instância EC2 grande, só para isso, ligada o tempo todo',
        feedback:
          'Aguenta o pico, mas vocês pagam uma máquina grande 24 horas por dia para ficar parada quase sempre.',
      },
      {
        id: 'ec2pequena',
        tier: 'worst',
        label: 'Uma instância EC2 pequena, só para isso, ligada o tempo todo',
        feedback:
          'Custa pouco, mas no pico a fila de e-mails cresce e o fã chega no show sem o QR code.',
      },
    ],
    explanation:
      'Carga parada na maior parte do tempo e com picos repentinos é o caso clássico do Lambda: paga por execução e escala sozinho.',
    notes: 'Desempate: "dias quase sem uso" junto com "milhares em poucos minutos".',
  },
  {
    moment: 'Produção',
    title: 'Como a aplicação vai rodar?',
    difficulty: 'media',
    narration:
      'A venda do maior festival do ano abre sexta às 10h. O investidor foi direto: "não pode cair".',
    scenario:
      'Chegou a hora de colocar a aplicação em produção para valer. A venda abre sexta às 10h, o investidor ' +
      'disse que o site não pode cair e o orçamento está apertado. Como a aplicação vai rodar?',
    options: [
      {
        id: 'multiaz',
        tier: 'best',
        label: 'Duas instâncias EC2 em zonas de disponibilidade (AZs) diferentes, atrás de um Load Balancer',
      },
      {
        id: 'mesmaaz',
        tier: 'mid',
        label: 'Duas instâncias EC2 na mesma AZ, atrás de um Load Balancer',
      },
      {
        id: 'unica',
        tier: 'worst',
        label: 'Uma instância EC2 grande, que aguenta todo o tráfego sozinha',
      },
    ],
    twist: {
      title: 'Sexta, 10h07: uma AZ inteira caiu',
      narration:
        'Sete minutos depois da abertura da venda, uma falha de energia derruba uma zona de disponibilidade inteira de São Paulo. Vejam o que aconteceu com cada escolha.',
      outcomes: {
        multiaz:
          'O Load Balancer parou de mandar tráfego para a AZ que caiu e a outra instância seguiu vendendo. Os fãs nem perceberam.',
        mesmaaz:
          'As duas instâncias estavam na AZ que caiu e foram juntas. O site ficou 40 minutos fora até tudo subir em outra AZ.',
        unica: 'A única instância caiu junto com a AZ. O site ficou horas fora do ar, no pico da venda.',
      },
    },
    explanation:
      'Cada AZ tem energia e rede próprias. Só instâncias espalhadas em AZs diferentes sobrevivem à queda de uma delas.',
    notes:
      'NÃO fale da queda antes de revelar. Desempate: "não pode cair". A opção B protege contra a falha de uma máquina, não da AZ inteira.',
  },
  {
    moment: 'Pré-venda',
    title: 'A página de espera do festival',
    difficulty: 'dificil',
    narration: 'Falta um mês para o festival. Antes da venda, o marketing quer uma página de espera.',
    scenario:
      'A página de espera do festival tem line-up, mapa e perguntas frequentes. São esperadas 100 mil visitas ' +
      'no dia do anúncio. Ninguém faz login e o conteúdo só muda quando o marketing envia um arquivo novo. ' +
      'Como vocês publicam essa página?',
    options: [
      {
        id: 'estatico',
        tier: 'best',
        label: 'Arquivos no Amazon S3 como site estático, com o CloudFront na frente',
        feedback:
          'Sem servidor para manter: o S3 guarda as páginas e o CloudFront entrega do cache para 100 mil pessoas gastando pouco.',
      },
      {
        id: 'ec2cf',
        tier: 'mid',
        label: 'Uma instância EC2 servindo as páginas, com o CloudFront na frente',
        feedback:
          'O cache segura o tráfego, mas vocês pagam e mantêm um servidor 24 horas por dia para entregar arquivos que não mudam.',
      },
      {
        id: 'pesada',
        tier: 'worst',
        label: 'Load Balancer + instâncias EC2 com Auto Scaling + banco Aurora',
        feedback:
          'Aguentaria, mas é a arquitetura de uma aplicação completa para uma página sem login e sem dados. Vocês pagam caro por peças paradas.',
      },
    ],
    explanation:
      'Página sem login, que só muda quando alguém envia um arquivo, é um site estático: S3 com CloudFront aguenta o pico gastando pouco.',
    notes:
      'A armadilha é a arquitetura pesada parecer a mais "robusta". Desempate: "ninguém faz login" e "só muda quando o marketing envia um arquivo".',
  },
  {
    moment: 'Abertura da venda',
    title: 'A venda vai abrir',
    difficulty: 'dificil',
    narration:
      'Chegou o dia. A venda do festival abre em uma hora, e o tráfego deve ser 10 vezes maior que o normal.',
    scenario:
      'Agora a página precisa vender: login, escolha do lote, pagamento e baixa do estoque de ingressos no ' +
      'banco. Na abertura, o tráfego vai ser 10 vezes maior que o normal, e cada página de compra carrega o ' +
      'mapa e as fotos do festival. Qual arquitetura vocês usam?',
    options: [
      {
        id: 'completa',
        tier: 'best',
        label: 'Route 53 → CloudFront → Load Balancer → EC2 com Auto Scaling → Aurora/RDS',
        feedback:
          'Cada peça tem uma função: o CloudFront entrega mapa e fotos pelo cache, o Auto Scaling cria instâncias no pico e o banco controla o estoque.',
      },
      {
        id: 'semcf',
        tier: 'mid',
        label: 'Route 53 → Load Balancer → EC2 com Auto Scaling → Aurora/RDS',
        feedback:
          'Funciona, mas sem o CloudFront cada mapa e cada foto sai das instâncias EC2, que precisam escalar muito mais no pico.',
      },
      {
        id: 'estatico',
        tier: 'worst',
        label: 'S3 + CloudFront, igual à página de espera',
        feedback:
          'Funcionou na pré-venda, mas site estático não faz login, não processa pagamento e não baixa estoque. Sem servidor, não há venda.',
      },
    ],
    explanation:
      'Aplicação dinâmica com pico precisa de servidores que escalam e de um banco. O CloudFront na frente tira das instâncias o peso das imagens.',
    notes:
      'A armadilha é repetir a resposta da rodada 7. Desempate: "login, pagamento, estoque" e "carrega o mapa e as fotos".',
  },
  {
    moment: 'Aposta final',
    title: 'Onde moram os dados dos compradores?',
    difficulty: 'dificil',
    bet: true,
    narration:
      'Última decisão. Antes de ver a pergunta, cada time aposta uma parte do valuation. Acertou, a aposta dobra. Errou, perde.',
    scenario:
      'O jurídico avisou: CPF e dados pessoais dos compradores precisam ficar armazenados no Brasil. E a venda ' +
      'não pode parar se uma AZ inteira cair. Onde fica o banco de dados dos compradores?',
    options: [
      {
        id: 'spmultiaz',
        tier: 'best',
        label: 'Na Região de São Paulo, com RDS Multi-AZ (cópia automática em outra AZ)',
        feedback:
          'Os dados ficam no Brasil e, se uma AZ cair, o banco passa sozinho para a cópia na outra AZ.',
      },
      {
        id: 'spunica',
        tier: 'mid',
        label: 'Na Região de São Paulo, em uma única AZ, com backup diário',
        feedback:
          'Os dados ficam no Brasil, mas se a AZ cair a venda para até restaurar o backup, e as compras desde o último backup se perdem.',
      },
      {
        id: 'virginia',
        tier: 'worst',
        label: 'Na Região da Virgínia do Norte (EUA), com Multi-AZ, que é mais barata',
        feedback:
          'Sobrevive à queda de uma AZ, mas os dados saem do Brasil, contrariando a exigência do jurídico.',
      },
    ],
    explanation:
      'A Região define onde os dados ficam, e as várias AZs dentro dela mantêm o sistema no ar. São Paulo com Multi-AZ atende as duas exigências.',
    notes: 'Região = onde os dados moram (exigência do jurídico). AZ = resiliência dentro da Região.',
  },
];

// Confere o formato na subida do servidor: um erro de digitação aqui não pode
// aparecer só no meio do evento.
function validateRounds(rounds) {
  const errors = [];
  rounds.forEach((r, i) => {
    const where = `rodada ${i + 1}`;
    for (const f of ['moment', 'title', 'difficulty', 'narration', 'scenario', 'explanation']) {
      if (typeof r[f] !== 'string' || !r[f].trim()) errors.push(`${where}: campo "${f}" vazio`);
    }
    if (!['facil', 'media', 'dificil'].includes(r.difficulty)) {
      errors.push(`${where}: dificuldade inválida "${r.difficulty}"`);
    }
    if (!Array.isArray(r.options) || r.options.length !== 3) {
      errors.push(`${where}: precisa de exatamente 3 opções`);
      return;
    }
    const tiers = r.options.map((o) => o.tier).sort().join(',');
    if (tiers !== 'best,mid,worst') errors.push(`${where}: as opções precisam ser uma best, uma mid e uma worst`);
    const ids = new Set(r.options.map((o) => o.id));
    if (ids.size !== 3) errors.push(`${where}: ids de opção repetidos`);
    for (const o of r.options) {
      if (typeof o.label !== 'string' || !o.label.trim()) errors.push(`${where}: opção ${o.id} sem texto`);
      const hasText = r.twist ? r.twist.outcomes && r.twist.outcomes[o.id] : o.feedback;
      if (!hasText) errors.push(`${where}: opção ${o.id} sem feedback${r.twist ? ' (twist.outcomes)' : ''}`);
    }
    if (r.twist && (!r.twist.title || !r.twist.narration)) errors.push(`${where}: twist incompleto`);
  });
  return errors;
}

module.exports = { ROUNDS, validateRounds };
