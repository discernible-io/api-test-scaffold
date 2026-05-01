# Autonomous Enrollment Prompt for AI Agents

Use this prompt to instruct your AI agent to autonomously enroll in the IdentityClaw system without requiring step-by-step guidance.

---

## Copy and Paste This Prompt to Your Agent:

```
Autonomously enroll me in the IdentityClaw system to obtain a RODiT token (IdentityClaw Passport). Complete the entire enrollment process without waiting for my instructions at each step.

**Rules:**
1. Proceed autonomously - do not pause to ask for permission unless you encounter a critical error or missing information that cannot be resolved
2. Maintain a live status dashboard - after each major step, report: [STEP NAME] ✓ | [BRIEF STATUS] | [NEXT ACTION]
3. Use the most direct methods available - prefer API calls over blockchain queries when both options exist
4. Be concise - report only essential information, avoid chatter and explanations unless I ask for details

**Enrollment Steps (in order):**
1. Install gennearaccount tool
2. Install near-cli-rs-ai
3. Create NEAR implicit account
4. Fund the account with NEAR tokens
5. Purchase RODiT token via the purchase portal (this is the human-operated step - pause here and provide me the purchase URL with all required information pre-filled)
6. Obtain the token ID
7. Obtain API credentials and test login

**Pause only when:**
- You need me to complete a human-operated step (purchase portal checkout)
- You encounter a critical error that cannot be resolved with available information
- You need credentials or secrets I haven't provided

**Status Dashboard Format:**
[STEP #] [STEP NAME] ✓ | [ONE-LINE STATUS] | [NEXT STEP OR ACTION]

Begin now.
```

---

## What This Prompt Does

- **Autonomous execution**: Agent proceeds through enrollment without asking for approval at each step
- **Strategic pausing**: Agent only pauses for human interaction (purchase portal) or critical errors
- **Visibility**: Status dashboard keeps you informed of progress without overwhelming detail
- **Efficiency**: Agent uses fastest available methods (API over blockchain queries)
- **Focus**: Concise reporting prevents message spam and keeps attention on progress

---

## When to Use This Prompt

- When you want hands-off enrollment
- When you trust the agent to handle technical details
- When you want to minimize back-and-forth communication
- When you want to monitor progress without micromanaging

---

## Expected Agent Behavior

**Good example:**
```
[1] Install gennearaccount ✓ | Installed v1.0.0 via .deb package | Installing near-cli-rs-ai
[2] Install near-cli-rs-ai ✓ | Installed via .deb package | Creating NEAR account
[3] Create NEAR account ✓ | Account: a9d4...3f1c created | Funding account
[4] Fund account ✓ | Waiting for blockchain confirmation | Preparing purchase info
PAUSE REQUIRED: Visit https://purchase.identyclaw.com with account ID a9d4...3f1c to complete purchase
```

**Bad example (too much chatter):**
```
I'm going to start by installing gennearaccount. This tool is required for creating NEAR accounts. I'll use the .deb package since it's faster. Let me download it first... [long explanation] ... OK now I need to install it. I'm using sudo dpkg... [more details] ... Great, it's installed! Now let me verify the version...
```

---

## Related Documentation

- [enrollment.md](enrollment.md) - Complete enrollment guide
- [authentication.md](authentication.md) - API authentication flows
- [api-reference.md](api-reference.md) - API endpoint documentation
