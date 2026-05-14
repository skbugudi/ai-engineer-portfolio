Remove the tool_choice line (delete tool_choice: { type: "tool", name: "extract_contact" },). Re-run. Did Claude still call the tool, or did it respond in plain text?  --> No chnage still I got same response
Delete the phone line from messyText ("she mentioned her mobile is 0412 555 889"). Keep tool_choice in. Re-run. What does the phone field contain in the output? --> No phone field
Add "phone" to the required array, then keep the phone line deleted. Re-run. Does Claude hallucinate a phone number, return empty, or error? --> "phone": "<UNKNOWN>",
## 03 — Structured output

Experiments:
- **Removed tool_choice:** still called the tool. With one tool + obvious match, auto works. Force in production anyway — auto isn't guaranteed across inputs and model versions.
- **Phone optional, deleted from input:** field omitted from JSON entirely. Downstream code must use optional chaining.
- **Phone required, deleted from input:** Claude returned `"phone": "<UNKNOWN>"`. Better than hallucinating a number, but still violates the schema's implicit "this is a phone number" contract. Lesson: don't mark fields required if source data may not contain them. Design schemas to handle absence explicitly (empty string sentinel + clear description).

## 04 — Playwright agent (multi-step click variant)

Working multi-step agent: HN front page → click first 3 stories → report destination URLs.
Took 7 turns (1 nav + 1 read + 3 clicks + 2 re-navs).

Observations:
- Agent followed the "re-navigate between clicks" instruction literally — wasted turns.
- The same task could've been done in 2 turns by extracting hrefs from the enriched
  `get_page_text` output. Tool design > agent cleverness.
- Need to verify URLs manually — at least one looks suspicious. No automated way to
  catch hallucinations yet. This is what evals (week 3–4) are for.
- TODO: harden `click` against multiple matching anchors per row (HN-specific issue).
## Week 1 — Retrospective
Mixed models in one loop drift. Sonnet 4.6 in one call and Haiku in the next will give different answers, and neither knows the other is less capable. There's no built-in compatibility layer — going to bite the moment I route across providers.
The "answered enough" decision is opaque. The model picks its own stopping point based on an inferred guess about how much detail I want — sometimes generous, sometimes truncated. I have no confident tuning lever yet, just hints (system prompt posture, tool descriptions, question framing).
Schemas are hints, not validators. extract_contact only worked because the messy text was actually pretty clean. On real unstructured input I'd get silent misclassification or <UNKNOWN> sentinels that downstream code can't interpret. The schema is a probabilistic suggestion — downstream code has to assume the contract can be violated.
The agent's stop boundary is an economics problem. Stop too early → user re-prompts → more cost. Stop too late → turns burned on noise. Right now my only lever is the user's prompt shape; that's not a principled control.


## Week 2 Fundamentals and Orchastration

## 01-chain.ts observations

- Billing & technical worked cleanly when the email matched the assumed single-frame shape. System prompt instructions ("never invent amounts/dates") successfully constrained model behaviour.
- Ambiguous email exposed the chain's structural weakness: classifier picked "other" because the bug report was wrapped in casual prose, and the chain has no way to recover from a misclassification at step 1.
- Two hallucinations across three runs: technical email fabricated "we pushed a deals content update yesterday"; ambiguous email confidently described a "share icon" that may not exist. Pure-prompt steps without grounding tools will hallucinate plausible-sounding context. Watch for this pattern in arvo audit.


## 02-router.ts observations

- Two prompt-level hallucinations from the chain disappeared with explicit "don't invent
  X" instructions in the topic-specific drafters. Single most useful intervention so far —
  *if uncertain, say "I'll confirm and follow up"* is a reusable pattern.
- Multi-label classification + parallel drafters + merger handled the multi-topic email
  the chain couldn't. Architecture matched input shape; output addressed all three issues.
- New failure modes from the router: verbosity inflation (over-formatted reply to casual
  email), aspirational subject lines (claims a "fix" was offered when only diagnostics were),
  and one residual hallucination about iOS settings (model's world-knowledge confabulation,
  not product-knowledge — prompt instruction can't fix this; tools can).
- Cost: router pays ~same as chain on single-topic emails, ~2x on multi-topic. Worth it
  depends on real input distribution. Senior decision = measure, don't guess.


## Week 2 — Retrospective

Architecture is action-space design. The agent stopped hallucinating not because it was smarter than the chain or router, but because `escalate_to_human` was a legal move — "I don't know" became cheaper than fabricating. Chain and router had no exit; their job was to produce a confident answer, so they did.

Cost curves matter more than absolute cost. Chain and router pay the same input tokens regardless of email difficulty; the agent's input scales with how much it had to investigate. Agent costs more on easy cases and less on impossible ones — that's the right shape for production.

Hallucinations split by architecture, not by model. Same Sonnet 4.6 across all three runs — chain hallucinated where forced confidence met no grounding; router hallucinated on world-knowledge confabulation that prompt instruction couldn't fix. Tools can.

Tool surface = quality ceiling. The agent escalated on the ambiguous email because its tools didn't cover feature-questions, not because the model couldn't reason. Same lesson as the HN scraper from week 1 — agent quality is bottlenecked by the toolbelt, not by cleverness inside the loop.

Architectures that include honest non-answers degrade gracefully; the ones that force a confident answer fail on the long tail. The senior decision isn't "which architecture is most sophisticated" — it's "which action space matches the input distribution".