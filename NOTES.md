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