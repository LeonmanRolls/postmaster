require("fs").writeFileSync(require("path").join(process.env.GUARD_MARKER_DIR || require("os").tmpdir(), "g-scripts"), "x");
