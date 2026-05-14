# Week 2 — Chain, Router, Agent

## Section 1: When to use each

**Chain — Playwright test report generator.** Three deterministic steps, no decisions: (1) read the report type (Cucumber or Allure), (2) parse `results.json` into that schema, (3) render the HTML report with title, run metadata, and detailed per-test execution. The shape is fixed at design time — no input should change the order of steps. A router would be overkill; an agent would over-investigate. Pure transformation, single frame. arvo's `parseResponseNode` is the same shape.

**Router — arvo's `classifyQuerySmart`.** It reads the user's query and routes to Haiku for simple lookups ("show me deals near me") vs Sonnet for complex personalization ("I'm hosting a dinner party for 6 people on Friday"). The model picks the tier; deterministic code dispatches to the chosen model. Same router shape as the email triage in `02-router.ts`, just with different downstream branches.

**Agent — arvo's grocery scraper.** Today Playwright fetches Woolies cleanly, but Coles blocks bots. The path has to be decided at runtime — try Playwright first; if blocked, switch to ScraperAPI; if that hits a rate limit, fall back to a cached snapshot or skip this retailer. A chain can't do this because the path depends on what each tool returns. A router can't do this because the decision tree branches mid-run, not upfront. Textbook investigation shape — model picks the next tool based on what the last tool said.

## Section 2: Comparison from the three samples

### Calls per sample

| Sample | Chain | Router | Agent |
|---|---|---|---|
| billing (1 topic) | 3 (classify → draft → format) | 3 (classify + 1 drafter + merge) | ~3 turns (lookup_customer → check_billing_status → send_response) |
| technical (1 topic) | 3 | 3 | ~2 turns (check_app_version_status → send_response) |
| ambiguous (3 topics) | 3 | **5** (classify + 3 parallel drafters + merge) | ~2 turns (escalate_to_human → send_response) |

Chain is fixed-cost. Router scales linearly with topics found. Agent is the only one whose cost reflects *task difficulty* rather than *task shape*.

### Tokens per call (output caps from the code)

- **Chain** (01-chain.ts:31, 80, 102): 512 + 1024 + 1024 = **2,560 max output / sample**, flat.
- **Router** (02-router.ts:29, 76, 88, 102, 116, 139): 512 + N×(256–512) + 1024 → **~2,000 single-topic, ~3,000 multi-topic**.
- **Agent** (03-agent.ts:159): 2048 per turn, multi-turn. Input grows each turn because the full message history + tool defs (5 tools) is resent. So agent has the **highest per-call input cost** but the **lowest output waste** on easy/unanswerable cases (escalation is short).

The hidden cost the chain and router hide: input tokens are nearly identical across all three samples regardless of difficulty. The agent's input scales with how much it had to investigate — exactly the right cost curve.

### Hallucinations per architecture

- **Chain: 2 / 3 samples.** Fabricated "deals content update yesterday" (technical), invented "share icon" (ambiguous). Pure-prompt drafting with no grounding.
- **Router: 1 / 3 samples.** Residual iOS-settings hallucination (world-knowledge confabulation, not addressable by prompt). The "don't invent X" instruction killed the chain's two but not this one.
- **Agent: 0 / 3 samples.** Grounded billing in `check_billing_status`, technical in `check_app_version_status`, and on the ambiguous email it called `escalate_to_human` instead of inventing a share feature.

### Why the inversion of expectations matters

Chain and router hallucinated on the same ambiguous email — a "share a deal" feature that doesn't exist in the mock backend. Both architectures had no choice but to answer; their job is to *produce a response*, so the model fills the gap with plausible product behaviour.

The agent had `escalate_to_human` as a legal move. When its tools couldn't address "can I share a deal?", saying "I don't know" became cheaper than fabricating. That's not the agent being smarter — that's the **action space including "I don't know"**.

The rule the output validates: **architectures that force a confident answer will hallucinate on the long tail; architectures that include honest non-answers as a primitive will degrade gracefully.** Agents win not because they're more sophisticated but because their loop terminates only when the model decides — and you can give the model an exit that doesn't require making something up.

The corollary that bites in the other direction: on a closed-form single-topic email like billing or technical, the agent's investigation tokens are pure overhead vs. the chain. Right architecture = match the action space to the input distribution, not "pick the most sophisticated one."

## Section 3: The ambiguous email — which architecture handled it best?

No clean winner, and the discomfort is the lesson. The router produced the most polished text: structured headers, addressed all three topics, polite. But it lied — confidently described a "share icon" feature that doesn't exist. The agent produced the most honest response: refused to fabricate, escalated cleanly, asked for the app version it actually needed. But it left the customer with less concrete information and a ticket number instead of an answer. The chain produced the worst response by both standards — squashed three topics into one frame and still fabricated the share feature.

Which is "best" depends on what you optimise for. If the metric is customer satisfaction in the moment, router wins (people prefer confident answers, even partly wrong ones, over "we'll get back to you"). If the metric is trust over time and avoiding compound errors (a fabricated feature today is a complaint tomorrow), agent wins. Production systems often need both — agent-grounded answers where tools cover the task, router-style structured replies where they don't, with a clear escalation path when neither fits.

### Footnote: classification surface ≠ tool surface

The chain's classifier enum is `["billing", "technical", "other"]` (01-chain.ts:41) while the router's is `["billing", "technical", "feature_question", "feedback"]` (02-router.ts:42). The chain has no category for a feature question or feedback — part of why the ambiguous email got squashed into "other". The agent's tool surface is narrower still: no `lookup_feature` or `verify_recommendation`, which is why the ambiguous email forced escalation. With richer tools, the agent could have answered. Same principle as the HN scraper from week 1 — **tool design determines agent quality**, more than agent cleverness does.


### Week2 Polished
# Week 2 — Chain vs Router vs Agent

Three reference implementations of the same task (customer support email triage), built as a chain, a router, and an agent. Same model (Sonnet 4.6), same three sample emails (billing, technical, ambiguous), three architectural shapes. The contrast is the point.

## Section 1 — When to use each

**Chain — fixed pipeline, single frame, zero ambiguity.**
Example: a Playwright test report generator. Read the report type (Cucumber or Allure), parse `results.json` into the matching schema, format an HTML report with title and detailed test list. Three sequential transformations, no branching, no decision-making. Cost is predictable, output is predictable, debugging is straightforward. Arvo's `parseResponseNode` is shaped this way — pure transformation, no choice.

**Router — model classifies, code dispatches.**
Example: Arvo's `classifyQuerySmart` routes incoming queries to a model tier based on complexity. Simple lookups ("show me deals near me") go to Haiku for cost; complex personalisation ("planning a dinner party for 6 on Friday") goes to Sonnet for quality. The model picks the tier from a fixed set; deterministic code dispatches. Same shape as the email triage in `02-router.ts` — a multi-label classifier followed by topic-specific drafters and a merge step.

**Agent — path decided at runtime by the model.**
Example: Arvo's grocery scraper. Playwright fetches Woolworths cleanly, but Coles blocks bots. The path needs to be decided at runtime — try Playwright first, if blocked switch to ScraperAPI, if that hits a rate limit fall back to a cached snapshot or skip the retailer entirely. A chain can't do this because the path depends on what each tool returns; a router can't do this because the decision tree branches mid-run, not upfront. Classic investigation shape — the model picks the next tool based on what the last tool said.

## Section 2 — What I measured

**Calls per sample**

| Sample | Chain | Router | Agent |
|---|---|---|---|
| Billing (1 topic) | 3 | 3 | 3 turns |
| Technical (1 topic) | 3 | 3 | 2 turns |
| Ambiguous (3 topics) | 3 | 5 | 2 turns |

Chain is fixed-cost. Router scales linearly with topics found (1 classifier + N drafters + 1 merge). Agent is the only one whose cost reflects task difficulty rather than task shape.

**Output token caps from the code**

- Chain: 512 + 1024 + 1024 = 2,560 max output / sample, flat.
- Router: 512 + N×(256–512) + 1024. ~2,000 single-topic, ~3,000 multi-topic.
- Agent: 2,048 per turn, multi-turn. Input tokens grow each turn because the full message history + tool defs (~5 tools) is resent. So agent has the highest per-call input cost but the lowest output waste on easy or unanswerable cases (escalation is short).

**The hidden cost shape:** Chain and router pay nearly identical input tokens across all three samples regardless of difficulty. The agent's input scales with how much it had to investigate — exactly the right cost curve for production.

**Hallucinations per architecture**

- Chain: 2 / 3 samples. Fabricated "deals content update yesterday" (technical). Invented "share icon" feature (ambiguous). Pure-prompt drafting with no grounding.
- Router: 1 / 3 samples. Residual iOS settings confabulation (world knowledge, not addressable by prompt instruction). The "don't invent X" instruction killed the chain's two but not this one.
- Agent: 0 / 3 samples. Grounded billing answer in `check_billing_status`, technical in `check_app_version_status`. On the ambiguous email, called `escalate_to_human` instead of fabricating a "share" feature.

**Why this inverts the usual expectation:** Chain and router hallucinated on the same ambiguous email — a "share a deal" feature that doesn't exist in the mock backend. Both had to produce a response, so the model filled the gap with plausible product behaviour. The agent had `escalate_to_human` as a legal move. When its tools couldn't address "can I share a deal?", saying "I don't know" became cheaper than fabricating. That's not the agent being smarter — that's the action space including 'I don't know'.

**The general rule:** Architectures that force a confident answer will hallucinate on the long tail. Architectures that include honest non-answers as a primitive will degrade gracefully. Agents win not because they're more sophisticated but because their loop terminates only when the model decides — and you can give the model an exit that doesn't require making something up.

## Section 3 — The ambiguous email — which architecture handled it best?

No clean winner, and the discomfort is the lesson. The router produced the most polished text: structured headers, addressed all three topics, polite. But it lied — confidently described a "share icon" feature that doesn't exist. The agent produced the most honest response: refused to fabricate, escalated cleanly, asked for the app version it actually needed. But it left the customer with less concrete information and a ticket number instead of an answer. The chain produced the worst response by both standards — squashed three topics into one frame and still fabricated the share feature.

Which is "best" depends on what you optimise for. If the metric is customer satisfaction in the moment, router wins — people prefer confident answers, even partly wrong ones, over "we'll get back to you." If the metric is trust over time and avoiding compound errors — a fabricated feature today is a complaint tomorrow — agent wins. Production systems often need both: agent-grounded answers where tools cover the task, router-style structured replies where they don't, with a clear escalation path when neither fits.

The senior decision isn't "which architecture is most sophisticated" — it's "which action space matches the input distribution."