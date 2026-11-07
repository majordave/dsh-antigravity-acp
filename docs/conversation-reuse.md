# Spec: keep the ACP conversation across DSH turns

## Problem

Measured on 2026-11-07 (76 ACP conversations, 651 model calls in 24 h):

- Every DSH turn opened a fresh ACP session and resent the whole DSH history.
  The first call of each conversation is always cold: 5.2 M of the 6.8 M
  uncached input tokens (76 %) came from those first calls, while calls inside
  a tool loop (same ACP session) read 96-98 % from cache.
- The full resend must fit the server's 192 KB input limit, so long sessions
  are condensed (old tool outputs shortened, middle messages omitted) on every
  new human message: the model works from a degraded history.
- A tool loop is also rebuilt from scratch when DSH appends a context message
  with role `user` after a tool result (skill-catalog update, Mem0 recall, time
  context), because any user-role message in the tail was treated as a new turn.

## Goals

1. After a DSH turn ends with `end_turn`, keep its ACP session resting. The next
   turn of the same DSH session sends only the new messages to that session.
2. Inside a tool loop, deliver context-only user messages (source other than
   `user`) with the tool results instead of rebuilding.
3. Never let the ACP conversation diverge from DSH: when in doubt, rebuild from
   DSH history exactly as before.

## Rules

A resting conversation is continued only when all of these hold:

- Same DSH session id, request without `purpose`.
- Same signature (provider, model, system, tools).
- The previous request's history is an exact prefix of the new one.
- The first new message is the assistant reply this plugin streamed (no tool
  calls, same text after trimming).
- Every message after it has role `user` (human input or context), and there is
  at least one.
- The continuation prompt fits `promptBudgetBytes`.

Otherwise the resting conversation is closed (its process returns to the idle
pool) and the turn is rebuilt from the full DSH history.

Resting conversations expire after `conversationIdleMs` (default 15 min). At
most `maxIdleConversations` rest at once (default 2, `0` disables the feature);
the oldest is closed first. Each one keeps an official server process alive
(about 500 MB), which is why the cap is small. Resting conversations are also
evicted before `maxActiveToolSessions` would reject a new active turn.

A resting conversation never changes routing: `has()` stays true only for
sessions parked on DSH tool calls, so requests without tools keep using the
text route.

## Out of scope

- The text-only route (requests without tools) keeps a fresh session per call.
- Resuming after a provider or process restart (still rebuilt from DSH history).

## Acceptance

- Fake server: second turn of the same DSH session reuses the ACP session and
  the prompt carries only the new messages, with the latest human request.
- Fake server: history edits, model/tool changes, extra assistant/tool messages
  or expiry fall back to a fresh session with the full history.
- Fake server: a context-only user message after a tool result resumes the
  parked prompt and reaches the model inside the tool result.
- Cap and expiry close resting conversations; `has()` ignores them.
- Real server: a second DSH turn reports cache hits on its first call.
