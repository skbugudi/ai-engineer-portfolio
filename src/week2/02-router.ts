import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";

const client = new Anthropic();
const MODEL = "claude-sonnet-4-6";

// ─── The same task, with a router ───────────────────────────────────────────
// Difference from the chain: classify can return MULTIPLE topics. Code (not
// the model) dispatches each topic to a topic-specific drafter, then merges.
//
// The model picks; deterministic code dispatches and combines.

type Topic = "billing" | "technical" | "feature_question" | "feedback";

interface Classification {
  topics: Topic[];
  reasoning: string;
}

interface TopicDraft {
  topic: Topic;
  content: string;
}

// ─── Step 1: Multi-label classification ─────────────────────────────────────
async function classify(email: string): Promise<Classification> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    tools: [
      {
        name: "classify_email",
        description:
          "Identify ALL topics present in this customer email. An email may contain multiple topics; return every one that applies. Be inclusive — better to over-classify than miss a topic.",
        input_schema: {
          type: "object",
          properties: {
            topics: {
              type: "array",
              items: {
                type: "string",
                enum: ["billing", "technical", "feature_question", "feedback"],
              },
              minItems: 1,
              description:
                "All topics present. billing = charges/refunds. technical = bugs/crashes/wrong-behaviour. feature_question = how-do-I or does-X-exist. feedback = praise or general comments.",
            },
            reasoning: {
              type: "string",
              description:
                "One sentence per identified topic explaining why it was flagged.",
            },
          },
          required: ["topics", "reasoning"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "classify_email" },
    messages: [{ role: "user", content: email }],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
  );
  if (!toolUse) throw new Error("classify: expected tool_use");
  return toolUse.input as Classification;
}

// ─── Step 2: Topic-specific drafters (one per topic) ────────────────────────
const drafters: Record<Topic, (email: string) => Promise<string>> = {
  billing: async (email) => {
    const r = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      system:
        "You are a billing specialist. Address ONLY the billing aspect of this email. Be precise about charges, refunds, and account states. Never invent specific amounts or dates. Keep it concise — 3-5 sentences.",
      messages: [{ role: "user", content: email }],
    });
    return r.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  },

  technical: async (email) => {
    const r = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      system:
        "You are a technical support engineer. Address ONLY the technical aspect of this email. Diagnose likely causes, ask for the most useful piece of missing information, and suggest one concrete next step. Never invent product details, deployments, or features that aren't mentioned by the user. Keep it concise — 3-5 sentences.",
      messages: [{ role: "user", content: email }],
    });
    return r.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  },

  feature_question: async (email) => {
    const r = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      system:
        "You are a product specialist. Address ONLY the feature/how-to question in this email. CRITICAL: do not describe features unless explicitly mentioned by the user. If you don't know whether a feature exists, say 'I'll confirm with the product team and follow up.' Keep it concise — 2-4 sentences.",
      messages: [{ role: "user", content: email }],
    });
    return r.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  },

  feedback: async (email) => {
    const r = await client.messages.create({
      model: MODEL,
      max_tokens: 256,
      system:
        "You are a customer support generalist. Briefly acknowledge the user's feedback warmly. 1-2 sentences only. Do not address other parts of the email.",
      messages: [{ role: "user", content: email }],
    });
    return r.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  },
};

// ─── Step 3: Merge drafts ───────────────────────────────────────────────────
async function merge(
  email: string,
  drafts: TopicDraft[]
): Promise<{ subject: string; body: string }> {
  const draftsText = drafts
    .map((d) => `[${d.topic.toUpperCase()}]\n${d.content}`)
    .join("\n\n");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: [
      {
        name: "merge_response",
        description:
          "Merge topic-specific drafts into a single coherent customer email.",
        input_schema: {
          type: "object",
          properties: {
            subject: {
              type: "string",
              description:
                "Concise subject line, max 60 chars, covering the primary topic. If multiple topics, lead with the most urgent.",
            },
            body: {
              type: "string",
              description:
                "Full email body. Start with 'Hi there,', end with 'Best regards,\\nSupport Team'. Address feedback briefly first if present, then substantive issues. Preserve the content of each draft. Do not invent new information.",
            },
          },
          required: ["subject", "body"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "merge_response" },
    messages: [
      {
        role: "user",
        content: `Original email:\n\n${email}\n\nTopic-specific drafts to merge:\n\n${draftsText}`,
      },
    ],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
  );
  if (!toolUse) throw new Error("merge: expected tool_use");
  return toolUse.input as { subject: string; body: string };
}

// ─── The router ─────────────────────────────────────────────────────────────
async function runRouter(email: string) {
  console.log("→ Step 1: classify (multi-label)");
  const classification = await classify(email);
  console.log(`  → topics: [${classification.topics.join(", ")}]`);
  console.log(`  → reasoning: ${classification.reasoning}`);

  console.log(
    `→ Step 2: dispatch to ${classification.topics.length} drafter(s) in parallel`
  );
  const drafts: TopicDraft[] = await Promise.all(
    classification.topics.map(async (topic) => ({
      topic,
      content: await drafters[topic](email),
    }))
  );
  drafts.forEach((d) =>
    console.log(`  → [${d.topic}] ${d.content.length} chars`)
  );

  console.log("→ Step 3: merge");
  const merged = await merge(email, drafts);
  console.log(`  → "${merged.subject}"`);

  return merged;
}

// ─── Same samples as the chain — direct comparison ──────────────────────────
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
    const result = await runRouter(email);
    console.log(`\nSubject: ${result.subject}`);
    console.log(`Body:\n${result.body}`);
    console.log("---");
  }
}

main();