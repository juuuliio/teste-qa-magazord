# Questão 4.1 - Automação Mobile

**Contexto:** app iOS e Android com geolocalização, câmera, notificações push, storage offline e sincronização.

---

## 4.1.a) Ferramenta escolhida e comparação

A escolha depende de duas perguntas que eu faria antes de decidir: **em que tecnologia o app é construído** (nativo Kotlin/Swift, React Native, Flutter) e **quem vai escrever e manter os testes** (QA, devs ou ambos).

| Critério | **Appium 2** (UiAutomator2 / XCUITest) | **Detox** | **Maestro** |
|---|---|---|---|
| Modelo | Caixa-preta, protocolo WebDriver, servidor separado | Caixa-cinza: roda junto do app e sincroniza com a ponte JS do React Native | Caixa-preta, fluxos em YAML |
| Tecnologias de app | Qualquer uma (nativo, RN, Flutter via driver, híbrido) | Focado em React Native (nativo puro é possível, mas não é o caso típico) | Qualquer uma |
| Flakiness | Maior: precisa de esperas explícitas bem feitas | Baixa: espera automaticamente animações, rede e timers do app | Baixa: tolerância embutida e retries automáticos |
| Recursos do dispositivo (geo, permissões, push, rede) | **Mais completo**: `setGeoLocation`, `mobile: shell`, `setNetworkConnection`, abrir a gaveta de notificações, `pushFile` | Bom: `device.setLocation`, `device.sendUserNotification` (mock de push), `launchApp({ permissions })` | Básico: `setLocation`, permissões; push e rede são limitados |
| Linguagem | JS/TS, Java, Python, C#... | JS/TS | YAML (+ JS simples) |
| Device farms (BrowserStack, Sauce, AWS) | Suporte nativo, padrão de mercado | Limitado (emulador/simulador próprio) | Maestro Cloud; outras farms com suporte crescente |
| Velocidade | Mais lento | Rápido | Rápido |
| Curva de aprendizado | Média/alta | Média (precisa mexer no build do app) | **Baixa** |

**Minha escolha para este contexto: Appium 2 com WebdriverIO (TypeScript)** como base da suíte de regressão. Os motivos:
- O app depende fortemente de **recursos do sistema** (GPS, câmera, push, conectividade). Appium é a ferramenta com mais controle sobre o dispositivo e sobre o que está **fora** do app: gaveta de notificações, diálogos de permissão, configurações, modo avião.
- **Dois sistemas com um código só**, via WebDriver e o mesmo cliente WebdriverIO.
- Compatível com **device farms de dispositivos reais**, onde câmera e push precisam ser validados de verdade antes de release.
- A stack JS/TS se aproveita da mesma base de conhecimento que a equipe já usa em Playwright e Cypress na web.

**Quando eu mudaria a escolha:**
- **App em React Native com time de devs escrevendo testes:** Detox para a suíte de PR. A sincronização caixa-cinza praticamente elimina flakiness de espera, e `device.sendUserNotification` cobre o push. Appium ficaria só para os cenários de sistema e devices reais.
- **Maestro como complemento**, não como substituto: smoke tests rápidos em YAML (login, fluxo crítico) que QA manual e PO conseguem ler e escrever. É ótimo para cobertura ampla e barata; para lógica complexa, dados dinâmicos e mocks de sistema ele limita.
- **Espresso/XCUITest nativos:** os mais rápidos e estáveis, mas duplicam o código por plataforma. Faz sentido para testes de UI de componentes dentro do repositório do app, mantidos pelos devs, e não para a suíte E2E de QA.

## 4.1.b) Mock de geolocalização, câmera e notificações push

Princípio: **mockar o mais perto possível da borda do sistema**. Mock no SO (emulador) exercita mais código real que mock dentro do app. Quando o SO não permite (câmera no iOS), uso injeção de dependência em **build de teste**.

### Geolocalização
- **Emulador/simulador:** Android `adb emu geo fix <lon> <lat>`; iOS `xcrun simctl location <device> set <lat>,<lon>`. Os dois aceitam **rotas** (GPX no Android, `simctl location start` com waypoints no iOS) para simular deslocamento.
- **Via Appium**, no próprio teste: `driver.setGeoLocation({ latitude, longitude, altitude })`, com fixtures nomeadas (`LOCAIS.lojaJoinville`, `LOCAIS.foraDaAreaDeEntrega`).
- **Permissões** fazem parte do cenário: concedida, negada, "só durante o uso", revogada no meio do fluxo. Controlo com `autoGrantPermissions: false` e manipulo o diálogo, ou uso `adb shell pm grant/revoke` e `xcrun simctl privacy <device> grant location <bundle>`.
- **Cenários:** GPS desligado, precisão baixa, *mock location* detectado (se o app bloqueia fraude) e mudança de fuso/país.

### Câmera
- **Android emulator:** a câmera traseira pode ser uma *virtual scene* ou uma imagem/vídeo injetado (`-camera-back virtualscene` ou `emulated`), por exemplo um QR code ou documento de teste.
- **iOS simulator não tem câmera.** Uso duas abordagens complementares:
  1. **Build de teste com provedor de câmera injetável:** o app depende de uma interface `CameraProvider`; na build de QA (flag ou launch argument `-useFakeCamera`), ela devolve uma imagem de fixture. Isso testa todo o fluxo depois da captura (crop, upload, OCR).
  2. **Galeria como alternativa:** `xcrun simctl addmedia <device> foto.jpg` ou `driver.pushFile` no Android, e o teste segue pelo caminho "escolher da galeria".
- **Device farms** (BrowserStack/Sauce) oferecem *camera image injection* em device real, que uso na regressão pré-release para validar a câmera de verdade.
- **Cenários:** permissão negada, imagem ilegível/escura, arquivo grande e cancelamento da captura.

### Notificações push
- **iOS simulator** (Xcode 11.4+): `xcrun simctl push <device> <bundle-id> payload.apns`, com um payload JSON versionado por tipo de notificação.
- **Android:** envio pela API do FCM (HTTP v1) a partir do teste, com a service account do projeto Firebase **de QA**, para o token do dispositivo (que o app expõe na build de teste ou registra no mock de back-end). Alternativa sem rede: broadcast via `adb shell am broadcast` para o receiver do app.
- **Detox:** `device.sendUserNotification(payload)` / `launchApp({ userNotification })`.
- **Validações:**
  - recebimento com o app em **foreground** (banner interno), **background** e **fechado** (cold start);
  - conteúdo na gaveta de notificações (Android: `driver.openNotifications()`; iOS: deslizar a central via XCUITest);
  - o toque abre o **deep link** correto;
  - permissão de notificação negada não quebra o app;
  - payload inválido ou de versão antiga é ignorado sem crash.
- **O back-end que dispara o push** é testado separadamente: valido que ele chama FCM/APNs com o payload certo, mockando FCM e APNs (Parte 5).

## 4.1.c) Mesmos testes em iOS e Android sem duplicar código

1. **Identificadores de acessibilidade iguais nas duas plataformas.** É um acordo com o time de desenvolvimento, e o ponto que mais reduz duplicação: `testID` no React Native, `accessibilityIdentifier` no iOS, `contentDescription`/`resource-id` no Android, todos com o mesmo nome (`btn-finalizar-pedido`). No Appium: `$('~btn-finalizar-pedido')` funciona nos dois.
2. **Screen Objects com seletores por plataforma só quando necessário:**
   ```ts
   class CheckoutScreen extends BaseScreen {
     get finalizar() { return $('~btn-finalizar-pedido'); }            // comum
     get dialogoPermissao() {                                           // específico
       return this.porPlataforma({
         android: $('id=com.android.permissioncontroller:id/permission_allow_foreground_only_button'),
         ios: $('-ios predicate string:label == "Permitir Durante o Uso do App"'),
       });
     }
   }
   ```
3. **Comportamentos diferentes em estratégias, não em `if` espalhado:** concessão de permissão, abertura de notificações, manipulação de teclado e deep links ficam numa camada `DeviceActions` com implementação Android e iOS. O teste chama `device.concederPermissao('localizacao')`.
4. **Um spec, várias capabilities:** a configuração do WebdriverIO define `capabilities` para Android e iOS, e o CI roda a mesma suíte em matriz (`--platform android|ios`).
5. **Tags para o que é exclusivo** (`@android-only`, `@ios-only`), em vez de copiar specs, e um relatório que deixa explícito o que não rodou em qual plataforma.
6. **Dados e asserções de negócio compartilhados:** fixtures, builders de massa e clients de API ficam fora da camada mobile, reaproveitados também pelos testes de API e web.

## 4.1.d) Setup de ambiente local e CI/CD (alto nível)

**Local**
1. Node LTS + JDK 17 + Android SDK (platform-tools, emulator, system image) e um AVD de referência (ex.: Pixel, API 34).
2. macOS com Xcode e simuladores (iOS só roda em macOS).
3. `npm i -g appium` e depois `appium driver install uiautomator2` e `appium driver install xcuitest`. Diagnóstico com `appium-doctor` / `appium driver doctor`.
4. Builds de teste do app: `.apk` debug/QA e `.app` para simulador, apontando para o ambiente de QA/mock (flavor/scheme `qa`, com câmera fake e endpoints configuráveis).
5. `npm run test:android` / `npm run test:ios`, com o Appium Service do WebdriverIO subindo o servidor automaticamente. Um `README` e um `make doctor` ajudam o próximo QA a montar o ambiente em minutos, não em dias.

**CI/CD**

```text
PR:        build app (QA) → unit → API → mobile smoke (emulador Android + simulador iOS) → relatório
Nightly:   regressão completa em matriz (Android/iOS × versões de SO) em device farm (dispositivos reais)
Release:   regressão + cenários de câmera/push em devices reais + checklist exploratório
```

- **Android:** runner Linux com aceleração KVM (ex.: GitHub Actions + `reactivecircus/android-emulator-runner`), com cache de AVD e Gradle e snapshot do emulador para boot rápido.
- **iOS:** runner macOS (o mais caro), então o PR roda só o smoke e o restante vai para o nightly.
- **Paralelismo:** shards por spec e vários emuladores/devices em paralelo na farm (BrowserStack, Sauce Labs, AWS Device Farm, Firebase Test Lab).
- **Artefatos sempre:** vídeo, screenshots na falha, `logcat`/`syslog`, logs do Appium e relatório Allure com histórico de flakiness.
- **Segredos** (FCM service account, credenciais da farm) no secret store do CI, nunca no repositório.
- **Gate de qualidade:** smoke verde obrigatório para merge; teste com flakiness acima do limite vai para quarentena com ticket, nunca é ignorado em silêncio.

## 4.1.e) Validar sincronização e comportamento offline sem back-end real

**1. Back-end substituído por mock server controlável.** O app de QA aponta para um WireMock/MockServer (base URL por build config ou launch argument). O mock permite:
- respostas por cenário (sucesso, 500, timeout, 409 de conflito);
- **cenários com estado** (WireMock *scenarios*: o 1º POST falha e o 2º funciona);
- **verificação das requisições recebidas** (request journal): quantas chamadas, em que ordem, com que payload e com que idempotency key.

**2. Controle de conectividade:**
- Android: `driver.setNetworkConnection(...)` (modo avião, wifi, dados), `adb shell svc wifi disable` e `adb shell cmd connectivity airplane-mode enable`;
- iOS simulator não tem modo avião programático. Simulo a perda de rede no **mock/proxy** (mock fora do ar, timeout ou conexão recusada via toxiproxy/mitmproxy), ou com o Network Link Conditioner para rede lenta;
- rede **instável** (latência e perda de pacote) é tão importante quanto "sem rede".

**3. Cenários e o que cada um valida:**

| Cenário | Validação |
|---|---|
| Criar/editar dados offline | UI mostra o dado como "pendente de sincronização"; o dado sobrevive a fechar e reabrir o app (persistência local); nenhuma chamada chegou ao mock |
| Voltar a ficar online | O mock recebe exatamente as operações pendentes, **na ordem certa**, sem duplicatas (idempotency key); a UI marca como sincronizado |
| Falha durante a sync (500/timeout) | Retry com backoff; nada é perdido nem duplicado; o usuário é informado se o erro persistir |
| Conflito (mock responde 409 com versão mais nova do servidor) | Aplica a regra definida (last-write-wins, merge ou escolha do usuário) |
| App morto no meio da sync | Ao reabrir, retoma sem duplicar |
| Sync de dados vindos do servidor | Mock devolve deltas e paginação; a lista local reflete as mudanças, inclusive exclusões |
| Storage cheio / versão antiga do banco local | Migração do schema local entre versões do app preserva os dados pendentes |

**4. Pirâmide:** a maior parte da lógica de sync (fila de pendências, retry, resolução de conflito) deve ser testada em **testes unitários e de integração do motor de sync com transporte fake**, que são rápidos e determinísticos. O E2E mobile cobre poucos fluxos que provam a integração real entre UI, storage, rede e mock. Testar todas as combinações de conflito via UI seria lento e frágil.

**5. Inspeção do estado local:** na build de QA, uma tela de debug ou deep link que exporta o estado da fila de sync. Outra opção é ler o banco local (`adb exec-out run-as <pkg> cat databases/app.db` no Android; container do app no simulador iOS) para afirmar o estado sem depender só da UI.
