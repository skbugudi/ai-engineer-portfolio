import Anthropic from "@anthropic-ai/sdk";
import { chromium, type Browser, type Page } from "playwright";
import "dotenv/config";

const client = new Anthropic();
const SYSTEM_PROMPT =
  "You are a browser agent. Use navigate, click, get_page_url, and get_page_text to answer user questions. Be concise. To follow a link, use click with the link's visible text.";

// ─── Tool definitions ───────────────────────────────────────────────────────
const tools: Anthropic.Tool[] = [
  {
    name: "navigate",
    description:
      "Navigate the browser to a URL. Returns confirmation when the page has loaded.",
    input_schema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The full URL to navigate to, including https://",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "get_page_url",
    description:
      "Get the URL of the currently loaded page. Use this after navigating to read what's on the page and clicking a link.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_page_text",
    description:
      "Get the visible text content of the currently loaded page. Use this after navigating to read what's on the page.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
  name: "click",
  description:
    "Click on an element on the current page. Provide a CSS selector or visible text to match. After clicking, the page may navigate or update. Use get_page_url and get_page_text afterward to see the result.",
  input_schema: {
    type: "object",
    properties: {
      selector: {
        type: "string",
        description:
          "Either a CSS selector (e.g. 'a.storylink') or text content to match (e.g. 'Sign in'). Prefer text matching when possible.",
      },
    },
    required: ["selector"],
  },
},
];

// ─── Tool implementations ───────────────────────────────────────────────────
async function navigate(page: Page, url: string): Promise<string> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return `Successfully navigated to ${url}. Page title: "${await page.title()}"`;
}

async function getPageText(page: Page): Promise<string> {
  // Get visible text + a list of all links with their destinations
  const { text, links } = await page.evaluate(() => {
    const text = document.body.innerText;
    const links = Array.from(document.querySelectorAll("a"))
      .map((a) => ({
        text: a.innerText.trim(),
        href: (a as HTMLAnchorElement).href,
      }))
      .filter((l) => l.text.length > 0);
    return { text, links };
  });

  const MAX = 6000;
  const truncatedText =
    text.length > MAX ? text.slice(0, MAX) + "\n[... truncated]" : text;

  const linksFormatted = links
    .slice(0, 50) // cap to top 50 links to control token use
    .map((l) => `- "${l.text}" → ${l.href}`)
    .join("\n");

  return `PAGE TEXT:\n${truncatedText}\n\nLINKS ON PAGE:\n${linksFormatted}`;
}

async function getCurrentUrl(page: Page): Promise<string> {
  return page.url();
}

async function click(page: Page, selector: string): Promise<string> {
  // Try CSS selector first; if it fails, try text matching
  try {
    await page.click(selector, { timeout: 3000 });
  } catch {
    try {
      await page.getByText(selector, { exact: false }).first().click({ timeout: 3000 });
    } catch (err) {
      return `Click failed: could not find element matching "${selector}". ${(err as Error).message}`;
    }
  }
  // Wait for any navigation or DOM update
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  return `Clicked "${selector}". Current URL: ${page.url()}`;
}

// ─── Agent loop ─────────────────────────────────────────────────────────────
async function runAgent(userQuestion: string, page: Page): Promise<void> {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userQuestion },
  ];

  let response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    tools,
    messages,
    system: SYSTEM_PROMPT,
  });

  let turn = 1;
  while (response.stop_reason === "tool_use") {
    console.log(`\n--- Turn ${turn}: model requested tool(s) ---`);

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    const toolResults = await Promise.all(
      toolUseBlocks.map(async (block) => {
        console.log(`  → ${block.name}(${JSON.stringify(block.input)})`);
        let result: string;
        try {
          if (block.name === "navigate") {
            result = await navigate(page, (block.input as { url: string }).url);
          } else if (block.name === "get_page_text") {
            result = await getPageText(page);
            } else if (block.name === "get_page_url") {
            result = await getCurrentUrl(page);
          } else if (block.name === "click") {
            result = await click(page, (block.input as { selector: string }).selector);
            } 
          else {
            result = `Unknown tool: ${block.name}`;
          } 
        } catch (err) {
          result = `Tool error: ${(err as Error).message}`;
        }
        return {
          type: "tool_result" as const,
          tool_use_id: block.id,
          content: result,
        };
      })
    );

    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: toolResults });

    response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      tools,
      messages,
      system: SYSTEM_PROMPT,
    });
    turn++;
  }

  // Final answer
  const finalText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  console.log("\n=== Final answer ===");
  console.log(finalText);
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const browser: Browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await runAgent(
      "Go to https://news.ycombinator.com, then click on the first three story titles one at a time, reporting the destination URL of each. Return to the HN front page between clicks if needed (the back button isn't available, so re-navigate).",
      page
    );
  } finally {
    await browser.close();
  }
}

main();