import { randomBytes } from 'node:crypto'
import { BASE_ERROR_CODES, betterAuth, type BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import { magicLink } from 'better-auth/plugins/magic-link'
import { PASSKEY_ERROR_CODES, passkey } from '@better-auth/passkey'
import { db } from '@/lib/db'
import type { MagicLinkSender } from '@/lib/auth/email'
import type { AuthEnv } from '@/lib/auth/env'
import { FRESH_SESSION_SECONDS, isFreshSession } from '@/lib/auth/fresh'
import { mayEmail, rateLimitStorage } from '@/lib/auth/rate-limit'
import { HINT_COOKIE, hintOptions } from '@/lib/viewer/hint'
import { cookieVersione } from '@/lib/versione/versione'

export const MAGIC_LINK_TTL_SECONDS = 600
export const SESSION_DAYS = 30

/** La rotta di better-auth dove una passkey firma l'accesso (il plugin passkey). */
export const PASSKEY_SIGN_IN = '/passkey/verify-authentication'

/**
 * La chiave pubblica piu' grande che una passkey puo' salvare: 3072 byte,
 * 4096 caratteri in base64, il tetto di auth_passkey_shape (0038). Una
 * chiave vera sta sotto i 1100 byte (RSA-8192).
 */
export const CHIAVE_MAX_BYTE = 3072

/** Quanto dello user agent resta nella riga di auth_session. */
export const USER_AGENT_MAX = 512

/**
 * Le rotte di better-auth dove nasce la sessione di un accesso: il magic
 * link, il ritorno da un provider OAuth, il suo accesso con un idToken e
 * la passkey. Le altre che danno una sessione nuova la rinnovano o la
 * riscrivono.
 */
export const ACCESSI: ReadonlySet<string> = new Set([
  '/magic-link/verify', '/callback/:id', '/sign-in/social', PASSKEY_SIGN_IN,
])

type Options = {
  env: AuthEnv
  sendMagicLink: MagicLinkSender
  /** nextCookies() nell'app; i test ne fanno a meno (niente next/headers). */
  plugins?: BetterAuthPlugin[]
}

/**
 * La configurazione di better-auth, senza 'server-only' e senza Next:
 * cosi' i test la costruiscono con un mittente che cattura i link.
 * L'istanza dell'app e' in lib/auth/auth.ts.
 */
export function createAuth({ env, sendMagicLink, plugins = [] }: Options) {
  // I provider esistono solo se hanno entrambe le variabili. Nessun token
  // del provider resta salvato (hook sotto): ci serve solo l'identita'.
  //
  // Il nome del provider serve solo a suggerire l'handle in /welcome. Per
  // Discord better-auth usa il nome visualizzato, che può contenere
  // qualsiasi carattere ("ŁełeMims01"); lo username è unico e ha già la
  // forma di un handle ("lelemims01"), quindi si prende quello.
  const nomePerHandle: Record<string, object> = {
    discord: { mapProfileToUser: (p: { username?: string }) => (p.username ? { name: p.username } : {}) },
  }
  const socialProviders = Object.fromEntries(
    Object.entries(env.providers).map(([id, cred]) => [id, { ...cred, ...nomePerHandle[id] }]),
  )

  return betterAuth({
    appName: 'Dokkan Team Sharing',
    baseURL: env.baseURL,
    secret: env.secret,
    database: db,
    telemetry: { enabled: false },
    // Scollegare e cancellare passano solo dalle Server Action di Settings
    // (unlink_provider e delete_account, 0019; delete_passkey, 0038), che
    // impongono le regole sotto lock. La rotta di better-auth per lo
    // scollegamento conta solo i provider, non il magic link; quella per
    // togliere una passkey non guarda se resta un modo di entrare, e non
    // chiede una sessione fresca. /delete-user e' gia' spenta per difetto,
    // la si elenca per non riaccenderla per sbaglio. Rinominare una
    // passkey il sito non lo offre. Vale solo per le richieste HTTP:
    // auth.api resta usabile dal server.
    disabledPaths: [
      '/unlink-account', '/delete-user', '/passkey/delete-passkey', '/passkey/update-passkey',
    ],
    // Gli errori del callback OAuth tornano alla pagina di accesso, che li
    // traduce, invece che alla pagina d'errore grezza di better-auth.
    onAPIError: { errorURL: new URL('/login', env.baseURL).toString() },

    user: {
      modelName: 'app_user',
      fields: {
        name: 'display_name',
        emailVerified: 'email_verified',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      // Tutti input: false: nessuna richiesta del client li puo' scrivere.
      additionalFields: {
        handle: { type: 'string', required: false, input: false },
        reg: { type: 'string', required: false, input: false },
        locale: { type: 'string', required: false, input: false },
        role: { type: 'string', required: false, input: false },
        onboardedAt: { type: 'date', required: false, input: false, fieldName: 'onboarded_at' },
        // L'animazione delle carte per difetto (Settings): la legge /api/me.
        prefersAnimated: {
          type: 'boolean', required: false, input: false, defaultValue: false, fieldName: 'prefers_animated',
        },
        // Il tema del sito (0027): null = System. Lo scrive solo set_theme
        // (setThemeAction); /api/me lo restituisce per gli altri dispositivi.
        theme: { type: 'string', required: false, input: false },
        // La sospensione (0024): null, una data, o 'infinity'. La scrive solo
        // mod_suspend_user; qui si legge per /api/me e per il banner.
        suspendedUntil: { type: 'date', required: false, input: false, fieldName: 'suspended_until' },
        // Il motivo lo vede solo l'interessato, nel banner. Le note dei
        // moderatori invece restano nel registro e non escono mai.
        suspensionReason: { type: 'string', required: false, input: false, fieldName: 'suspension_reason' },
        // Il pallino delle notifiche (0028): notif_last_at lo scrive il trigger
        // della notifica, notif_seen_at mark_notifications_read. Letti qui,
        // con la sessione che /api/me legge gia', il pallino non costa query.
        notifLastAt: { type: 'date', required: false, input: false, fieldName: 'notif_last_at' },
        notifSeenAt: { type: 'date', required: false, input: false, fieldName: 'notif_seen_at' },
      },
      // Un account nuovo solo con un'email che il provider dichiara
      // verificata (il magic link la verifica da se'). Senza questo, chi
      // registra su un provider l'email di un altro prenderebbe il suo nome.
      validateUserInfo: ({ user, source }) => {
        if (source.action === 'create-user' && user.emailVerified !== true) {
          return { error: 'email_not_verified' }
        }
      },
    },
    session: {
      modelName: 'auth_session',
      fields: {
        userId: 'user_id',
        expiresAt: 'expires_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      expiresIn: SESSION_DAYS * 24 * 60 * 60,
      updateAge: 24 * 60 * 60, // scadenza scorrevole, rinnovata al massimo una volta al giorno
      // Niente cache nel cookie: una sessione revocata deve smettere subito.
      // E' anche cio' che rende vera la data di nascita letta dalla DAL.
      cookieCache: { enabled: false },
      // La stessa soglia delle Server Action di Settings (lib/auth/fresh.ts)
      // per le rotte di better-auth che la usano (/list-sessions; quelle
      // di scollegamento e cancellazione sono spente qui sotto).
      freshAge: FRESH_SESSION_SECONDS,
    },
    account: {
      modelName: 'auth_account',
      fields: {
        accountId: 'account_id',
        providerId: 'provider_id',
        userId: 'user_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      storeStateStrategy: 'database',
      accountLinking: {
        enabled: true,
        // Mai un collegamento implicito per email: un secondo provider si
        // aggiunge solo da Settings, con la sessione aperta (linkSocial).
        disableImplicitLinking: true,
        trustedProviders: [],
        // Da Settings l'utente prova di possedere l'altro account: che il
        // provider abbia un'altra email (Discord e Google spesso) va bene.
        allowDifferentEmails: true,
      },
    },
    verification: {
      modelName: 'auth_verification',
      fields: { expiresAt: 'expires_at', createdAt: 'created_at', updatedAt: 'updated_at' },
    },
    rateLimit: {
      enabled: true,
      customStorage: rateLimitStorage,
      customRules: {
        '/sign-in/magic-link': { window: 60, max: 3 },
        // Le passkey (il plugin non ne mette): ogni richiesta di opzioni
        // scrive una sfida in auth_verification, e /login ne chiede una a
        // ogni apertura per il suggerimento nel campo email.
        '/passkey/generate-authenticate-options': { window: 60, max: 20 },
        [PASSKEY_SIGN_IN]: { window: 60, max: 10 },
        '/passkey/generate-register-options': { window: 60, max: 10 },
        '/passkey/verify-registration': { window: 60, max: 10 },
      },
    },
    socialProviders,
    advanced: {
      cookiePrefix: 'dts',
      database: { generateId: 'uuid' },
      // Da quale header si legge l'IP per il limite per IP: in produzione
      // quello che scrive la piattaforma (lib/auth/env.ts), non uno che il
      // client puo' mandare da se'.
      ...(env.ipAddressHeaders ? { ipAddress: { ipAddressHeaders: env.ipAddressHeaders } } : {}),
    },

    // Collegare un provider aggiunge un modo di entrare che sopravvive alla
    // revoca della sessione: con un cookie rubato si terrebbe l'account per
    // sempre. Per questo /link-social chiede una sessione fresca come
    // scollegare e cancellare. better-auth non lo fa da se' su questa rotta.
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/link-social') return
        const s = await getSessionFromCtx(ctx)
        // Senza sessione risponde la rotta stessa (401).
        if (s && !isFreshSession(s.session.createdAt)) {
          throw APIError.from('FORBIDDEN', BASE_ERROR_CODES.SESSION_NOT_FRESH)
        }
      }),
      // L'indizio dts_signed_in (lib/viewer/hint.ts): nasce con ogni sessione
      // nuova (magic link, callback OAuth) e muore con l'uscita. Le pagine in
      // cache non leggono la sessione: e' lui a dire al browser di chiedere
      // /api/me. Dura quanto la sessione; /api/me lo rinnova a ogni visita.
      //
      // La versione del sito (dts_version, lib/versione): a un accesso vero
      // di un account completo vince l'account (app_user.reg), come il
      // tema; un account nuovo o senza handle lascia quella del dispositivo,
      // che /welcome propone. L'uscita non la tocca: resta del dispositivo.
      // Solo agli accessi (ACCESSI): newSession c'e' anche quando
      // /get-session rinnova la sessione (una volta al giorno, anche da
      // /api/me e dalle azioni) o /update-user la riscrive, e li' una
      // risposta partita prima di un cambio lo disfarebbe.
      after: createAuthMiddleware(async (ctx) => {
        // Le opzioni d'accesso con passkey chiedono la verifica dell'utente
        // (impronta, volto, PIN, password principale del gestore): il plugin
        // la scrive 'preferred' e non la lascia cambiare, e con 'preferred'
        // certi gestori di password rispondono senza chiederla. La risposta
        // si riscrive qui; i cookie della sfida restano. Il server la
        // pretende comunque (authentication.afterVerification, sotto).
        if (ctx.path === '/passkey/generate-authenticate-options') {
          const r = ctx.context.returned
          if (r && typeof r === 'object' && 'challenge' in r) ctx.context.returned = { ...r, userVerification: 'required' }
          return
        }
        const opzioni = hintOptions(env.baseURL, SESSION_DAYS * 24 * 60 * 60)
        if (ctx.path === '/sign-out') ctx.setCookie(HINT_COOKIE, '', { ...opzioni, maxAge: 0 })
        else if (ctx.context.newSession) {
          ctx.setCookie(HINT_COOKIE, '1', opzioni)
          const u = ctx.context.newSession.user as { onboardedAt?: unknown; reg?: unknown }
          if (ACCESSI.has(ctx.path) && u.onboardedAt != null) {
            const c = cookieVersione(u.reg === 'japan' ? 'japan' : 'global', env.baseURL)
            ctx.setCookie(c.name, c.value, c.options)
          }
        }
      }),
    },

    databaseHooks: {
      user: {
        create: {
          before: async (user) => ({
            data: {
              ...user,
              // Il nome del provider (o quello scritto nel form del magic
              // link) non si mostra: si tiene corto, solo come suggerimento.
              name: String(user.name ?? '').slice(0, 64),
              // Provvisorio fino a /welcome: complete_onboarding lo sostituisce.
              handle: `user_${randomBytes(4).toString('hex')}`,
              onboardedAt: null,
            },
          }),
        },
      },
      // Lo user agent della sessione non lo legge nessuno, e l'header lo
      // sceglie chi entra: si tiene corto. Con le passkey uno script entra
      // dieci volte al minuto, e ogni accesso e' una riga di auth_session.
      session: {
        create: {
          before: async (session) => ({
            data: { ...session, userAgent: String(session.userAgent ?? '').slice(0, USER_AGENT_MAX) },
          }),
        },
      },
      account: {
        create: { before: async (account) => ({ data: { ...account, ...senzaToken } }) },
        update: { before: async (account) => ({ data: { ...account, ...senzaToken } }) },
      },
    },

    plugins: [
      magicLink({
        expiresIn: MAGIC_LINK_TTL_SECONDS,
        storeToken: 'hashed',
        // La risposta e' la stessa che l'invio parta o no: chi chiede non
        // scopre se l'indirizzo e' iscritto, ne' se e' in pausa.
        sendMagicLink: async ({ email, url }) => {
          if (!(await mayEmail(email))) return
          await sendMagicLink({ email, url })
        },
      }),
      // Le passkey (0038): WebAuthn sul nostro server, la chiave privata
      // resta sul dispositivo o nel gestore di password. Aggiungerne una
      // chiede una sessione fresca (freshSessionMiddleware del plugin, con
      // freshAge sopra), come collegare un provider; un account nuovo non
      // nasce mai da una passkey. Origine e dominio vengono da BETTER_AUTH_URL,
      // non dall'header Origin della richiesta (il default del plugin).
      passkey({
        rpID: new URL(env.baseURL).hostname,
        rpName: 'Dokkan Team Sharing',
        origin: new URL(env.baseURL).origin,
        // Una passkey che si trova da sola (/login non chiede l'email prima),
        // e sempre con la verifica dell'utente: chi trova una chiave o un
        // computer sbloccato non entra solo toccandola.
        authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
        // Il plugin verifica con requireUserVerification: false, scritto
        // fisso: la verifica dell'utente la si pretende qui, prima che la
        // passkey si salvi o che nasca la sessione.
        // Qui si rifiuta anche una chiave pubblica fuori misura, prima del
        // database (auth_passkey_shape la rifiuterebbe comunque): la
        // misura non la controlla nessun altro.
        registration: {
          afterVerification: ({ verification }) => {
            const info = verification.registrationInfo
            if (!info?.userVerified || info.credential.publicKey.byteLength > CHIAVE_MAX_BYTE) {
              throw APIError.from('BAD_REQUEST', PASSKEY_ERROR_CODES.FAILED_TO_VERIFY_REGISTRATION)
            }
          },
        },
        authentication: {
          afterVerification: ({ verification }) => {
            if (!verification.authenticationInfo.userVerified) {
              throw APIError.from('UNAUTHORIZED', PASSKEY_ERROR_CODES.AUTHENTICATION_FAILED)
            }
          },
        },
        schema: {
          passkey: {
            modelName: 'auth_passkey',
            fields: {
              publicKey: 'public_key',
              userId: 'user_id',
              credentialID: 'credential_id',
              deviceType: 'device_type',
              backedUp: 'backed_up',
              createdAt: 'created_at',
            },
          },
        },
      }),
      ...plugins, // nextCookies() deve restare l'ultimo
    ],
  })
}

const senzaToken = { accessToken: null, refreshToken: null, idToken: null }

export type Auth = ReturnType<typeof createAuth>
