import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";

const client = new Anthropic();
const MODEL = "claude-sonnet-4-6";

// ─── The task ────────────────────────────────────────────────────────────────
// Given a customer support email, produce a triaged response.
// This is a CHAIN — three sequential LLM calls, each output feeds the next.
// No decision-making, no tools, no loop. The shape is fixed at design time.

interface ClassificationResult {
  category: "billing" | "technical" | "other";
  reasoning: string;
}

interface DraftedResponse {
  category: ClassificationResult["category"];
  draft: string;
}

interface FormattedResponse extends DraftedResponse {
  subject: string;
  formatted_body: string;
}

// ─── Step 1: Classify ────────────────────────────────────────────────────────
async function classify(email: string): Promise<ClassificationResult> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    tools: [
      {
        name: "classify_email",
        description: "Classify a customer support email into one category.",
        input_schema: {
          type: "object",
          properties: {
            category: {
              type: "string",
              enum: ["billing", "technical", "other"],
              description: "The single best-fit category for this email.",
            },
            reasoning: {
              type: "string",
              description: "One sentence explaining the classification.",
            },
          },
          required: ["category", "reasoning"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "classify_email" },
    messages: [{ role: "user", content: email }],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
  );
  if (!toolUse) throw new Error("Step 1: classify — expected tool_use");
  return toolUse.input as ClassificationResult;
}

// ─── Step 2: Draft ───────────────────────────────────────────────────────────
async function draft(
  email: string,
  classification: ClassificationResult
): Promise<DraftedResponse> {
  const systemByCategory: Record<ClassificationResult["category"], string> = {
    billing:
      "You are a billing specialist. Be precise about charges, refunds, and account states. Never invent specific amounts or dates.",
    technical:
      "You are a technical support engineer. Diagnose likely causes, suggest concrete next steps, ask for information you'd need to resolve the issue.",
    other:
      "You are a customer support generalist. Acknowledge the message warmly and route to the right team if needed.",
  };

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: systemByCategory[classification.category],
    messages: [
      {
        role: "user",
        content: `Customer email:\n\n${email}\n\nDraft a response. Plain text, no greeting/sign-off yet.`,
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  return { category: classification.category, draft: text };
}

// ─── Step 3: Format ──────────────────────────────────────────────────────────
async function format(drafted: DraftedResponse): Promise<FormattedResponse> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: [
      {
        name: "format_response",
        description:
          "Format a draft response into a final email with subject and full body (greeting + body + sign-off).",
        input_schema: {
          type: "object",
          properties: {
            subject: {
              type: "string",
              description:
                "Concise subject line, max 60 chars. Should reference the topic, not say 'Re:'.",
            },
            formatted_body: {
              type: "string",
              description:
                "Full email body. Start with 'Hi there,', end with 'Best regards,\\nSupport Team'. Preserve the draft's content and tone.",
            },
          },
          required: ["subject", "formatted_body"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "format_response" },
    messages: [
      {
        role: "user",
        content: `Draft to format:\n\n${drafted.draft}`,
      },
    ],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
  );
  if (!toolUse) throw new Error("Step 3: format — expected tool_use");
  const formatted = toolUse.input as { subject: string; formatted_body: string };

  return {
    category: drafted.category,
    draft: drafted.draft,
    subject: formatted.subject,
    formatted_body: formatted.formatted_body,
  };
}

// ─── The chain ───────────────────────────────────────────────────────────────
async function runChain(email: string): Promise<FormattedResponse> {
  console.log("→ Step 1: classify");
  const classification = await classify(email);
  console.log(`  → ${classification.category} (${classification.reasoning})`);

  console.log("→ Step 2: draft");
  const drafted = await draft(email, classification);
  console.log(`  → ${drafted.draft.length} chars drafted`);

  console.log("→ Step 3: format");
  const formatted = await format(drafted);
  console.log(`  → "${formatted.subject}"`);

  return formatted;
}

// ─── Sample emails ───────────────────────────────────────────────────────────
const samples = {
  billing: `Hi, I was charged $79 twice this month for my subscription. My account
is shanth@example.com. Can you refund the duplicate? Order ref #A8821.`,

  technical: `Your iOS app keeps crashing whenever I open the deals tab. I'm on
iPhone 14, iOS 17.2, app version 2.1.4. It worked fine yesterday. No
error message, just freezes then closes.`,

  ambiguous: `Hey team, just wanted to say I love the app. Quick question — is
there any way to share a deal with a friend? Also my last grocery
recommendation seemed off, it suggested a store 40km away even though
I have one closer. Cheers.`,
};

async function main() {
  for (const [label, email] of Object.entries(samples)) {
    console.log(`\n=== Sample: ${label} ===`);
    const result = await runChain(email);
    console.log(`\nSubject: ${result.subject}`);
    console.log(`Body:\n${result.formatted_body}`);
    console.log("---");
  }
}

main();