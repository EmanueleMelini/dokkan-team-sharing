import { randomBytes } from 'node:crypto'
import { betterAuth, type BetterAuthPlugin } from 'better-auth'
import { magicLink } from 'better-auth/plugins/magic-link'
import { db } from '@/lib/db'
import type { MagicLinkSender } from '@/lib/auth/email'
import type { AuthEnv } from '@/lib/auth/env'
import { mayEmail, rateLimitStorage } from '@/lib/auth/rate-limit'

export const MAGIC_LINK_TTL_SECONDS = 600
export const SESSION_DAYS = 30

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
      cookieCache: { enabled: false },
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
