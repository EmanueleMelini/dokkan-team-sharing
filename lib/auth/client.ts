'use client'

import { createAuthClient } from 'better-auth/react'
import { magicLinkClient } from 'better-auth/client/plugins'

// Il client parla con /api/auth sullo stesso origin: nessun baseURL, e
// nessuna variabile d'ambiente nel bundle del browser.
export const authClient = createAuthClient({ plugins: [magicLinkClient()] })
