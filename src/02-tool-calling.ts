import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";

const client = new Anthropic();

const tools: Anthropic.Tool[] = [
  {
    name: "get_weather",
    description: "Get the current weather for a given city.",
    input_schema: {
      type: "object",
      properties: {
        city: { type: "string", description: "The city name, e.g. Sydney" },
      },
      required: ["city"],
    },
  },
  {
    name: "get_news_headlines",
    description: "Get the latest news headlines.",
    input_schema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "The news category, e.g. technology, sports, etc.",
        },
      },
      required: ["category"],
    },
  }
];

// Fake tool implementation
function getWeather(city: string): string {
  return `The weather in ${city} is 22°C and sunny.`;
}

// Another fake tool implementation
function getNewsHeadlines(category: string): string {
  return `The latest ${category} news headlines are: ...`;
}

async function run() {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: "What's the weather in Sydney right now?" },
    { role: "user", content: "Also, what's the latest technology news?" },
  ];

  // First call — model should request the tool
  let response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    tools,
    messages,
  });

  console.log("Stop reason:", response.stop_reason);
  console.log("Content:", JSON.stringify(response.content, null, 2));

  // Loop until the model is done calling tools
  while (response.stop_reason === "tool_use") {
  const toolUseBlocks = response.content.filter(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );

  // Execute every tool the model requested
  const toolResults = toolUseBlocks.map((block) => {
    let result: string;
    if (block.name === "get_weather") {
      result = getWeather((block.input as { city: string }).city);
    } else if (block.name === "get_news_headlines") {
      result = getNewsHeadlines((block.input as { category: string }).category);
    } else {
      result = `Unknown tool: ${block.name}`;
    }
    return {
      type: "tool_result" as const,
      tool_use_id: block.id,
      content: result,
    };
  });

    // Add all tool results in a single user message
    messages.push({ role: "assistant", content: response.content });
    messages.push({
      role: "user",
      content: toolResults,
    });
    response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      tools,
      messages,
    });

    console.log("\nNext response:", JSON.stringify(response.content, null, 2));
  }

  console.log("\nFinal stop reason:", response.stop_reason);
}

run();