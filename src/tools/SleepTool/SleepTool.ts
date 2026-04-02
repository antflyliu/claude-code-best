/**
 * SleepTool — sleep tool for proactive mode.
 *
 * Allows the autonomous agent to pause for a specified duration between actions.
 * Does NOT truly block the process — instead records the sleep intent and
 * the tick scheduler respects the elapsed time.
 *
 * Architecture:
 * - Agent calls Sleep(durationSeconds=X) when it has nothing to do
 * - SleepTool.call() records {sleptAt, expiresAt} in pendingSleep state
 * - query.ts detects sleepRan and sets queue priority to 'later'
 * - print.ts scheduleProactiveTick() checks pending sleep before injecting next tick
 * - When enough time has elapsed, next tick is injected
 *
 * This is the MVP implementation. Phase 2 adds:
 * - Real setTimeout-based delays with interrupt on queue changes
 * - Dynamic interval based on recent activity level
 */

import { feature } from 'bun:bundle'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { ValidationResult } from '../../Tool.js'
import {
  isProactiveActive,
  getProactiveActive,
} from '../../proactive/index.js'
import {
  SLEEP_TOOL_NAME,
  DESCRIPTION,
  SLEEP_TOOL_PROMPT,
} from './prompt.js'
import type { PastedContent } from '../../utils/config.js'

// ============================================================================
// Pending sleep state — shared with tick scheduler
// ============================================================================

interface PendingSleep {
  sleptAt: number        // Date.now() when Sleep was called
  expiresAt: number      // Date.now() + durationSeconds * 1000
  durationSeconds: number
  reason?: string
}

let _pendingSleep: PendingSleep | null = null

/**
 * Get the current pending sleep, if any.
 * Used by print.ts tick scheduler to determine whether to inject a tick.
 */
export function getPendingSleep(): PendingSleep | null {
  return _pendingSleep
}

/**
 * Clear the pending sleep — called when sleep is interrupted.
 */
export function clearPendingSleep(): void {
  _pendingSleep = null
}

/**
 * Check if a pending sleep has elapsed (enough time passed since last Sleep call).
 * @param now Current timestamp (usually Date.now())
 * @returns true if no pending sleep OR the sleep duration has fully elapsed
 */
export function hasPendingSleepElapsed(now: number): boolean {
  if (!_pendingSleep) return true
  return now >= _pendingSleep.expiresAt
}

// ============================================================================
// Tool definition
// ============================================================================

const inputSchema = () =>
  z.strictObject({
    durationSeconds: z
      .number()
      .int()
      .min(1)
      .max(3600)
      .describe(
        'How long to sleep, in seconds. The sleep can be interrupted early by the user submitting input.',
      ),
    reason: z
      .string()
      .optional()
      .describe('Optional reason for sleeping (not shown to the user).'),
  })

type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = () =>
  z.object({
    sleptFor: z.number().describe('Actual duration slept in seconds'),
    elapsedMs: z.number().describe('How much time elapsed since the sleep was requested'),
    reason: z.string().optional(),
  })

type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

// ============================================================================
// SleepTool
// ============================================================================

export const SleepTool = buildTool({
  name: SLEEP_TOOL_NAME,
  aliases: [],
  searchHint: 'pause, wait, delay, rest',
  maxResultSizeChars: 500,

  get inputSchema(): ReturnType<typeof inputSchema> {
    return inputSchema()
  },

  get outputSchema(): ReturnType<typeof outputSchema> {
    return outputSchema()
  },

  /**
   * SleepTool is only available when proactive mode is active.
   * Requires feature flag to be enabled AND proactive state to be active.
   */
  isEnabled(): boolean {
    if (!feature('PROACTIVE') && !feature('KAIROS')) return false
    return isProactiveActive()
  },

  isConcurrencySafe(): boolean {
    return true
  },

  isReadOnly(): boolean {
    return true
  },

  toAutoClassifierInput(input): string {
    return `Sleep for ${input.durationSeconds} seconds: ${input.reason ?? ''}`
  },

  async validateInput(
    { durationSeconds },
    _context,
  ): Promise<ValidationResult> {
    if (
      typeof durationSeconds !== 'number' ||
      !Number.isInteger(durationSeconds) ||
      durationSeconds < 1 ||
      durationSeconds > 3600
    ) {
      return {
        result: false,
        message: 'durationSeconds must be an integer between 1 and 3600',
        errorCode: 400,
      }
    }
    return { result: true }
  },

  async description(): Promise<string> {
    return DESCRIPTION
  },

  async prompt(): Promise<string> {
    return SLEEP_TOOL_PROMPT
  },

  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Slept for ${output.data.sleptFor}s`,
    }
  },

  renderToolUseMessage(): null {
    return null
  },

  renderToolResultMessage(): null {
    return null
  },

  async call(
    { durationSeconds, reason },
    _context,
  ): Promise<{ data: z.infer<OutputSchema> }> {
    const sleptAt = Date.now()
    const expiresAt = sleptAt + durationSeconds * 1000

    // Record pending sleep for tick scheduler
    _pendingSleep = {
      sleptAt,
      expiresAt,
      durationSeconds,
      reason,
    }

    // Calculate actual elapsed time (MVP: should be very close to durationSeconds)
    // In Phase 2 with real delays, this would measure actual elapsed time
    const actualSleptFor = Math.min(
      Math.round((Date.now() - sleptAt) / 1000),
      durationSeconds,
    )

    return {
      data: {
        sleptFor: actualSleptFor,
        elapsedMs: Date.now() - sleptAt,
        reason,
      },
    }
  },
} satisfies ToolDef<InputSchema>)
