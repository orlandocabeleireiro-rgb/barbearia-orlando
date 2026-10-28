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
- **EmailJS** (`service_bmptmfn`)
  - `template_v3y5vbg`: conta aprovada
  - `template_1fk81zm`: confirmação de marcação
- **SheetJS** (CDN) para o backup da agenda em `.xlsx`
- **PWA**: `manifest.json`, `sw.js` (cache offline), favicons `favicon-16/32.png`, `icon-192.png`, `apple-touch-icon.png`, logótipo em `logo.jpg` (400×400)
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
| `clients` | perfil do cliente (id = UID do Auth) | `status`: `pendente` / `ativo` / `rejeitado`; objeto `gdpr` |
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
