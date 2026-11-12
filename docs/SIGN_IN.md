# Ways to sign in

[На русском](SIGN_IN.ru.md)

The first time, a relative always comes in with an invitation link. After that they can link a way that suits them under **Settings → My account** and sign in with it, with no new link. Nobody gets in who was not invited: every way below signs in only an account that already exists and was linked to it by its owner.

The owner switches each way on under **Settings → Ways to sign in**. The screen shows the steps, the return address to copy, and checks what it can before saving: Telegram is asked about the bot, the mail server is asked to accept the password. Keys typed there are kept in the database encrypted with the server's secret. A variable in the server's environment wins over the screen, for those who prefer to set things up there.

Yandex ID, VK ID, Telegram and Google need the archive at an address with https. A code by mail works anywhere.

| Way | Suits | What you need | Variables |
|---|---|---|---|
| Yandex ID | Almost everyone in Russia | An app at oauth.yandex.ru | `YANDEX_CLIENT_ID`, `YANDEX_CLIENT_SECRET` |
| VK ID | VK, and also Mail.ru and Odnoklassniki accounts | An app at id.vk.com | `VK_CLIENT_ID`, `VK_CLIENT_SECRET` |
| Telegram | Anyone with Telegram on the phone | A bot from @BotFather | `TELEGRAM_BOT_TOKEN`, optionally `TELEGRAM_BOT_NAME` |
| Google | Gmail and Android | A client in Google Cloud Console | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| A code by mail | Everyone | A mailbox and its app password | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` |

There is no sign-in by SMS: every message costs money, and Telegram and VK ID are tied to a phone number anyway.

In the steps below, `https://family.example.com` stands for your archive's address.

## Yandex ID

1. Open [oauth.yandex.ru](https://oauth.yandex.ru/client/new) and create an app for web services.
2. Under access, tick "Access to email address" and "Access to username, first name and surname".
3. Redirect URI: `https://family.example.com/api/auth/callback/yandex`.
4. Copy the ClientID and Client secret into the app.

## VK ID

1. Open [id.vk.com/about/business](https://id.vk.com/about/business/go) and create an app for the Web platform.
2. Base domain: `family.example.com`. Trusted redirect URL: `https://family.example.com/api/auth/callback/vk`.
3. Copy the app ID and the secure key into the app.

VK does not give everyone's email. That is fine: the account is found by its VK id.

## Telegram

1. In Telegram, send [@BotFather](https://t.me/BotFather) `/newbot` and give the bot a name.
2. Send it `/setdomain`, choose the bot, and send `family.example.com`.
3. Copy the token it sent into the app.

Telegram draws its own button on the page. It works only at the domain the bot was given, so not on `localhost`.

## Google

1. Open [Google Cloud Console](https://console.cloud.google.com/auth/overview), create a project, and fill in the consent screen: a name, your email, audience External.
2. Under Clients, create a Web application client. Authorized redirect URI: `https://family.example.com/api/auth/callback/google`.
3. Copy the Client ID and Client secret into the app.
4. While the app is in Testing, Google lets in only the test users listed under Audience. Add relatives there, or press Publish app: for a sign-in that asks only for the name and email, Google does not need to review it.

### The owner, with no link

The owner's account is made with no email, so Google does not know it yet. Set `OWNER_EMAIL` to the owner's Google address in the server's environment and restart: the account takes that address, and **Sign in with Google** opens it at once. Nothing else changes: any other Google account is still refused. A server setting wins over an address the owner set themselves.

## A code by mail

A six-digit code comes by mail and works for 10 minutes. A relative first adds their address under **My account**, confirming it with a code, because someone who came by a link has none on file.

1. Take a mailbox for the archive: a new one, or your own.
2. Make an app password for it: [Yandex](https://id.yandex.ru/security/app-passwords), [Mail.ru](https://account.mail.ru/user/2-step-auth/passwords), [Gmail](https://myaccount.google.com/apppasswords). The mailbox's own password will not do.
3. In the app choose the mail service, and enter the address and the app password.

| Service | Server | Port |
|---|---|---|
| Yandex | `smtp.yandex.ru` | 465 |
| Mail.ru | `smtp.mail.ru` | 465 |
| Gmail | `smtp.gmail.com` | 465 |

Sending a code and checking it are limited to a few tries a minute, so a code cannot be guessed.

## Turning a way off

**Turn off** on the same screen. Whoever signed in that way signs in another way, or with a new link from the owner. A way set by a variable is turned off by removing the variable and restarting.
