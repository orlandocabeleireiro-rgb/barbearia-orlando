# Barbearia Orlando — App de Marcações

Contexto para o Claude Code. Lê isto antes de mexer no código.

## O que é

Aplicação web de marcações online da **Barbearia Orlando** (Rua Álvaro de Castelões, Porto). Os clientes registam-se, ficam pendentes até o administrador aprovar e depois marcam serviços. Os barbeiros e o dono gerem tudo numa área de administração na mesma página.

- Produção: `marcacoes.barbeariaorlando.pt` (domínio próprio via GitHub Pages, gerido na Domínios.pt)
- Repositório: `orlandocabeleireiro-rgb/barbearia-orlando`
- O dono (Orlando) não é programador e trabalha sobretudo a partir do telemóvel ou tablet. Explicações passo a passo, em português de Portugal.

## Stack

- **Um único `index.html`**, com HTML, CSS e JS inline, sem framework e sem build step.
- **Firebase** (projeto `barbearia-orlando-c660c`), SDK 10.12.0 carregado por CDN em `<script type="module">`:
  - Firestore, com persistência offline (`enableIndexedDbPersistence`)
  - Authentication (email/password), usado por clientes **e** administradores
  - Cloud Function `deleteUserAccount` (Callable/`onCall`, `us-central1`), que apaga contas de login e só aceita pedidos de admins (perfil em `admins`). O código está em `functions/index.js` e publica-se pelo Google Cloud Shell (ver `functions/COMO_PUBLICAR.md`). O site chama-a através de `deleteAuthAccount(uid)`.
  - Cloud Function `sendBookingReminders` (agendada, todos os dias às 18:00 Europe/Lisbon, `us-central1`): envia pelo EmailJS (API REST, modelo `template_fkf9m6i` "Lembrete") um lembrete às marcações `confirmada` de amanhã com `clientId` e email na ficha, e grava `reminderSentAt` na marcação. A lógica está em `functions/reminders.js`; a Private Key do EmailJS é o segredo `EMAILJS_PRIVATE_KEY` no Firebase.
- **EmailJS** (`service_bmptmfn`)
  - `template_v3y5vbg`: conta aprovada
  - `template_1fk81zm`: confirmação de marcação
  - `template_fkf9m6i`: lembrete no dia anterior (enviado pela Cloud Function, não pelo site)
- **SheetJS** (CDN) para o backup da agenda em `.xlsx`
- **PWA**: `manifest.json`, `sw.js` (cache offline), favicons `favicon-16/32.png`, `icon-192.png`, `apple-touch-icon.png`, logótipo em `logo.png` (400×400, emblema redondo com fundo transparente). Os ícones (`favicon-16/32`, `icon-192/512`) também são o emblema com fundo transparente; `apple-touch-icon.png` e os `icon-*-maskable.png` têm os cantos pretos (#0D0D0D), porque o iPhone e o Android não aceitam transparência aí
- Alojamento: GitHub Pages

## Estrutura do `index.html`

1. `<style>` com todo o CSS. As cores estão em `:root` (`--gold #C9A84C`, `--black #0D0D0D`, etc.). O tema é escuro e dourado, com as fontes Bebas Neue e Inter.
2. `<script type="module">` com o Firebase: init, listeners em tempo real, auth e transações. Expõe tudo no `window` (`window._db`, `window._fdb`, `window._fauth`, `window._fbLogin`, `window._fbCreateBookingTransactional`, …).
3. O HTML dos ecrãs: header, `auth-screen`, `admin-screen`, `booking-screen`, `pending-screen` e os modais.
4. `<script>` clássico com toda a lógica da app, que usa o objeto global `DB`.

### Ponte entre o módulo e o script clássico

O módulo Firebase e o script clássico partilham estado pelo `window`. O utilizador ativo vive em `window.currentUser` **e** na variável `currentUser` do script clássico. A função `window.setCurrentUser()` / `syncCurrentUser()` mantém os dois sincronizados. Já houve crashes por estes dois estados ficarem dessincronizados, por isso não cries uma terceira cópia.

### Estado em memória

O objeto `DB` (`clients`, `bookings`, `admins`, `waitlist`, `services`, `barbers`, `closures`, `extraHours`, `busySlots`, `settings`) é preenchido pelos listeners `onSnapshot`. As escritas passam pelos helpers `fsSet` / `fsUpdate` / `fsDel` / `fsAdd`. `saveDB()` é um no-op que ficou da versão antiga com localStorage.

## Coleções Firestore

| Coleção | Conteúdo | Notas |
|---|---|---|
| `clients` | perfil do cliente (id = UID do Auth) | `status`: `pendente` / `ativo` / `rejeitado`; objeto `gdpr`; `lastSeenAt` (ms, gravado pelo próprio cliente ao abrir a app, no máximo a cada 6 h) |
| `admins` | perfis de admin (id = UID do Auth) | `level`: `superadmin` / `manager`; `permissions[]`; `barberId` opcional; `authType: 'firebase'`. Todos os admins entram com email (Firebase Auth); o login antigo com `user` + `passHash` foi removido |
| `bookings` | marcações | `rawDate` (AAAA-MM-DD), `time`, `serviceId`, `barberId`, `status` (`confirmada`, `pendente`, `cancelada`, `faltou`), `clientPreference` (`com`/`sem`), `bookedVia` (`client`/`admin`), `paymentMethod`, `recur`/`recurGroup` |
| `busy_slots` | horários ocupados, **sem dados pessoais** | id = `barberId_data_hora`. É isto que os clientes leem para ver a disponibilidade |
| `waitlist` | lista de espera | `preferredTimes[]`, `status` (`pendente`/`resolvido`) |
| `closures` | horários fechados | `barberId` (ou `'all'`), intervalo de datas, `weekdays[]` opcional, horas opcionais (sem horas = dia inteiro) |
| `extra_hours` | horário extra fora do normal | `barberId`, datas, `timeStart`/`timeEnd` |
| `services` / `barbers` | catálogo | são criados com valores por omissão se a coleção estiver vazia (`seedIfEmpty`) |
| `notifications` | notificações do sino | `forClientId`, `adminOnly`, `read`, `createdAtMs` |
| `settings/app` | `bookingsPaused`, `pauseMessage` | pausa as novas marcações dos clientes |

Os clientes só leem os seus próprios `clients/bookings/waitlist/notifications` (com queries `where('clientId','==',uid)`). As regras do Firestore impõem o mesmo, por isso **nunca faças fetch da coleção inteira no lado do cliente**: é rejeitado.

## Regras de negócio

- **Horário:** 09:00–13:00 e 14:30–19:30, em slots de 30 min. Domingo está fechado. Ver `generateAllSlots()`.
- **Serviços por omissão:** Corte de Cabelo €15 (30 min), Barba €10,50 (30 min), Cabelo & Barba €20 (60 min), Corte Criança €13,50 (30 min).
- **Barbeiros:** Orlando, Solange, Ariane.
- **Anti-dupla-marcação:** criar uma marcação usa **sempre** `window._fbCreateBookingTransactional(booking, slots)`, que numa transação confirma que os `busy_slots` estão livres e grava a marcação junto com os slots. Não cries marcações com `fsSet` direto se não forem canceladas.
- Sempre que uma marcação muda, é cancelada ou apagada, mantém `busy_slots` em sincronia com `markSlotsBusy` / `clearSlotsBusy` e invalida a cache `BUSY` (`invalidateBusy`).
- Antes de mostrar horários ao cliente, `refreshBusySlotsForDate` / `refreshBusySlotsForRange` leem os dados frescos do Firestore, para fechar a janela em que o listener ainda não chegou.
- **"Sem preferência":** o barbeiro é atribuído automaticamente (`getAnyBarberAvailability`).
- **Lista de espera:** ao cancelar uma marcação, `checkAndFillWaitlist` atribui a vaga ao primeiro pedido compatível. Os pedidos de dias passados são resolvidos automaticamente.
- **Agenda admin:** só deixa recuar até ontem. Clicar num dia passado com marcação abre a forma de pagamento (MBWay/Revolut). É possível marcar falta (`faltou`).
- **Registo de clientes:** fica `pendente` até aprovação. `approveClient` envia o email de ativação.
- **Cliente criado no admin** ("+ Novo Cliente"): `window._fbCreateClientAccount` cria o login numa app Firebase temporária (para não mexer na sessão do admin) e grava o perfil já `ativo` com `createdByAdmin: true`. Se as regras recusarem a gravação pelo admin (`permission-denied`), cria o perfil como o próprio cliente (`status: 'pendente'`, como `_fbRegister`) e ativa-o pela sessão do admin (como `approveClient`). Se o email já tiver um login sem perfil (nem em `clients` nem em `admins`) e a password coincidir, reaproveita-o. Se a gravação falhar, o login acabado de criar é apagado. Ao editar, o email fica bloqueado porque é o login; só `nome`, `apelido` e `tel` são gravados.
- **Atividade do cliente** (coluna "Atividade" e filtro na lista de Clientes, `clientActivity`): 🟢 Ativo = marcação nos últimos 3 meses ou futura; 🟡 Pouco ativo = última há mais de 3 meses; 🔴 Sem marcações = registado há mais de 1 mês e nunca marcou; 🆕 Novo = registado há menos de 1 mês sem marcações. Canceladas não contam; as do admin contam quando têm `clientId`. Não mostra valores.
- **Pedido de avaliação no Google** (`maybeShowReviewPrompt`): aviso no ecrã do cliente quando tem pelo menos 1 marcação passada (não cancelada nem falta). "Avaliar agora" (abre `SOCIAL_LINKS.google_review`) e "Já avaliei" gravam `reviewStatus` (`clicked`/`done`) e não volta. "Agora não" grava `reviewPromptCount` e `reviewSnoozedUntilBooking`; só volta depois de um corte mais recente, no máximo 2 vezes. Nada é oferecido em troca (regras do Google). O admin vê a resposta na coluna Atividade.
- **Quem marcou** (`bookedByLabel`): coluna "Marcado por" na lista de Marcações (só aí, não na agenda). Mostra "Cliente (app)" (`bookedVia:'client'`), "Lista de espera" (`fromWaitlist`), o nome do admin (`createdBy`, gravado nas marcações do painel desde esta versão) ou "Admin" nas antigas.
- **Permissões:** um `manager` só vê os separadores incluídos em `permissions` (`applyAdminPermissions`). Um `superadmin` vê tudo.

## Preferências do Orlando

- **Não mostrar faturação/receitas no painel admin.**
- Texto da interface em **português de Portugal** (ex.: "Leia" e não "Escaneie", "telemóvel", "registo").
- Mudanças pequenas e testáveis. Ele testa no telemóvel, por isso o layout tem de funcionar a 390px.

## Pontos de atenção

- `firebaseConfig` e a chave pública do EmailJS estarem no código é normal. A segurança depende das regras do Firestore.

## Como testar

Não há testes automáticos. Para testar, abre `index.html` num servidor local (ex.: `npx serve`) ou faz push para o GitHub Pages e testa no telemóvel: registo → aprovação no admin → marcação → agenda → cancelamento.

As Cloud Functions estão em `functions/` e publicam-se com o Firebase CLI (`firebase deploy --only functions`). Ver `functions/COMO_PUBLICAR.md`.
