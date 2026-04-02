/**
 * useProactive — React hook adapter for proactive state.
 *
 * Provides a React-friendly interface to the proactive module state.
 * All state lives in proactive/index.ts; this is just a thin adapter.
 *
 * Used by: src/screens/REPL.tsx
 */

import { feature } from 'bun:bundle'
import * as proactiveModule from './index.js'

// ============================================================================
// Feature-gated dynamic import
//
// REPL.tsx does: const useProactive = feature('PROACTIVE') || feature('KAIROS')
//   ? require('./useProactive.js').useProactive : null
// If the feature is off, useProactive stays null and all calls are no-ops.
// ============================================================================

type ProactiveState = {
  isActive: boolean
  isPaused: boolean
  isContextBlocked: boolean
  tickCount: number
  lastTickAt: number | undefined
  nextTickAt: number | undefined
  tickIntervalMs: number
  firstTickFired: boolean
}

const NOOP_STATE: ProactiveState = {
  isActive: false,
  isPaused: false,
  isContextBlocked: false,
  tickCount: 0,
  lastTickAt: undefined,
  nextTickAt: undefined,
  tickIntervalMs: proactiveModule.DEFAULT_TICK_INTERVAL_MS,
  firstTickFired: false,
}

/**
 * Returns current proactive state snapshot.
 * Call this in a useSyncExternalStore subscribe callback to get reactive updates.
 *
 * Usage in REPL.tsx:
 *   const [state, setState] = React.useState(() => useProactive?.getState?.() ?? NOOP_STATE)
 *   React.useEffect(() => {
 *     const unsubscribe = useProactive?.subscribe?.(() => {
 *       setState(useProactive?.getState?.() ?? NOOP_STATE)
 *     })
 *     return unsubscribe
 *   }, [])
 */
export const useProactive = (): {
  getState: () => ProactiveState
  subscribe: (cb: () => void) => () => void
  activate: (source?: string) => void
  deactivate: () => void
  pause: () => void
  resume: () => void
} | null => {
  if (!feature('PROACTIVE') && !feature('KAIROS') && !feature('KAIROS_BRIEF')) {
    return null
  }

  return {
    getState(): ProactiveState {
      return {
        isActive: proactiveModule.isProactiveActive(),
        isPaused: proactiveModule.isProactivePaused(),
        isContextBlocked: proactiveModule.isContextBlocked(),
        tickCount: proactiveModule.getTickCount(),
        lastTickAt: proactiveModule.getLastTickAt(),
        nextTickAt: proactiveModule.getNextTickAt(),
        tickIntervalMs: proactiveModule.getTickIntervalMs(),
        firstTickFired: proactiveModule.hasFirstTickFired(),
      }
    },

    subscribe(cb: () => void): () => void {
      return proactiveModule.subscribeToProactiveChanges(cb)
    },

    activate(source?: string): void {
      proactiveModule.activateProactive(source)
    },

    deactivate(): void {
      proactiveModule.deactivateProactive()
    },

    pause(): void {
      proactiveModule.pauseProactive()
    },

    resume(): void {
      proactiveModule.resumeProactive()
    },
  }
}
