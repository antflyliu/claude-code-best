/**
 * Proactive mode — autonomous agent lifecycle management.
 *
 * In CCB (Claude Code Best), proactive mode keeps the agent running
 * autonomously between user interactions via periodic `<tick>` prompts.
 *
 * Architecture:
 * - Tick injection: src/cli/print.ts scheduleProactiveTick() enqueues <tick>
 * - Tick detection: src/query.ts checks sleepRan to set queue priority
 * - System prompt: src/constants/prompts.ts getProactiveSection() injects instructions
 * - State: module-level singletons (reset per session)
 *
 * Environment:
 *   CLAUDE_CODE_ENABLED_FEATURES=KAIROS,PROACTIVE,KAIROS_BRIEF,...
 *   CLAUDE_CODE_PROACTIVE=1   (enables proactive on startup)
 *   CLAUDE_CODE_BRIEF=1     (bypasses GrowthBook gate for BriefTool)
 */

import { feature } from 'bun:bundle'
import { createSignal } from '../utils/signal.js'
import { setKairosActive } from '../bootstrap/state.js'

// ============================================================================
// Module-level state — reset per session
// ============================================================================

let _isActive = false
let _isPaused = false
let _contextBlocked = false
let _tickCount = 0
let _lastTickAt: number | undefined = undefined
let _nextTickAt: number | undefined = undefined
let _firstTickFired = false

export const DEFAULT_TICK_INTERVAL_MS = 30_000

// ============================================================================
// Reactive signal for subscribers
// ============================================================================

const proactiveChanges = createSignal()

export const subscribeToProactiveChanges = proactiveChanges.subscribe

function notifyChange(): void {
  proactiveChanges.emit()
}

// ============================================================================
// Activation / Deactivation
// ============================================================================

export const isProactiveActive = (): boolean => {
  if (!feature('PROACTIVE') && !feature('KAIROS')) return false
  return _isActive
}

export const activateProactive = (source: string = 'command'): void => {
  if (!feature('PROACTIVE') && !feature('KAIROS')) return
  if (_isActive) return
  _isActive = true
  _isPaused = false
  _contextBlocked = false
  _tickCount = 0
  _firstTickFired = false
  _lastTickAt = undefined
  _nextTickAt = undefined

  setKairosActive(true)

  notifyChange()
  console.log(`[proactive] Activated (source=${source})`)
}

export const deactivateProactive = (): void => {
  if (!_isActive) return
  _isActive = false
  _isPaused = false
  _contextBlocked = false
  _tickCount = 0
  _lastTickAt = undefined
  _nextTickAt = undefined
  _firstTickFired = false

  setKairosActive(false)

  notifyChange()
  console.log('[proactive] Deactivated')
}

// ============================================================================
// Pause / Resume
// ============================================================================

export const isProactivePaused = (): boolean => _isPaused

export const pauseProactive = (): void => {
  if (!_isActive || _isPaused) return
  _isPaused = true
  _nextTickAt = undefined
  notifyChange()
}

export const resumeProactive = (): void => {
  if (!_isActive || !_isPaused) return
  _isPaused = false
  notifyChange()
}

// ============================================================================
// Context blocked — prevent tick → error → tick spiral
// ============================================================================

export const isContextBlocked = (): boolean => _contextBlocked

export const setContextBlocked = (blocked: boolean): void => {
  if (_contextBlocked === blocked) return
  _contextBlocked = blocked
  if (blocked) {
    _nextTickAt = undefined
  }
  notifyChange()
}

// ============================================================================
// Tick timing
// ============================================================================

export const recordTickScheduled = (at: number): void => {
  _nextTickAt = at
}

export const recordTickFired = (at: number): void => {
  _tickCount++
  _lastTickAt = at
  _nextTickAt = undefined
  _firstTickFired = true
  notifyChange()
}

export const getLastTickAt = (): number | undefined => _lastTickAt

export const getNextTickAt = (): number | undefined => _nextTickAt

export const getTickCount = (): number => _tickCount

export const hasFirstTickFired = (): boolean => _firstTickFired

// ============================================================================
// Tick interval control (Phase 2 ready)
// ============================================================================

let _tickIntervalMs = DEFAULT_TICK_INTERVAL_MS

export const getTickIntervalMs = (): number => _tickIntervalMs

export const setTickIntervalMs = (ms: number): void => {
  _tickIntervalMs = Math.max(1000, Math.min(300_000, ms))
}

// ============================================================================
// Ready-to-tick predicate
// ============================================================================

export const canInjectTick = (): boolean => {
  if (!_isActive) return false
  if (_isPaused) return false
  if (_contextBlocked) return false
  return true
}

// ============================================================================
// Convenience alias
// ============================================================================

/** Alias for isProactiveActive — used by SleepTool.isEnabled() */
export const getProactiveActive = isProactiveActive
