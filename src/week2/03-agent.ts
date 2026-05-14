import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";

const client = new Anthropic();
const MODEL = "claude-sonnet-4-6";

// ─── The same task, with an agent ───────────────────────────────────────────
// Difference from the chain/router: the model decides which tools to call,
// in what order, and when to stop. Path is decided at runtime.
//
// Tools: lookup_customer, check_billing_status, check_app_version_status,
// escalate_to_human, send_response.
//
// The agent succeeds when the task genuinely benefits from investigation;
// fails (over-investigates, wastes tokens) when the task is closed-form.

// ─── Mock backend (realistic enough to drive interesting decisions) ─────────
const mockCustomers: Record<string, any> = {
    "shanth@example.com": {
        name: "Shanth",
        plan: "Premium",
        last_charged: "2026-05-01",
        charges_this_month: [
            { amount: 79, date: "2026-05-01", order_ref: "A8821" },
            { amount: 79, date: "2026-05-01", order_ref: "A8821-DUP" },
        ],
    },
};

const mockAppStatus = {
    current_version: "2.1.5",
    known_issues_2_1_4: ["deals_tab_crash_on_ios_17_2"],
    fix_available_in: "2.1.5",
};

// ─── Tool definitions ───────────────────────────────────────────────────────
const tools: Anthropic.Tool[] = [
    {
        name: "lookup_customer",
        description:
            "Look up a customer record by email. Returns name, plan, last charged date, and recent charges. Use when the email is about an account-specific issue.",
        input_schema: {
            type: "object",
            properties: {
                email: { type: "string", description: "Customer email address" },
            },
            required: ["email"],
        },
    },
    {
        name: "check_billing_status",
        description:
            "Check whether a charge or charges look like a duplicate. Provide order reference. Returns confirmed_duplicate boolean and details. Use only after lookup_customer if the issue is billing.",
        input_schema: {
            type: "object",
            properties: {
                email: { type: "string" },
                order_ref: { type: "string" },
            },
            required: ["email", "order_ref"],
        },
    },
    {
        name: "check_app_version_status",
        description:
            "Check whether a reported issue is a known bug in a specific app version. Returns whether a fix is available.",
        input_schema: {
            type: "object",
            properties: {
                version: { type: "string", description: "App version, e.g. 2.1.4" },
                symptom: {
                    type: "string",
                    description: "Brief description of the symptom",
                },
            },
            required: ["version", "symptom"],
        },
    },
    {
        name: "escalate_to_human",
        description:
            "Escalate to a human support agent when you cannot confidently resolve the issue with available tools.",
        input_schema: {
            type: "object",
            properties: {
                reason: { type: "string", description: "Why this needs a human" },
            },
            required: ["reason"],
        },
    },
    {
        name: "send_response",
        description:
            "Send the final response to the customer. Call this when you have enough information to respond, OR when the issue requires escalation. This ends the agent loop.",
        input_schema: {
            type: "object",
            properties: {
                subject: { type: "string", description: "Email subject, max 60 chars" },
                body: {
                    type: "string",
                    description:
                        "Full email body. Start with 'Hi there,', end with 'Best regards,\\nSupport Team'. Ground every claim in tool results — do not invent details.",
                },
            },
            required: ["subject", "body"],
        },
    },
];

// ─── Tool implementations ───────────────────────────────────────────────────
function lookupCustomer(email: string): string {
    const c = mockCustomers[email];
    if (!c) return JSON.stringify({ found: false });
    return JSON.stringify({ found: true, ...c });
}

function checkBillingStatus(email: string, orderRef: string): string {
    const c = mockCustomers[email];
    if (!c) return JSON.stringify({ error: "customer not found" });
    const matching = c.charges_this_month.filter((ch: any) =>
        ch.order_ref.startsWith(orderRef)
    );
    return JSON.stringify({
        confirmed_duplicate: matching.length > 1,
        charges: matching,
    });
}

function checkAppVersionStatus(version: string, symptom: string): string {
    const knownIssue = mockAppStatus.known_issues_2_1_4.some((issue) =>
        symptom.toLowerCase().includes(issue.split("_").slice(0, 2).join(" "))
    );
    return JSON.stringify({
        your_version: version,
        current_version: mockAppStatus.current_version,
        is_known_issue: version === "2.1.4" && knownIssue,
        fix_available_in: knownIssue ? mockAppStatus.fix_available_in : null,
    });
}

// ─── Agent loop ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a customer support agent with access to backend tools.

Investigate the customer's issue using your tools, then send a single response via send_response.

Rules:
- Ground every claim in tool results. Do not invent customer details, app deployments, features, or product behaviour.
- If you don't have a tool that resolves the issue, escalate via escalate_to_human and then send_response.
- Be concise. Match the tone of the customer's email.
- Stop investigating as soon as you have enough to respond. Do not over-investigate.`;

async function runAgent(email: string): Promise<{ subject: string; body: string }> {
    const messages: Anthropic.MessageParam[] = [
        { role: "user", content: email },
    ];

    let response = await client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        tools,
        messages,
    });

    let turn = 1;
    let finalResponse: { subject: string; body: string } | null = null;

    while (response.stop_reason === "tool_use") {
        console.log(`→ Turn ${turn}: ${response.stop_reason}`);

        const toolUseBlocks = response.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
        );

        const toolResults = toolUseBlocks.map((block) => {
            console.log(`  → ${block.name}(${JSON.stringify(block.input)})`);
            let result: string;
            try {
                if (block.name === "lookup_customer") {
                    result = lookupCustomer((block.input as { email: string }).email);
                } else if (block.name === "check_billing_status") {
                    const i = block.input as { email: string; order_ref: string };
                    result = checkBillingStatus(i.email, i.order_ref);
                } else if (block.name === "check_app_version_status") {
                    const i = block.input as { version: string; symptom: string };
                    result = checkAppVersionStatus(i.version, i.symptom);
                } else if (block.name === "escalate_to_human") {
                    result = JSON.stringify({
                        escalated: true,
                        ticket: `T-${Math.floor(Math.random() * 10000)}`,
                    });
                } else if (block.name === "send_response") {
                    finalResponse = block.input as { subject: string; body: string };
                    result = JSON.stringify({ sent: true });
                } else {
                    result = JSON.stringify({ error: "unknown tool" });
                }
            } catch (err) {
                result = JSON.stringify({ error: (err as Error).message });
            }
            console.log(`    result: ${result.slice(0, 120)}${result.length > 120 ? "..." : ""}`);
            return {
                type: "tool_result" as const,
                tool_use_id: block.id,
                content: result,
            };
        });

        messages.push({ role: "assistant", content: response.content });
        messages.push({ role: "user", content: toolResults });

        if (finalResponse) break; // send_response was called — done

        response = await client.messages.create({
            model: MODEL,
            max_tokens: 2048,
            system: SYSTEM_PROMPT,
            tools,
            messages,
        });
        turn++;
    }

    if (!finalResponse) {
        throw new Error(
            `Agent ended without send_response. stop_reason: ${response.stop_reason}`
        );
    }
    return finalResponse;
}

// ─── Same samples ───────────────────────────────────────────────────────────
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
        const result = await runAgent(email);
        console.log(`\nSubject: ${result.subject}`);
        console.log(`Body:\n${result.body}`);
        console.log("---");
    }
}

main();