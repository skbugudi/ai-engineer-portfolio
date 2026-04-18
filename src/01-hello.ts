import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";

async function main() {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    messages: [{ role: "user", content: "Say hi in one sentence." }],
  });

  console.log(response.content);
}

main();