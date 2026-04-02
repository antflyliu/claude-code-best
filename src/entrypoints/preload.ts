// PRELOAD: runs at the very top of the bundle, before any module code.
// Sets up globalThis.features so GrowthBook's feature() can read env-driven flags.
const ENABLED_FLAGS = new Set(
  (process.env.CLAUDE_CODE_ENABLED_FEATURES || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
)

;(globalThis).features = {}
for (const flag of ENABLED_FLAGS) {
  ;(globalThis).features[flag] = true
}
