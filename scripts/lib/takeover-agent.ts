// Which agent a takeover starts. A coachman that hit a provider wall is replaced by the run's
// fallback, and starting it launches a new session, so the command names the agent it means:
// the run's recorded fallback, written `--recorded`, or another by model and effort, which the
// user has confirmed. A takeover with neither is refused, so a session cannot start on a default.
//
//   run host leg takeover <dispatch> <worktree> <leg> <number> <prompt> --recorded
//   run host leg takeover <dispatch> <worktree> <leg> <number> <prompt> --model <m> --effort <e>
//                                                     [--harness <h>] [--env-file <f>]
export interface Agent {
  readonly model: string;
  readonly effort: string;
  readonly harness?: string;
  readonly env_file?: string;
}

export type TakeoverArgs =
  | { readonly positionals: readonly string[]; readonly agent: Agent | "recorded" }
  | { readonly error: string };

export const TAKEOVER_USAGE =
  "usage: run host leg takeover <dispatch> <worktree> <leg> <number> <prompt> --recorded | --model <model> --effort <effort> [--harness <harness>] [--env-file <file>]";

const VALUE_FLAGS = ["--model", "--effort", "--harness", "--env-file"] as const;

/** Split a takeover's arguments into its five positionals and the agent it names. */
export function parseTakeover(args: readonly string[]): TakeoverArgs {
  const positionals: string[] = [];
  const values = new Map<string, string>();
  let recorded = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === "--recorded") {
      recorded = true;
    } else if ((VALUE_FLAGS as readonly string[]).includes(a)) {
      const v = args[i + 1];
      if (v === undefined || v === "" || v.startsWith("--")) {
        return { error: `${a} needs a value` };
      }
      values.set(a, v);
      i += 1;
    } else if (a.startsWith("--")) {
      return { error: `unknown option ${a}` };
    } else {
      positionals.push(a);
    }
  }
  if (positionals.length !== 5) return { error: TAKEOVER_USAGE };
  const named = values.size > 0;
  if (recorded && named) {
    return {
      error:
        "--recorded names the run's own fallback: it takes no --model, --effort, --harness or --env-file",
    };
  }
  if (recorded) return { positionals, agent: "recorded" };
  if (!named) {
    return {
      error:
        "a takeover names its agent: --recorded for the run's recorded fallback, or --model and --effort for another, confirmed with the user",
    };
  }
  const model = values.get("--model");
  const effort = values.get("--effort");
  if (model === undefined || effort === undefined) {
    return { error: "a takeover on another agent needs both --model and --effort" };
  }
  const harness = values.get("--harness");
  const envFile = values.get("--env-file");
  return {
    positionals,
    agent: {
      model,
      effort,
      ...(harness === undefined ? {} : { harness }),
      ...(envFile === undefined ? {} : { env_file: envFile }),
    },
  };
}

/** A recorded role table with the agent's fields laid over it. Fields it does not name stay. */
export function overlay(
  recorded: Readonly<Record<string, unknown>>,
  agent: Agent,
): Record<string, unknown> {
  return {
    ...recorded,
    model: agent.model,
    effort: agent.effort,
    ...(agent.harness === undefined ? {} : { harness: agent.harness }),
    ...(agent.env_file === undefined ? {} : { env_file: agent.env_file }),
  };
}

/** The agent as it travels from the command to the launch: one JSON value in the environment. */
export const AGENT_ENV = "POSTMASTER_TAKEOVER_AGENT";

export function readAgentEnv(value: string | undefined): Agent | null {
  if (value === undefined || value === "") return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (typeof parsed.model !== "string" || typeof parsed.effort !== "string") return null;
    return {
      model: parsed.model,
      effort: parsed.effort,
      ...(typeof parsed.harness === "string" ? { harness: parsed.harness } : {}),
      ...(typeof parsed.env_file === "string" ? { env_file: parsed.env_file } : {}),
    };
  } catch {
    return null;
  }
}

/** The launch flags that carry an agent to run launch. */
export function launchFlags(agent: Agent): string[] {
  return [
    "--model",
    agent.model,
    "--effort",
    agent.effort,
    ...(agent.harness === undefined ? [] : ["--harness", agent.harness]),
    ...(agent.env_file === undefined ? [] : ["--env-file", agent.env_file]),
  ];
}
