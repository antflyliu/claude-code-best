#!/usr/bin/env bun
// ============================================================================
// Runtime polyfill for bun:bundle (build-time macros)
//
// In bundled builds, globalThis.features is set in preload.ts (prepended to
// bundle start) BEFORE any module code runs.
//
// In dev mode (bun run), this file is the true entry point and sets up
// globalThis.features before importing main.tsx.
//
// Set CLAUDE_CODE_ENABLED_FEATURES env var to enable specific flags:
//   CLAUDE_CODE_ENABLED_FEATURES=KAIROS,PROACTIVE,KAIROS_BRIEF,...
// ============================================================================

// --- Dev mode: initialize features if not already set by preload ---
if (!(globalThis as any).features) {
  ;(globalThis as any).features = {}
}

// Dynamic feature flag helper — attach to globalThis so all modules can read it.
// The stub feature() from bun:bundle is never called at runtime in bundled builds.
// Instead, every module that calls feature() resolves to this globalThis.feature.
// We export it so dev-mode imports (import { feature } from 'bun:bundle') still work.
function _featurePolyfill(name: string): boolean {
  const f = (globalThis as Record<string, unknown>).features as
    | Record<string, boolean>
    | undefined
  return !!(f && f[name])
}
(globalThis as Record<string, unknown>).feature = _featurePolyfill
// Export for dev-mode imports (import { feature } from 'bun:bundle')
// Also create a local alias so cli.tsx body code can call feature() directly
const feature = _featurePolyfill
export {_featurePolyfill as feature}

if (typeof globalThis.MACRO === "undefined") {
    (globalThis as any).MACRO = {
        VERSION: "2.1.888",
        BUILD_TIME: new Date().toISOString(),
        FEEDBACK_CHANNEL: "",
        ISSUES_EXPLAINER: "",
        NATIVE_PACKAGE_URL: "",
        PACKAGE_URL: "",
        VERSION_CHANGELOG: "",
    };
}
(globalThis as any).BUILD_TARGET = "external";
(globalThis as any).BUILD_ENV = "production";
(globalThis as any).INTERFACE_TYPE = "stdio";

process.env.COREPACK_ENABLE_AUTO_PIN = "0";

if (process.env.CLAUDE_CODE_REMOTE === "true") {
    const existing = process.env.NODE_OPTIONS || "";
    process.env.NODE_OPTIONS = existing
        ? `${existing} --max-old-space-size=8192`
        : "--max-old-space-size=8192";
}

if (feature("ABLATION_BASELINE") && process.env.CLAUDE_CODE_ABLATION_BASELINE) {
    for (const k of [
        "CLAUDE_CODE_SIMPLE",
        "CLAUDE_CODE_DISABLE_THINKING",
        "DISABLE_INTERLEAVED_THINKING",
        "DISABLE_COMPACT",
        "DISABLE_AUTO_COMPACT",
        "CLAUDE_CODE_DISABLE_AUTO_MEMORY",
        "CLAUDE_CODE_DISABLE_BACKGROUND_TASKS",
    ]) {
        process.env[k] ??= "1";
    }
}

/**
 * Bootstrap entrypoint - checks for special flags before loading the full CLI.
 * All imports are dynamic to minimize module evaluation for fast paths.
 * Fast-path for --version has zero imports beyond this file.
 */
async function main(): Promise<void> {
    const args = process.argv.slice(2);

    if (
        args.length === 1 &&
        (args[0] === "--version" || args[0] === "-v" || args[0] === "-V")
    ) {
        console.log(`${MACRO.VERSION} (Claude Code)`);
        return;
    }

    const { profileCheckpoint } = await import("../utils/startupProfiler.js");
    profileCheckpoint("cli_entry");

    if (feature("DUMP_SYSTEM_PROMPT") && args[0] === "--dump-system-prompt") {
        profileCheckpoint("cli_dump_system_prompt_path");
        const { enableConfigs } = await import("../utils/config.js");
        enableConfigs();
        const { getMainLoopModel } = await import("../utils/model/model.js");
        const modelIdx = args.indexOf("--model");
        const model =
            (modelIdx !== -1 && args[modelIdx + 1]) || getMainLoopModel();
        const { getSystemPrompt } = await import("../constants/prompts.js");
        const prompt = await getSystemPrompt([], model);
        console.log(prompt.join("\n"));
        return;
    }
    if (process.argv[2] === "--claude-in-chrome-mcp") {
        profileCheckpoint("cli_claude_in_chrome_mcp_path");
        const { runClaudeInChromeMcpServer } =
            await import("../utils/claudeInChrome/mcpServer.js");
        await runClaudeInChromeMcpServer();
        return;
    } else if (process.argv[2] === "--chrome-native-host") {
        profileCheckpoint("cli_chrome_native_host_path");
        const { runChromeNativeHost } =
            await import("../utils/claudeInChrome/chromeNativeHost.js");
        await runChromeNativeHost();
        return;
    } else if (
        feature("CHICAGO_MCP") &&
        process.argv[2] === "--computer-use-mcp"
    ) {
        profileCheckpoint("cli_computer_use_mcp_path");
        const { runComputerUseMcpServer } =
            await import("../utils/computerUse/mcpServer.js");
        await runComputerUseMcpServer();
        return;
    }

    if (feature("DAEMON") && args[0] === "--daemon-worker") {
        const { runDaemonWorker } = await import("../daemon/workerRegistry.js");
        await runDaemonWorker(args[1]);
        return;
    }

    if (
        feature("BRIDGE_MODE") &&
        (args[0] === "remote-control" ||
            args[0] === "rc" ||
            args[0] === "remote" ||
            args[0] === "sync" ||
            args[0] === "bridge")
    ) {
        profileCheckpoint("cli_bridge_path");
        const { enableConfigs } = await import("../utils/config.js");
        enableConfigs();
        const { getBridgeDisabledReason, checkBridgeMinVersion } =
            await import("../bridge/bridgeEnabled.js");
        const { BRIDGE_LOGIN_ERROR } = await import("../bridge/types.js");
        const { bridgeMain } = await import("../bridge/bridgeMain.js");
        const { exitWithError } = await import("../utils/process.js");
        const { getClaudeAIOAuthTokens } = await import("../utils/auth.js");
        if (!getClaudeAIOAuthTokens()?.accessToken) {
            exitWithError(BRIDGE_LOGIN_ERROR);
        }
        const disabledReason = await getBridgeDisabledReason();
        if (disabledReason) {
            exitWithError(`Error: ${disabledReason}`);
        }
        const versionError = checkBridgeMinVersion();
        if (versionError) {
            exitWithError(versionError);
        }
        const { waitForPolicyLimitsToLoad, isPolicyAllowed } =
            await import("../services/policyLimits/index.js");
        await waitForPolicyLimitsToLoad();
        if (!isPolicyAllowed("allow_remote_control")) {
            exitWithError(
                "Error: Remote Control is disabled by your organization's policy.",
            );
        }
        await bridgeMain(args.slice(1));
        return;
    }

    if (feature("DAEMON") && args[0] === "daemon") {
        profileCheckpoint("cli_daemon_path");
        const { enableConfigs } = await import("../utils/config.js");
        enableConfigs();
        const { initSinks } = await import("../utils/sinks.js");
        initSinks();
        const { daemonMain } = await import("../daemon/main.js");
        await daemonMain(args.slice(1));
        return;
    }

    if (
        feature("BG_SESSIONS") &&
        (args[0] === "ps" ||
            args[0] === "logs" ||
            args[0] === "attach" ||
            args[0] === "kill" ||
            args.includes("--bg") ||
            args.includes("--background"))
    ) {
        profileCheckpoint("cli_bg_path");
        const { enableConfigs } = await import("../utils/config.js");
        enableConfigs();
        const bg = await import("../cli/bg.js");
        switch (args[0]) {
            case "ps":
                await bg.psHandler(args.slice(1));
                break;
            case "logs":
                await bg.logsHandler(args[1]);
                break;
            case "attach":
                await bg.attachHandler(args[1]);
                break;
            case "kill":
                await bg.killHandler(args[1]);
                break;
            default:
                await bg.handleBgFlag(args);
        }
        return;
    }

    if (
        feature("TEMPLATES") &&
        (args[0] === "new" || args[0] === "list" || args[0] === "reply")
    ) {
        profileCheckpoint("cli_templates_path");
        const { templatesMain } =
            await import("../cli/handlers/templateJobs.js");
        templatesMain(args);
        process.exit(0);
    }

    if (
        feature("BYOC_ENVIRONMENT_RUNNER") &&
        args[0] === "environment-runner"
    ) {
        profileCheckpoint("cli_environment_runner_path");
        const { environmentRunnerMain } =
            await import("../environment-runner/main.js");
        await environmentRunnerMain(args.slice(1));
        return;
    }

    if (feature("SELF_HOSTED_RUNNER") && args[0] === "self-hosted-runner") {
        profileCheckpoint("cli_self_hosted_runner_path");
        const { selfHostedRunnerMain } =
            await import("../self-hosted-runner/main.js");
        await selfHostedRunnerMain(args.slice(1));
        return;
    }

    const hasTmuxFlag =
        args.includes("--tmux") || args.includes("--tmux=classic");
    if (
        hasTmuxFlag &&
        (args.includes("-w") ||
            args.includes("--worktree") ||
            args.some((a) => a.startsWith("--worktree=")))
    ) {
        profileCheckpoint("cli_tmux_worktree_fast_path");
        const { enableConfigs } = await import("../utils/config.js");
        enableConfigs();
        const { isWorktreeModeEnabled } =
            await import("../utils/worktreeModeEnabled.js");
        if (isWorktreeModeEnabled()) {
            const { execIntoTmuxWorktree } =
                await import("../utils/worktree.js");
            const result = await execIntoTmuxWorktree(args);
            if (result.handled) {
                return;
            }
            if (result.error) {
                const { exitWithError } = await import("../utils/process.js");
                exitWithError(result.error);
            }
        }
    }

    if (
        args.length === 1 &&
        (args[0] === "--update" || args[0] === "--upgrade")
    ) {
        process.argv = [process.argv[0]!, process.argv[1]!, "update"];
    }

    if (args.includes("--bare")) {
        process.env.CLAUDE_CODE_SIMPLE = "1";
    }

    const { startCapturingEarlyInput } = await import("../utils/earlyInput.js");
    startCapturingEarlyInput();
    profileCheckpoint("cli_before_main_import");
    const { main: cliMain } = await import("../main.jsx");
    profileCheckpoint("cli_after_main_import");
    await cliMain();
    profileCheckpoint("cli_after_main_complete");
}

void main();
