import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";

const client = new Anthropic();

const messyText = `
Hey team, just got off a call with Sarah Chen from Brighte — her email is
sarah.chen@brighte.com.au and 
She's keen to chat about the AI engineer role next Tuesday. Her LinkedIn
is linkedin.com/in/sarahchen-brighte. Based in Sydney office.
`;

const tools: Anthropic.Tool[] = [
  {
    name: "extract_contact",
    description: "Extract structured contact information from unstructured text.",
    input_schema: {
      type: "object",
      properties: {
        full_name: { type: "string", description: "Person's full name" },
        email: { type: "string", description: "Email address, lowercase" },
        phone: {
          type: "string",
          description: "Phone number in E.164 format, Use empty string if not present in input",
        },
        company: { type: "string" },
        linkedin_url: {
          type: "string",
          description: "Full https:// URL, or empty string if not present",
        },
        location: { type: "string" },
      },
      required: ["full_name", "email"],
    },
  },
];

async function run() {
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    tools,
    tool_choice: { type: "tool", name: "extract_contact" },
    messages: [{ role: "user", content: messyText }],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
  );
  if (!toolUse) throw new Error("Expected a tool_use block");

  const contact = toolUse.input;
  console.log("Extracted contact:");
  console.log(JSON.stringify(contact, null, 2));

  console.log("\nType check:", typeof contact);
  console.log("Email domain:", (contact as any).email?.split("@")[1]);
}

run();