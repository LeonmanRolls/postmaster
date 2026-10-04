#!/usr/bin/env bash
printf '{"type":"system","subtype":"init","session_id":"probe-1","model":"m"}\n'
if (: < /dev/tty) 2>/dev/null; then tty=yes; else tty=no; fi
printf 'from=%s|name=%s|pane=%s|tmuxpane=%s|var=%s|sid=%s|pid=%s|pgid=%s|tty=%s\n' "$PWD" "$POSTMASTER_LAUNCH_NAME" "$HERDR_PANE_ID" "$TMUX_PANE" "$CALLER_VAR" "$(ps -o sid= -p $$ | tr -d ' ')" "$$" "$(ps -o pgid= -p $$ | tr -d ' ')" "$tty"
count_path=$(printenv COUNT); if [ -n "$count_path" ]; then echo x >> "$count_path"; fi
sleep "$(printenv EMIT_SLEEP || printf 0)"
