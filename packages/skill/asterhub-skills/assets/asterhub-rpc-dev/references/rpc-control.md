# AsterHub SDK session control

Use the supported TypeScript client, `@deepseek-ai/dsh-sdk-client`. It starts the same-version `dsh` executable with the named `sdk` profile and communicates with the runtime through the AsterHub JSON-RPC protocol. `dsh --profile sdk` is the runtime entry point; it is not a separate RPC subcommand or a substitute for the SDK client.

## Create a named session

Use the selected project cwd and an explicit route already authorized for the batch:

```ts
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'

const harness = new DeepSeekHarness({
  profile: 'sdk',
  cwd: projectDirectory,
  provider: selectedProvider,
  model: selectedModel,
  ...reasoningEffort === undefined ? {} : { reasoningEffort },
})
const session = harness.session(sessionId)
const result = await session.run(slicePrompt)
```

Use a distinct stable ID for each independently owned session. The runtime lazily creates a session for an unknown ID. Repeated calls to the same handle within this runtime process continue its agent and append durable events to its Session log. Separate `DeepSeekHarness` instances have separate runtime processes; initialize each with the intended route and profile settings.

## Observe completion

`HarnessSession.run()` waits for the prompt's durable inbox receipt and the next whole-agent `idle`, then returns the session ID, assistant text, Session events, and notifications. Inspect events in order and retain their `seq` values when recording evidence. The final response is an activity summary, not a causal response identifier.

The lower-level protocol supports `initialize`, `session/prompt`, and `shutdown` requests, plus `session.event`, `session.status`, `subagent.started`, and `subagent.finished` notifications. Await initialization before prompting. A successful `session/prompt` response is only a queued-message receipt; completion comes from observing the session through idle. Use only the methods listed in the SDK protocol reference.

## Runtime loss

The SDK server retains created agent handles in its process-local session map. Its current protocol cannot attach a new runtime process to an existing SDK agent. A durable Session log can still be read by the configured AsterHub persistence and session-query surfaces. Use those supported surfaces to inspect recorded events and status, reconcile project files, then create a new session ID with an explicit handoff. Do not send the prior write request again until its effects are understood.

Close each harness after all its runs settle. The client sends `shutdown`, disposes the runtime, and waits for the child process to exit. Process exit does not establish the state of external processes started by the task; check only resources owned by the slice.
