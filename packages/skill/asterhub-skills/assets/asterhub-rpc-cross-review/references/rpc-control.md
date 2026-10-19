# AsterHub SDK control for review

Use `@deepseek-ai/dsh-sdk-client` with the supported `sdk` profile. The client launches the `dsh --profile sdk` runtime and uses its documented AsterHub JSON-RPC protocol. Review and development routes are process-wide initialization settings, so create a separate harness for the reviewer.

## Confirm and initialize a review route

Obtain the review provider and model from the user for this batch. Compare them with the main and development routes, and confirm that the current runtime accepts the exact route. The SDK `initialize` handshake validates the selected model route and optional adapter-owned reasoning effort before prompts are accepted. If initialization rejects the route, do not silently fall back.

```ts
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'

const reviewHarness = new DeepSeekHarness({
  profile: 'sdk',
  cwd: projectDirectory,
  provider: userSelectedReviewProvider,
  model: userSelectedReviewModel,
})
const reviewSession = reviewHarness.session(reviewSessionId)
const report = await reviewSession.run(reviewPrompt)
```

Only set `reasoningEffort` when the user selected one and the route supports it. Do not change a shared profile, global default, or the main session's route to satisfy review selection.

## Keep the candidate stable

Give the reviewer the precise source revision or a complete file snapshot including relevant callers, configuration, tests, and the applicable specification. Ask for read-only findings with file locations and static evidence. Keep product files unchanged until review completes; if they change during review, repeat review for the affected contract.

`HarnessSession.run()` waits until the session is idle. Inspect the returned events and reviewer report for this exact run. In low-level JSON-RPC usage, `session/prompt` returns a queued message ID; it is not review completion. Follow `session.event` and `session.status` through idle. Use only the methods listed in the SDK protocol reference.

## Close and recover

Close the review harness only after the report is settled and recorded. The SDK server stores agent handles in its process-local map, so a new process cannot resume that reviewer session. Persistent Session events can be inspected through the configured AsterHub persistence/query surfaces. After runtime loss, preserve the old evidence, reconcile the candidate, and use a new review session ID against the current candidate.
