# Como publicar a Cloud Function `deleteUserAccount`

Esta função apaga a conta de login de um cliente ou administrador quando é
apagado no painel admin. Só aceita pedidos de quem tem sessão iniciada como
administrador, por isso já não precisa de segredo nenhum no site.

Tudo se faz no **Google Cloud Shell**, no browser (funciona no tablet; no
telemóvel é possível mas apertado).

## 1. Abrir o Cloud Shell

1. Abre https://shell.cloud.google.com com a conta Google do Firebase.
2. Espera até aparecer a linha de comandos (um ecrã preto com `$`).

## 2. Descarregar o código

Copia e cola esta linha e carrega em Enter:

```
rm -rf barbearia-orlando && git clone https://github.com/orlandocabeleireiro-rgb/barbearia-orlando.git && cd barbearia-orlando/functions && npm install && cd ..
```

## 3. Publicar a função nova

```
firebase deploy --only functions:deleteUserAccount --project barbearia-orlando-c660c
```

- Se aparecer um erro a pedir login, corre `firebase login --no-localhost`,
  segue o link, copia o código que aparece e cola-o no Cloud Shell. Depois
  repete o comando de cima.
- Se perguntar quantos dias guardar imagens de containers, carrega só em Enter.
- No fim deve aparecer `Deploy complete!`.

## 4. Apagar a função antiga (só depois de o site novo estar publicado)

A função antiga `deleteClientAuth` aceita qualquer pessoa que saiba o segredo,
e esse segredo esteve visível no site. Tem de ser apagada:

```
firebase functions:delete deleteClientAuth --region us-central1 --project barbearia-orlando-c660c
```

Responde `y` quando perguntar se tens a certeza.

## Como testar

No painel admin, cria um cliente de teste com um email teu, apaga-o, e
volta a registar-te com o mesmo email. Se o registo funcionar, a função
apagou a conta antiga.

---

# Lembretes por email (`sendBookingReminders`)

Corre sozinha todos os dias às 18:00 (hora de Lisboa) e envia um lembrete
por email a cada cliente com marcação confirmada no dia seguinte. Usa o
modelo "Lembrete" do EmailJS (`template_fkf9m6i`).

## Antes (no site do EmailJS, uma só vez)

- Em **Account → Security**, ligar **"Allow EmailJS API for non-browser
  applications"**.
- Ter à mão a **Private Key** (Account → API Keys). Não a envies a ninguém.

## 1. Abrir o Cloud Shell e descarregar o código

Abre https://shell.cloud.google.com e cola:

```
rm -rf barbearia-orlando && git clone https://github.com/orlandocabeleireiro-rgb/barbearia-orlando.git && cd barbearia-orlando/functions && npm install && cd ..
```

## 2. Guardar a Private Key do EmailJS no Firebase

```
firebase functions:secrets:set EMAILJS_PRIVATE_KEY --project barbearia-orlando-c660c
```

- Se perguntar se queres ativar um serviço (Secret Manager), responde `y`.
- Quando pedir o valor, cola a Private Key e carrega em Enter. Não aparece
  nada no ecrã enquanto colas — é normal.

## 3. Publicar a função

```
firebase deploy --only functions:sendBookingReminders --project barbearia-orlando-c660c
```

- Se perguntar se queres ativar serviços (Cloud Scheduler, etc.), responde `y`.
- No fim deve aparecer `Deploy complete!`.

## Como testar

Faz uma marcação para amanhã com um cliente com o teu email (ex.: o
Henrique). Às 18:00 deve chegar o lembrete. No EmailJS, em **Email
History**, aparece cada envio.

---

# Lista de espera automática (`waitlistOnSlotFreed`, `waitlistOnNewRequest`)

Sempre que uma vaga abre (alguém desmarca, uma marcação é apagada ou mudada
de hora) ou entra um pedido novo na lista de espera, o Firebase marca
automaticamente o primeiro cliente à espera dessa hora e envia-lhe o email de
confirmação — mesmo sem ninguém com o site aberto. Usa a mesma Private Key do
EmailJS que os lembretes (`EMAILJS_PRIVATE_KEY`, já guardada).

## Publicar (Cloud Shell)

```
rm -rf barbearia-orlando && git clone https://github.com/orlandocabeleireiro-rgb/barbearia-orlando.git && cd barbearia-orlando/functions && npm install && cd ..
```

```
firebase deploy --only functions:waitlistOnSlotFreed,functions:waitlistOnNewRequest --project barbearia-orlando-c660c
```

- Se perguntar se queres ativar serviços (Eventarc, Pub/Sub, …), responde `y`.
- Se der um erro de permissões na primeira vez ("Permission denied while using
  the Eventarc Service Agent"), espera 2–3 minutos e volta a correr o comando.
- No fim deve aparecer `Deploy complete!`.
