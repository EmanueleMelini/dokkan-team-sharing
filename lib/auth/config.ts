import { randomBytes } from 'node:crypto'
import { BASE_ERROR_CODES, betterAuth, type BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import { magicLink } from 'better-auth/plugins/magic-link'
import { db } from '@/lib/db'
import type { MagicLinkSender } from '@/lib/auth/email'
import type { AuthEnv } from '@/lib/auth/env'
import { FRESH_SESSION_SECONDS, isFreshSession } from '@/lib/auth/fresh'
import { mayEmail, rateLimitStorage } from '@/lib/auth/rate-limit'
import { HINT_COOKIE, hintOptions } from '@/lib/viewer/hint'
import { cookieVersione } from '@/lib/versione/versione'

export const MAGIC_LINK_TTL_SECONDS = 600
export const SESSION_DAYS = 30

/**
 * Le rotte di better-auth dove nasce la sessione di un accesso: il magic
 * link, il ritorno da un provider OAuth e il suo accesso con un idToken.
 * Le altre che danno una sessione nuova la rinnovano o la riscrivono.
 */
export const ACCESSI: ReadonlySet<string> = new Set(['/magic-link/verify', '/callback/:id', '/sign-in/social'])

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
    // (unlink_provider e delete_account, 0019), che impongono le regole
    // sotto lock. La rotta di better-auth per lo scollegamento conta solo
    // i provider, non il magic link; /delete-user e' gia' spenta per
    // difetto, la si elenca per non riaccenderla per sbaglio. Vale solo
    // per le richieste HTTP: auth.api resta usabile dal server.
    disabledPaths: ['/unlink-account', '/delete-user'],
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
      customRules: { '/sign-in/magic-link': { window: 60, max: 3 } },
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
      ...plugins, // nextCookies() deve restare l'ultimo
    ],
  })
}

const senzaToken = { accessToken: null, refreshToken: null, idToken: null }

export type Auth = ReturnType<typeof createAuth>
