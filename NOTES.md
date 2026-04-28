Remove the tool_choice line (delete tool_choice: { type: "tool", name: "extract_contact" },). Re-run. Did Claude still call the tool, or did it respond in plain text?  --> No chnage still I got same response
Delete the phone line from messyText ("she mentioned her mobile is 0412 555 889"). Keep tool_choice in. Re-run. What does the phone field contain in the output? --> No phone field
Add "phone" to the required array, then keep the phone line deleted. Re-run. Does Claude hallucinate a phone number, return empty, or error? --> "phone": "<UNKNOWN>",
## 03 — Structured output

Experiments:
- **Removed tool_choice:** still called the tool. With one tool + obvious match, auto works. Force in production anyway — auto isn't guaranteed across inputs and model versions.
- **Phone optional, deleted from input:** field omitted from JSON entirely. Downstream code must use optional chaining.
- **Phone required, deleted from input:** Claude returned `"phone": "<UNKNOWN>"`. Better than hallucinating a number, but still violates the schema's implicit "this is a phone number" contract. Lesson: don't mark fields required if source data may not contain them. Design schemas to handle absence explicitly (empty string sentinel + clear description).