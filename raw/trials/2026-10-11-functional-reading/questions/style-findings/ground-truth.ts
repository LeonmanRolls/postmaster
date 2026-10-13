// Ground truth for the reading questions about scripts/style-findings.ts.
//
//   bun --no-env-file --config=/dev/null <this file> <path to a copy of the module>
//
// Recomputes every answer by running the module and prints one JSON object, question id to answer.
// Nothing here reads the module's source except for a "change" question: the module text is copied
// to one temporary file in the module's own folder, the value of the named constant is replaced,
// the copy is run, and that one file is deleted.
//
// Each question is a spec (the same objects as spec.json):
//   kind "cli"   run the module as a program: args, files written under a fresh working directory,
//                optionally a git repository `repo` whose one branch holds `repo.files`
//   kind "call"  import the module in a fresh process and call one export with JSON arguments;
//                an argument "@file:<path>" is replaced by the absolute path of that written file
//   kind "fixed" no run can settle it; the answer is the stated string
//   extract      how the answer is read from what the run produced
//   change       { constant, value }: the module is run with `const <constant> = <value>`
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

type Extract =
  | { op: "lines"; skip?: number; drop?: number }
  | { op: "script-names"; skip?: number }
  | { op: "script-texts"; skip?: number }
  | { op: "package-dirs"; skip?: number }
  | { op: "after-where"; skip?: number }
  | { op: "fault-numbers" }
  | { op: "id-target-map" }
  | { op: "first-words" }
  | { op: "first-line" }
  | { op: "stderr-first-line" };

interface Change {
  constant: string;
  value: string;
}
interface Repo {
  dir: string;
  branch: string;
  files: Record<string, string>;
}
type Spec =
  | { kind: "cli"; args: string[]; files?: Record<string, string>; repo?: Repo; extract: Extract; change?: Change }
  | { kind: "call"; fn: string; args: unknown[]; files?: Record<string, string>; extract: Extract; change?: Change }
  | { kind: "fixed"; answer: string };

const SPECS: Record<string, Spec> = {
  "trace-1": {
    "kind": "cli",
    "args": [
      "count",
      "runs/T-1"
    ],
    "files": {
      "runs/T-1/actions.jsonl": "{\"action\":\"finding\",\"target\":\"a.ts:1\",\"detail\":\"style P3 r1 a name\"}\n\n{\"action\":\"dispatch\",\"target\":\"luna\",\"detail\":\"thread-1\"}\n{\"action\":\"finding\",\"target\":\"b.ts:2\",\"detail\":\"Style P3 r1 capitalised\"}\n{\"action\":\"finding\",\"target\":\"c.ts:3\"}\nnull\n{\"action\":\"finding\",\"target\":\"d.ts:4\",\"detail\":7}\n{\"action\":\"finding\",\"target\":\"e.ts:5\",\"detail\":\"style\\u0085P3 r2 after a next-line mark\"}\n{\"action\":\"note\",\"target\":\"f.ts:6\",\"detail\":\"advisory words\"}\n{\"action\":\"finding\",\"target\":\"g.ts:7\",\"detail\":\"style\\u200bP3 r1 zero width mark\"}\n{\"action\":\"finding\",\"target\":\"h.ts:8\",\"detail\":\"gating\"}\n"
    },
    "extract": {
      "op": "fault-numbers"
    }
  },
  "trace-2": {
    "kind": "call",
    "fn": "core",
    "args": [
      "forms",
      "@file:forms.txt"
    ],
    "files": {
      "forms.txt": "S1 linter biome enable no-var: a reason\n  S2 linter biome write plugin::rule via biome.json: why\nS3 linter biome enable x via: r\nS4 docs README.md CONTRIBUTING.md: r\n\nN1 new-linter shellcheck: r\n* N2 new-linter shellcheck S1 S2: r\nS5 neither extra: r\nS6 linter x fix y: r\n- S7 docs a.md: r\nS8 docs a.md r\nn9 neither: r\nS10 neither:\n"
    },
    "extract": {
      "op": "first-words"
    }
  },
  "trace-3": {
    "kind": "cli",
    "args": [
      "gate",
      "runs/T-1"
    ],
    "files": {
      "runs/T-1/brief.md": "## Project profile\nrepo: repo   default branch: main\ngate: run-p \"lint:*\" test:unit   build: none\n"
    },
    "repo": {
      "dir": "repo",
      "branch": "T-1",
      "files": {
        "package.json": "{\n  \"scripts\": {\n    \"test\": \"vitest\",\n    \"lint:js\": \"eslint .\",\n    \"prelint:css\": \"echo preparing\",\n    \"lint:css\": \"csslint .\",\n    \"lint:css:fix\": \"csslint --fix .\",\n    \"pretest:unit\": \"echo hi\",\n    \"relint:md\": \"markdownlint .\",\n    \"posttest:unit\": \"echo bye\",\n    \"test:unit\": \"bun test\",\n    \"build\": \"tsc\"\n  }\n}\n"
      }
    },
    "extract": {
      "op": "script-names",
      "skip": 1
    }
  },
  "trace-4": {
    "kind": "cli",
    "args": [
      "gate",
      "runs/T-1"
    ],
    "files": {
      "runs/T-1/brief.md": "## Project profile\nrepo: repo   default branch: main\ngate: bun test && pnpm deploy && yarn info && npm start && npm lint && pnpm test && bun run build   build: none\n"
    },
    "repo": {
      "dir": "repo",
      "branch": "T-1",
      "files": {
        "package.json": "{\n  \"scripts\": {\n    \"test\": \"vitest\",\n    \"build\": \"tsc\",\n    \"deploy\": \"./deploy.sh\",\n    \"info\": \"node info.js\",\n    \"lint\": \"eslint .\",\n    \"start\": \"node .\"\n  }\n}\n"
      }
    },
    "extract": {
      "op": "script-names",
      "skip": 1
    }
  },
  "trace-5": {
    "kind": "cli",
    "args": [
      "gate",
      "runs/T-1"
    ],
    "files": {
      "runs/T-1/brief.md": "## Project profile\nrepo: repo\ngate: CI=1 timeout -s KILL 30 npm run a ; nice -n 5 xargs -n 1 npm run b && command -v npm run c || echo $(npm run d) && sh -c 'npm run e > out.txt' # npm run f\n"
    },
    "repo": {
      "dir": "repo",
      "branch": "T-1",
      "files": {
        "package.json": "{\"scripts\":{\"a\":\"A\",\"b\":\"B\",\"c\":\"C\",\"d\":\"D\",\"e\":\"E\",\"f\":\"F\"}}\n"
      }
    },
    "extract": {
      "op": "script-names",
      "skip": 1
    }
  },
  "trace-6": {
    "kind": "cli",
    "args": [
      "gate",
      "runs/T-1"
    ],
    "files": {
      "runs/T-1/brief.md": "## Project profile\nrepo: repo   default branch: main\ngate: make -C ci -j8 -f alt.mk check LINT=ruff V=2   build: none\n"
    },
    "repo": {
      "dir": "repo",
      "branch": "T-1",
      "files": {
        "ci/alt.mk": "include extra-*.mk\ncheck: lint\n\techo checked $(V)\nlint:\n\t$(LINT) .\n",
        "ci/extra-1.mk": "lint:\n\techo one\n",
        "ci/extra-2.mk": "lint:\n\techo two\n",
        "ci/Makefile": "check:\n\techo wrong\n",
        "Makefile": "check:\n\techo wrong-root\n"
      }
    },
    "extract": {
      "op": "lines",
      "skip": 1
    }
  },
  "trace-7": {
    "kind": "cli",
    "args": [
      "gate",
      "runs/T-1"
    ],
    "files": {
      "runs/T-1/brief.md": "## Project profile\nrepo: repo   default branch: main\ngate: just c   build: none\n"
    },
    "repo": {
      "dir": "repo",
      "branch": "T-1",
      "files": {
        "justfile": "set shell := ['bash', '-uc']\ntool := 'ruff'\nalias c := check\n\ndefault:\n    echo first\n\n[private]\ncheck: lint (fmt \"x\")\n    @{{tool}} check .\n\n    -{{other}} --now\n# a note\n    cargo test\n\nlint:\n    cargo clippy\n\nfmt arg:\n    cargo fmt\n"
      }
    },
    "extract": {
      "op": "lines",
      "skip": 1
    }
  },
  "trace-8": {
    "kind": "cli",
    "args": [
      "gate",
      "runs/T-1"
    ],
    "files": {
      "runs/T-1/brief.md": "## Project profile\nrepo: repo   default branch: main\ngate: pre-commit run && lint-staged   build: none\n"
    },
    "repo": {
      "dir": "repo",
      "branch": "T-1",
      "files": {
        ".pre-commit-config.yaml": "repos:\n  - repo: https://x.test/r#v1   # pinned\n    hooks:\n      - id: ruff ; fix\n      # - id: mypy\n      - id: black\n",
        "lint-staged.config.js": "/* eslint\n * is run */\n// prettier too\nexport default {\n  '*.js': 'eslint', // then csslint\n};\n"
      }
    },
    "extract": {
      "op": "after-where",
      "skip": 1
    }
  },
  "trace-9": {
    "kind": "cli",
    "args": [
      "check",
      "runs/T-1"
    ],
    "files": {
      "runs/T-1/actions.jsonl": "{\"action\":\"finding\",\"target\":\"a.ts:1\",\"detail\":\"style P3 x\"}\n{\"action\":\"finding\",\"target\":\"b.ts:1\",\"detail\":\"style P3 x\"}\n{\"action\":\"finding\",\"target\":\"c.ts:1\",\"detail\":\"style P3 x\"}\n{\"action\":\"finding\",\"target\":\"d.ts:1\",\"detail\":\"style P3 x\"}\n{\"action\":\"finding\",\"target\":\"e.ts:1\",\"detail\":\"style P3 x\"}\n",
      "runs/T-1/brief.md": "## Project profile\nrepo: repo   default branch: main\ngate: npm run check   build: none\n",
      "runs/T-1/style-sort.md": "S1 linter **ESLint** enable no-var: a\nS2 linter `Prettier` write quotes: b\nS3 linter biome enable x: c\nS4 linter oxlint enable x: d\nS5 linter cspell enable x: e\n"
    },
    "repo": {
      "dir": "repo",
      "branch": "T-1",
      "files": {
        "package.json": "{\"scripts\":{\"check\":\"npx eslint_d . && ./node_modules/.bin/prettier --check . && bash tools/lint.sh && cat oxlint.log && cspell-cli .\"}}\n",
        "tools/lint.sh": "biome check .\n"
      }
    },
    "extract": {
      "op": "fault-numbers"
    }
  },
  "trace-10": {
    "kind": "cli",
    "args": [
      "gate",
      "runs/T-1"
    ],
    "files": {
      "runs/T-1/brief.md": "## Project profile\nrepo: repo   default branch: main\ngate: pnpm --filter \"libs/**\" lint && turbo run lint --filter=./tools -F legacy   build: none\n"
    },
    "repo": {
      "dir": "repo",
      "branch": "T-1",
      "files": {
        "pnpm-workspace.yaml": "packages:\n  - 'apps/*'   # applications\n  - \"libs/**\"\n# the rest are special\n  - '!apps/legacy'\n  - tools\n",
        "package.json": "{\"scripts\":{\"lint\":\"echo root\"}}\n",
        "apps/web/package.json": "{\"name\":\"@acme/web\",\"scripts\":{\"lint\":\"echo web\"}}\n",
        "apps/api/package.json": "{\"name\":\"api\",\"scripts\":{\"lint\":\"echo api\"}}\n",
        "apps/legacy/package.json": "{\"name\":\"legacy\",\"scripts\":{\"lint\":\"echo legacy\"}}\n",
        "libs/ui/package.json": "{\"name\":\"ui\",\"scripts\":{\"lint\":\"echo ui\"}}\n",
        "libs/ui/icons/package.json": "{\"name\":\"icons\",\"scripts\":{\"lint\":\"echo icons\"}}\n",
        "tools/package.json": "{\"name\":\"tools\",\"scripts\":{\"lint\":\"echo tools\"}}\n"
      }
    },
    "extract": {
      "op": "package-dirs",
      "skip": 1
    }
  },
  "state-1": {
    "kind": "cli",
    "args": [
      "list",
      "runs/T-1"
    ],
    "files": {
      "runs/T-1/actions.jsonl": "{\"action\":\"finding\",\"target\":\"a.ts:1\",\"detail\":\"style P3 r1 note one\"}\n{\"action\":\"finding\",\"target\":\"b.ts:2\",\"detail\":\"style P3 r1 note two\"}\n{\"action\":\"finding\",\"target\":\"c.ts:3\",\"detail\":\"gating P2 r1 note three\"}\n{\"action\":\"finding\",\"target\":\"a.ts:1\",\"detail\":\"style P3 r2 note one again\"}\n{\"action\":\"finding\",\"target\":\"d.ts:4\",\"detail\":\"style P3 r1 note four\"}\n{\"action\":\"finding\",\"target\":\"b.ts:2\",\"detail\":\"gating P1 r2 note two argued\"}\n{\"action\":\"finding\",\"target\":\"c.ts:3\",\"detail\":\"style P3 r2 note three now\"}\n"
    },
    "extract": {
      "op": "id-target-map"
    }
  },
  "state-2": {
    "kind": "cli",
    "args": [
      "gate",
      "runs/T-1"
    ],
    "files": {
      "runs/T-1/brief.md": "# Waybill: T-1\n\n## Project profile\nrepo: first\ngate: make decoy\n\n## Notes\nrepo: notes-repo\n\n## Project profile:\ngate: npm test   build: make\n### Detail\n- **repo:** `second`   default branch: main\nrepo: third\n## Dispatch\nrepo: fourth\n"
    },
    "extract": {
      "op": "first-line"
    }
  },
  "state-3": {
    "kind": "cli",
    "args": [
      "gate",
      "runs/T-1"
    ],
    "files": {
      "runs/T-1/brief.md": "## Project profile\nrepo: repo   default branch: main\ngate: bash ci.sh   build: none\n"
    },
    "repo": {
      "dir": "repo",
      "branch": "T-1",
      "files": {
        "package.json": "{\"scripts\":{\"lint\":\"ROOT-LINT\",\"test\":\"ROOT-TEST\"}}\n",
        "web/package.json": "{\"scripts\":{\"lint\":\"WEB-LINT\",\"test\":\"WEB-TEST\"}}\n",
        "web/src/app.ts": "export {};\n",
        "api/package.json": "{\"scripts\":{\"lint\":\"API-LINT\",\"test\":\"API-TEST\"}}\n",
        "ci.sh": "cd web/src\nnpm run lint\n(cd ../../api && npm run test)\nnpm run test\ncd ../..\nnpm run test\n"
      }
    },
    "extract": {
      "op": "script-texts",
      "skip": 1
    }
  },
  "state-4": {
    "kind": "cli",
    "args": [
      "gate",
      "runs/T-1"
    ],
    "files": {
      "runs/T-1/brief.md": "## Project profile\nrepo: repo   default branch: main\ngate: npm run a   build: none\n"
    },
    "repo": {
      "dir": "repo",
      "branch": "T-1",
      "files": {
        "package.json": "{\n  \"scripts\": {\n    \"a\": \"npm run b && npm run c\",\n    \"b\": \"npm run c && npm run a\",\n    \"c\": \"echo c\",\n    \"prec\": \"echo pre-c\",\n    \"postb\": \"npm run d\",\n    \"d\": \"echo d\"\n  }\n}\n"
      }
    },
    "extract": {
      "op": "script-names",
      "skip": 1
    }
  },
  "state-5": {
    "kind": "cli",
    "args": [
      "gate",
      "runs/T-1"
    ],
    "files": {
      "runs/T-1/brief.md": "## Project profile\nrepo: repo   default branch: main\ngate: make LINT=pylint check   build: none\n"
    },
    "repo": {
      "dir": "repo",
      "branch": "T-1",
      "files": {
        "Makefile": "CC = gcc\nFLAGS := -O1 $(CC)\nCC = clang\nLINT ?= ruff\nOPTS = -a\nOPTS += -b\nOPTS := $(OPTS) -c\nLINT = flake8\ncheck:\n\t$(LINT) $(FLAGS) $(OPTS) $(CC)\n"
      }
    },
    "extract": {
      "op": "lines",
      "skip": 1
    }
  },
  "state-6": {
    "kind": "cli",
    "args": [
      "gate",
      "runs/T-1"
    ],
    "files": {
      "runs/T-1/brief.md": "## Project profile\nrepo: repo   default branch: main\ngate: make   build: none\n"
    },
    "repo": {
      "dir": "repo",
      "branch": "T-1",
      "files": {
        "Makefile": ".PHONY: all\nV = 1\n\techo orphan\nall: lint test\nifeq ($(V),1)\n\techo in-ifeq\nendif\nlint:\n\truff .\ndefine HELP\n\techo in-define\ntest:\nendef\n\techo after-define\ntest: lint\n\tpytest\n"
      }
    },
    "extract": {
      "op": "lines",
      "skip": 1
    }
  },
  "state-7": {
    "kind": "cli",
    "args": [
      "check",
      "runs/T-1"
    ],
    "files": {
      "runs/T-1/actions.jsonl": "{\"action\":\"finding\",\"target\":\"a.ts:1\",\"detail\":\"style P3 x\"}\n{\"action\":\"finding\",\"target\":\"b.ts:1\",\"detail\":\"style P3 x\"}\n{\"action\":\"finding\",\"target\":\"c.ts:1\",\"detail\":\"style P3 x\"}\n",
      "runs/T-1/brief.md": "## Project profile\nrepo: repo   default branch: main\ngate: true   build: none\n",
      "runs/T-1/style-sort.md": "# sort for T-1\n\nS1 neither: a\nN1 new-linter Shellcheck S1: x\nS2 neither: b\nS3 docs A.md: c\nN2 new-linter shellcheck S2,S3: y\n"
    },
    "repo": {
      "dir": "repo",
      "branch": "T-1",
      "files": {
        "package.json": "{}\n"
      }
    },
    "extract": {
      "op": "first-line"
    }
  },
  "state-8": {
    "kind": "cli",
    "args": [
      "check",
      "runs/T-9"
    ],
    "files": {
      "runs/T-9/actions.jsonl": "{\"action\":\"finding\",\"target\":\"a.ts:1\",\"detail\":\"style P3 x\"}\n{\"action\":\"finding\",\"target\":\"b.ts:1\",\"detail\":\"style P3 x\"}\n{\"action\":\"finding\",\"target\":\"c.ts:1\",\"detail\":\"style P3 x\"}\n",
      "runs/T-9/style-sort.md": "S1 docs A.md: a\nS2 docs B.md: b\nS3 docs C.md: c\n",
      "runs/ledger.jsonl": "{\"action\":\"note\",\"run\":\"T-1\",\"target\":\"T-1\",\"detail\":\"style proposal asked: docs A.md\"}\n{\"action\":\"ticket-create\",\"run\":\"T-2\",\"target\":\"41\",\"detail\":\"style proposal: docs A.md\"}\n{\"action\":\"note\",\"run\":\"T-3\",\"target\":\"T-3\",\"detail\":\"style proposal asked: docs A.md\"}\n{\"action\":\"note\",\"run\":\"T-4\",\"target\":\"T-4\",\"detail\":\"style proposal declined: docs B.md: not now\"}\n{\"action\":\"note\",\"run\":\"T-5\",\"target\":\"T-5\",\"detail\":\"style proposal asked: docs B.md\"}\n{\"action\":\"note\",\"run\":\"T-6\",\"target\":\"T-6\",\"detail\":\"style proposal asked: docs C.md\"}\n{\"action\":\"note\",\"run\":\"T-7\",\"target\":\"T-7\",\"detail\":\"style proposal declined: docs C.md: later\"}\n{\"action\":\"ticket-create\",\"target\":\"55\",\"detail\":\"style proposal: docs C.md\"}\n"
    },
    "extract": {
      "op": "lines",
      "drop": 1
    }
  },
  "change-1": {
    "kind": "cli",
    "args": [
      "gate",
      "runs/T-1"
    ],
    "files": {
      "runs/T-1/brief.md": "## Project profile\nrepo: repo   default branch: main\ngate: bash a.sh   build: none\n"
    },
    "repo": {
      "dir": "repo",
      "branch": "T-1",
      "files": {
        "a.sh": "echo 1\nbash b.sh\necho 3\necho 4\n",
        "b.sh": "echo b1\necho b2\necho b3\n"
      }
    },
    "extract": {
      "op": "lines"
    },
    "change": {
      "constant": "SHOWN",
      "value": "2"
    }
  },
  "change-2": {
    "kind": "cli",
    "args": [
      "gate",
      "runs/T-1"
    ],
    "files": {
      "runs/T-1/brief.md": "## Project profile\nrepo: repo   default branch: main\ngate: npm run check   build: none\n"
    },
    "repo": {
      "dir": "repo",
      "branch": "T-1",
      "files": {
        "package.json": "{\n  \"scripts\": {\n    \"check\": \"npm run lint && npm run test # then format\",\n    \"lint\": \"npm run format && npm run types\",\n    \"test\": \"vitest run\",\n    \"format\": \"prettier --check .\",\n    \"types\": \"tsc --noEmit\"\n  }\n}\n"
      }
    },
    "extract": {
      "op": "script-names",
      "skip": 1
    },
    "change": {
      "constant": "LONG",
      "value": "28"
    }
  },
  "change-3": {
    "kind": "cli",
    "args": [
      "gate",
      "runs/T-1"
    ],
    "files": {
      "runs/T-1/brief.md": "## Project profile\nrepo: repo   default branch: main\n- **gate:** npm run lint   **build:** none\n"
    },
    "repo": {
      "dir": "repo",
      "branch": "T-1",
      "files": {
        "package.json": "{\"scripts\":{\"lint\":\"eslint .\"}}\n"
      }
    },
    "extract": {
      "op": "lines"
    },
    "change": {
      "constant": "MARK",
      "value": "\"\""
    }
  },
  "change-4": {
    "kind": "cli",
    "args": [
      "gate",
      "runs/T-1"
    ],
    "files": {
      "runs/T-1/brief.md": "## Project profile\nrepo: repo   default branch: main\ngate: make -j 4 -l 1.5   build: none\n"
    },
    "repo": {
      "dir": "repo",
      "branch": "T-1",
      "files": {
        "Makefile": "lint:\n\truff .\n4:\n\techo four\n"
      }
    },
    "extract": {
      "op": "lines"
    },
    "change": {
      "constant": "MVER",
      "value": "/^\\p{Nd}+\\.\\p{Nd}+$/u"
    }
  },
  "change-5": {
    "kind": "cli",
    "args": [
      "gate",
      "runs/T-1"
    ],
    "files": {
      "runs/T-1/brief.md": "## Project profile\nrepo: repo   default branch: main\ngate: yarn lint   build: none\n"
    },
    "repo": {
      "dir": "repo",
      "branch": "T-1",
      "files": {
        "package.json": "{\n  \"packageManager\": \"yarn@2.4.3\",\n  \"scripts\": {\n    \"prelint\": \"echo before\",\n    \"lint\": \"eslint .\",\n    \"postlint\": \"echo after\"\n  }\n}\n"
      }
    },
    "extract": {
      "op": "script-names",
      "skip": 1
    },
    "change": {
      "constant": "YARNRE",
      "value": "/^yarn@([3-9])/u"
    }
  },
  "change-6": {
    "kind": "cli",
    "args": [
      "check",
      "runs/T-1"
    ],
    "files": {
      "runs/T-1/actions.jsonl": "{\"action\":\"finding\",\"target\":\"a.ts:1\",\"detail\":\"style P3 x\"}\n",
      "runs/T-1/brief.md": "## Project profile\nrepo: repo   default branch: main\ngate: npm run lint   build: none\n",
      "runs/T-1/style-sort.md": "S1 neither: a\nN1 new-linter ruff S1: x\n"
    },
    "repo": {
      "dir": "repo",
      "branch": "T-1",
      "files": {
        "package.json": "{\"scripts\":{\"lint\":\"tsc\"}}\n",
        "pyproject.toml": "[tool.ruff]\nline-length = 88\n"
      }
    },
    "extract": {
      "op": "lines"
    },
    "change": {
      "constant": "MANIFESTS",
      "value": "/(^|\\/)(package\\.json)$/u"
    }
  },
  "control-trivial": {
    "kind": "cli",
    "args": [],
    "extract": {
      "op": "stderr-first-line"
    }
  },
  "control-undetermined": {
    "kind": "fixed",
    "answer": "undetermined",
    "reason": "runs/T-7/actions.jsonl exists but its content is not shown, so the printed count cannot be known from the module"
  }
};

// --- running ------------------------------------------------------------------------------------
const BUN = process.execPath;
const BUN_FLAGS = ["--no-env-file", "--config=/dev/null"];
const LIMIT_MS = 30000;

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith("GIT_")) env[k] = v;
  }
  return env;
}

interface Ran {
  code: number | null;
  out: string;
  err: string;
  failed: string | null;
}

function spawn(cmd: string, args: string[], cwd: string): Ran {
  const r = spawnSync(cmd, args, {
    cwd,
    env: cleanEnv(),
    encoding: "utf8",
    timeout: LIMIT_MS,
    killSignal: "SIGKILL",
    maxBuffer: 64 * 1024 * 1024,
  });
  const failed = r.error ? String(r.error.message ?? r.error) : r.status === null ? "killed" : null;
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "", failed };
}

function git(dir: string, ...args: string[]): void {
  const r = spawn(
    "git",
    [
      "-c", "user.name=brindlewick",
      "-c", "user.email=332054101+brindlewick@users.noreply.github.com",
      "-c", "commit.gpgsign=false",
      "-c", "core.hooksPath=/dev/null",
      "-c", "core.excludesFile=/dev/null",
      "-C", dir,
      ...args,
    ],
    dir,
  );
  if (r.failed || r.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.err}`);
}

function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
}

function withRoot<T>(spec: { files?: Record<string, string>; repo?: Repo }, fn: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), "sfgt-"));
  try {
    writeTree(root, spec.files ?? {});
    if (spec.repo) {
      const dir = join(root, spec.repo.dir);
      mkdirSync(dir, { recursive: true });
      git(root, "init", "-q", spec.repo.dir);
      git(dir, "symbolic-ref", "HEAD", `refs/heads/${spec.repo.branch}`);
      writeTree(dir, spec.repo.files);
      git(dir, "add", "-A", "-f");
      git(dir, "commit", "-q", "-m", "fixture");
    }
    return fn(root);
  } finally {
    // The directory was created above by mkdtempSync under the temporary directory.
    if (root.startsWith(tmpdir() + sep) && basename(root).startsWith("sfgt-")) {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

// --- a "change" question: the module text with one constant's value replaced --------------------
function literalEnd(s: string, i: number): number {
  const c = s[i];
  if (c === '"' || c === "'" || c === "`") {
    let j = i + 1;
    while (j < s.length && s[j] !== c) j += s[j] === "\\" ? 2 : 1;
    return j + 1;
  }
  if (c === "/") {
    let j = i + 1;
    let inClass = false;
    while (j < s.length) {
      const d = s[j];
      if (d === "\\") j += 2;
      else if (d === "[") { inClass = true; j++; }
      else if (d === "]") { inClass = false; j++; }
      else if (d === "/" && !inClass) break;
      else j++;
    }
    j++;
    while (j < s.length && /[a-z]/u.test(s[j] ?? "")) j++;
    return j;
  }
  let j = i;
  while (j < s.length && !/[;\n]/u.test(s[j] ?? "")) j++;
  return j;
}

function replaceConstant(src: string, name: string, literal: string): string | null {
  const re = new RegExp(`(?:^|\\n)[ \\t]*(?:export\\s+)?const\\s+${name}\\s*(?::[^=\\n]+)?=\\s*`, "u");
  const m = re.exec(src);
  if (!m) return null;
  const start = m.index + m[0].length;
  return src.slice(0, start) + literal + src.slice(literalEnd(src, start));
}

let tempCounter = 0;
function withModule<T>(modulePath: string, change: Change | undefined, fn: (path: string) => T): T {
  if (!change) return fn(modulePath);
  const replaced = replaceConstant(readFileSync(modulePath, "utf8"), change.constant, change.value);
  if (replaced === null) throw new Error(`no constant ${change.constant} in the module`);
  tempCounter++;
  const tmp = join(dirname(modulePath), `${basename(modulePath, ".ts")}.gt-${process.pid}-${tempCounter}.ts`);
  writeFileSync(tmp, replaced);
  try {
    return fn(tmp);
  } finally {
    unlinkSync(tmp);
  }
}

// --- reading an answer out of a run -------------------------------------------------------------
function stdoutLines(text: string): string[] {
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body === "" ? [] : body.split("\n");
}

function extract(ex: Extract, lines: string[], stderr: string): unknown {
  const rest = (skip?: number): string[] => lines.slice(skip ?? 0);
  switch (ex.op) {
    case "lines":
      return rest(ex.skip).slice(0, Math.max(0, lines.length - (ex.skip ?? 0) - (ex.drop ?? 0)));
    case "first-line":
      return lines[0] ?? "";
    case "stderr-first-line":
      return stderr.split("\n")[0] ?? "";
    case "script-names":
      return rest(ex.skip).map((l) => (/ scripts\.(.*?): /u.exec(l)?.[1] ?? l));
    case "script-texts":
      return rest(ex.skip)
        .filter((l) => / scripts\./u.test(l))
        .map((l) => l.slice(l.indexOf(": ") + 2));
    case "package-dirs":
      return rest(ex.skip).map((l) => /^(.*)\/package\.json scripts\./u.exec(l)?.[1] ?? l);
    case "after-where":
      return rest(ex.skip).map((l) => l.slice(l.indexOf(": ") + 2));
    case "fault-numbers":
      return lines.flatMap((l) => {
        const m = /^(?:actions\.jsonl )?line (\d+)/u.exec(l);
        return m ? [Number(m[1])] : [];
      });
    case "id-target-map": {
      const out: Record<string, string> = {};
      for (const l of lines) {
        const [id, target] = l.split(" ");
        if (id !== undefined) out[id] = target ?? "";
      }
      return out;
    }
    case "first-words":
      return lines.map((l) => l.split(" ")[0] ?? "");
  }
}

// --- one question -------------------------------------------------------------------------------
const DRIVER = [
  "const [mod, fn, raw] = process.argv.slice(1);",
  "const m = await import(mod);",
  "const chunks = [];",
  "const log = console.log;",
  "console.log = (...a) => { chunks.push(a.join(' ')); };",
  "let ret;",
  "try { ret = await m[fn](...JSON.parse(raw)); } finally { console.log = log; }",
  "console.log(JSON.stringify({ ret: ret === undefined ? null : ret, out: chunks }));",
].join("\n");

function answer(spec: Spec, modulePath: string): unknown {
  if (spec.kind === "fixed") return spec.answer;
  return withModule(modulePath, spec.change, (mod) =>
    withRoot(spec, (root) => {
      if (spec.kind === "cli") {
        const r = spawn(BUN, [...BUN_FLAGS, mod, ...spec.args], root);
        if (r.failed) return `ERROR: ${r.failed}`;
        return extract(spec.extract, stdoutLines(r.out), r.err);
      }
      const args = spec.args.map((a) =>
        typeof a === "string" && a.startsWith("@file:") ? join(root, a.slice(6)) : a,
      );
      const r = spawn(BUN, [...BUN_FLAGS, "-e", DRIVER, mod, spec.fn, JSON.stringify(args)], root);
      if (r.failed || r.code !== 0) return `ERROR: ${r.failed ?? `exit ${r.code}`}`;
      const got = JSON.parse(r.out) as { ret: unknown; out: string[] };
      return extract(spec.extract, got.out, r.err);
    }),
  );
}

// --- main ---------------------------------------------------------------------------------------
if (import.meta.main) {
  const given = process.argv[2];
  if (!given) {
    console.error("usage: bun --no-env-file --config=/dev/null ground-truth.ts <path to the module>");
    process.exit(2);
  }
  const modulePath = isAbsolute(given) ? given : resolve(given);
  const result: Record<string, unknown> = {};
  for (const [id, spec] of Object.entries(SPECS)) {
    try {
      result[id] = answer(spec, modulePath);
    } catch (e) {
      result[id] = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  console.log(JSON.stringify(result));
}
