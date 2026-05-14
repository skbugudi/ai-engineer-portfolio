import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";

const client = new Anthropic();

// Two test inputs — one rich, one sparse — so you can see how the model
// flags missing data differently in each case.
const richText = `
Hey team, just got off a call with Sarah Chen from Brighte — her email is
sarah.chen@brighte.com.au and she mentioned her mobile is 0412 555 889.
She's keen to chat about the AI engineer role next Tuesday. Her LinkedIn
is linkedin.com/in/sarahchen-brighte. Based in Sydney office.
`;

const sparseText = `
Got an email from someone called Mike at Atlassian today.
He's interested in the role.
`;

const tools: Anthropic.Tool[] = [
  {
    name: "extract_contact",
    description: "Extract structured contact information from unstructured text.",
    input_schema: {
      type: "object",
      properties: {
        full_name: {
          type: "string",
          description: "Person's full name. Use empty string if only first name or unknown.",
        },
        email: {
          type: "string",
          description: "Email address, lowercase. Use empty string if not present.",
        },
        phone: {
          type: "string",
          description: "Phone in E.164 format, e.g. +61412555889. Use empty string if not present.",
        },
        company: {
          type: "string",
          description: "Company name. Use empty string if not present.",
        },
        linkedin_url: {
          type: "string",
          description: "Full https:// URL. Use empty string if not present.",
        },
        location: {
          type: "string",
          description: "City or office location. Use empty string if not present.",
        },

        // ─── NEW: confidence score ────────────────────────────────────────
        extraction_confidence: {
          type: "number",
          description:
            "Your confidence in this extraction, from 0.0 (pure guess) to 1.0 (explicitly stated in source). Consider how much of the requested data was actually present in the input.",
        },

        // ─── NEW: missing fields list ─────────────────────────────────────
        missing_fields: {
          type: "array",
          items: { type: "string" },
          description:
            "Field names that were not found in the input text. Use the exact property names from this schema (e.g. 'phone', 'linkedin_url'). Empty array if everything was found.",
        },

        // ─── NEW: notes for human review ──────────────────────────────────
        extraction_notes: {
          type: "string",
          description:
            "Brief notes on any ambiguity, assumptions made, or partial data. Empty string if extraction was clean.",
        },
      },
      required: [
        "full_name",
        "email",
        "phone",
        "company",
        "linkedin_url",
        "location",
        "extraction_confidence",
        "missing_fields",
        "extraction_notes",
      ],
    },
  },
];

interface ExtractedContact {
  full_name: string;
  email: string;
  phone: string;
  company: string;
  linkedin_url: string;
  location: string;
  extraction_confidence: number;
  missing_fields: string[];
  extraction_notes: string;
}

async function extract(text: string, label: string): Promise<ExtractedContact> {
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    tools,
    tool_choice: { type: "tool", name: "extract_contact" },
    messages: [{ role: "user", content: text }],
  });
  console.log(`\n=== Raw model response for ${label} ===`);
  console.log(JSON.stringify(response.content, null, 2));
  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
  );
  if (!toolUse) throw new Error("Expected a tool_use block");

  const contact = toolUse.input as ExtractedContact;

  console.log(`\n=== Extraction Result (${JSON.stringify(contact)}) ===`);

  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(contact, null, 2));

  // Production-style routing based on confidence
  if (contact.extraction_confidence < 0.6) {
    console.log(
      `⚠️  LOW CONFIDENCE (${contact.extraction_confidence}) — would route to human review queue`
    );
  } else if (contact.missing_fields.length > 0) {
    console.log(
      `ℹ️  Partial data — missing: [${contact.missing_fields.join(", ")}]`
    );
  } else {
    console.log("✅ Clean extraction — safe to auto-process");
  }

  return contact;
}

async function run() {
  await extract(richText, "Rich input (Sarah Chen)");
  await extract(sparseText, "Sparse input (Mike at Atlassian)");
}

run();