'use client'

import { useActionState } from 'react'
import { completeOnboardingAction, type OnboardingState } from '@/lib/auth/actions'

type Props = { next: string; suggestion: string; reg: 'global' | 'japan' }

/** Il form di /welcome. Valida il server: qui solo i suggerimenti del browser. */
export function OnboardingForm({ next, suggestion, reg }: Props) {
  const [state, action, pending] = useActionState<OnboardingState, FormData>(completeOnboardingAction, {})
  const handle = state.handle ?? suggestion
  const chosen = state.reg ?? reg

  return (
    <form action={action} className="mt-6 space-y-5">
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="handle" className="block text-[12px] text-tenue">
          Handle
        </label>
        <input
          id="handle"
          name="handle"
          defaultValue={handle}
          key={handle}
          required
          minLength={3}
          maxLength={24}
          pattern="[A-Za-z0-9_]{3,24}"
          autoComplete="username"
          aria-describedby="handle-help"
          aria-invalid={state.error ? true : undefined}
          className="mt-1 w-full px-3 py-1.5 text-[13px] rounded-[var(--raggio)] bg-superficie border border-campo text-inchiostro"
        />
        <p id="handle-help" className="mt-1 text-[11px] text-tenue">
          3 to 24 letters, digits or underscores. Shown next to your clears.
        </p>
      </div>

      <fieldset>
        <legend className="text-[12px] text-tenue">Which version do you play?</legend>
        <div className="mt-1.5 flex gap-2">
          {(['global', 'japan'] as const).map((r) => (
            <label
              key={r}
              className="flex-1 flex items-center gap-2 px-3 py-2 text-[13px] rounded-[var(--raggio)] border border-campo bg-superficie text-inchiostro has-[:checked]:border-oro has-[:checked]:bg-oro-tenue cursor-pointer"
            >
              <input type="radio" name="reg" value={r} defaultChecked={chosen === r} className="accent-[var(--oro)]" />
              {r === 'global' ? 'Global' : 'Japan'}
            </label>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-tenue">Events, dates and clears follow this version. You can switch any time from the menu.</p>
      </fieldset>

      {state.error && (
        <p role="alert" className="text-[12px] text-str">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full px-3 py-2 text-[13px] font-medium rounded-[var(--raggio)] bg-inchiostro text-sfondo hover:opacity-90 transition-opacity disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Continue'}
      </button>
    </form>
  )
}
