# Questão 3.1 - Importação de CSV

Implementação:
- **upload no the-internet:** [`testes/csv-upload.spec.js`](testes/csv-upload.spec.js);
- **importação de ponta a ponta no importador de referência** ([`importador/`](importador/)): [`testes/csv-importacao.spec.js`](testes/csv-importacao.spec.js);
- **gerador:** [`testes/utils/csv-generator.js`](testes/utils/csv-generator.js);
- **regras de importação:** [`importador/csv-validator.js`](importador/csv-validator.js);
- **exemplos de arquivo:** [`testes/fixtures/`](testes/fixtures/).

---

## 3.1.a) Validar que todas as 1000 linhas foram processadas corretamente

"Upload com sucesso" não prova que as 1000 linhas foram importadas. Valido por **reconciliação**: tudo o que entrou precisa ter saído como importado ou como rejeitado com motivo, e nada pode ter sido inventado ou duplicado.

1. **Contagem fecha:** `linhas no arquivo = importadas + rejeitadas`. O relatório da importação (job, tela ou API) precisa bater com o arquivo gerado. Como o teste gerou o arquivo, ele sabe a resposta certa de antemão.
2. **Conferência por chave, não só por quantidade:** 1000 registros importados podem esconder 1 perdido e 1 duplicado. Busco no destino (API ou banco de teste) todos os registros pela chave natural (e-mail) e comparo os conjuntos: `esperados − importados = ∅` e `importados − esperados = ∅`.
3. **Conteúdo, campo a campo:** comparo todos os campos (ou uma amostra estratificada: primeira linha, última linha, linhas com acento, aspas e vírgula), checando encoding (`São Paulo` não pode virar `SÃ£o Paulo`), trims, tipos e precisão numérica.
4. **Integridade do arquivo recebido:** hash SHA-256 do que foi enviado contra o que o servidor armazenou. Isso prova que nada foi truncado ou convertido no transporte.
5. **Idempotência:** reimportar o mesmo arquivo não pode duplicar registros (ou precisa seguir a regra definida: atualizar, ignorar ou rejeitar).
6. **Processamento assíncrono:** importações grandes costumam ser jobs. Faço polling do status com timeout (`expect.poll`) até `CONCLUIDO`, e valido também que não há job "pendurado" e que o tempo fica dentro do SLA.

**No teste prático:**
- **the-internet**, que só armazena o arquivo: o arquivo é gerado com N linhas conhecidas e pré-validado (0 erros, N registros). Depois do upload, faço download do arquivo **gravado pelo servidor** em `/download/<nome>`, comparo o SHA-256 byte a byte e revalido: os mesmos N registros, todos válidos. Os nomes de arquivo são únicos por execução, porque o servidor é compartilhado.
- **importador de referência**, que importa de verdade (CT-ARQ-12): as 1000 linhas são importadas pela tela, e a base é consultada pela API e comparada **campo a campo, por chave**, com os registros gerados. São os itens 1 a 3 acima, aplicados de fato. A reimportação (item 5, idempotência) é o CT-ARQ-15.

## 3.1.b) Testar cenários de erro (arquivo corrompido, dados inválidos)

Organizo os cenários por **nível**, porque cada nível tem uma expectativa diferente de comportamento:

| Nível | Cenários | Comportamento esperado |
|---|---|---|
| Arquivo | vazio (0 bytes); só cabeçalho; binário/corrompido; encoding errado (Latin-1, UTF-16); BOM; extensão/MIME errados; acima do tamanho máximo; truncado | Rejeição imediata e total, mensagem clara, **nenhum** efeito colateral no banco |
| Estrutura | separador errado (`;`); cabeçalho ausente, renomeado ou fora de ordem; colunas a mais ou a menos; aspas não fechadas; quebra de linha dentro de campo; CRLF vs LF | Rejeição do arquivo (layout) ou da linha (colunas), com **número da linha** |
| Campo (regra de negócio) | obrigatório vazio; e-mail inválido; idade não numérica, negativa ou fora da faixa; limites (0 e 120 válidos; -1 e 121 inválidos); espaços extras | Linha rejeitada com campo e motivo; demais linhas seguem a política definida |
| Conjunto | duplicata dentro do arquivo (case-insensitive); duplicata com registro já existente no banco | Primeira ocorrência aceita, demais rejeitadas (ou a regra definida) |
| Relacionamento | cidade, categoria ou cliente referenciado que não existe | Linha rejeitada sem criar o registro relacionado "por acidente" |
| Segurança | CSV injection (`=HYPERLINK(...)`, `+cmd`); nome de arquivo com path traversal; arquivo gigante (DoS) | Valor escapado ou neutralizado; upload recusado |

Pontos que considero essenciais:
- **Política de falha parcial explícita.** "Tudo ou nada" ou "importa as válidas e devolve relatório das inválidas"? O teste precisa afirmar a regra, e ela precisa estar documentada; essa é uma das primeiras perguntas que faço ao PO.
- **Mensagens acionáveis:** linha, campo, valor recebido e motivo. "Erro ao importar" não ajuda o usuário. Nos testes, comparo `{ linha, codigo }` exatos, não só "falhou".
- **Sem efeitos colaterais:** depois de uma rejeição, conto os registros no destino e confirmo que nada mudou.
- **Erros em escala:** um erro na linha 734 de 1000 precisa ser encontrado na linha 734. O gerador injeta defeitos em posições conhecidas de arquivos grandes (CT-ARQ-09), o que valida a localização do erro e a performance juntos.

**Como montei a massa de erro:**
- **Fixtures estáticas versionadas** (`fixtures/*.csv`) para os casos clássicos: legíveis na revisão de código e estáveis. O `corrompido.csv` tem um cabeçalho legível seguido de bytes binários (assinatura PNG, byte nulo, sequências UTF-8 inválidas). O `.gitattributes` marca as fixtures como `-text` para o Git não converter quebras de linha.
- **Gerador dinâmico** para volume (10/100/1000 linhas) e para injetar defeitos em posições escolhidas, com semente reproduzível.

**Site de teste e importador:** o the-internet aceita qualquer arquivo; o único erro do lado do servidor é o envio sem arquivo (HTTP 500, coberto pelo CT-ARQ-08). Para os arquivos inválidos, os testes nele verificam que o arquivo chega íntegro e que as regras de importação apontam erro e linha.

Para testar a **rejeição feita pelo servidor**, como num sistema real, o projeto inclui um importador de referência (`importador/server.js`, Node sem dependências, iniciado pelo Playwright). Com os mesmos arquivos inválidos, o CT-ARQ-13 verifica:
- **HTTP 422** com erro e linha;
- **tabela de erros** na tela;
- **base sem nenhum registro gravado** (política tudo ou nada).

Também cobre, com o importador:
- um único erro em 1000 linhas rejeitando o arquivo inteiro (CT-ARQ-14);
- reimportação do mesmo arquivo (CT-ARQ-15);
- arquivo acima do limite, com HTTP 413 (CT-ARQ-16).
