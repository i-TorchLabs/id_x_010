# Data Agent User Guide
- https://sme-tx-studio.cuhk.edu.cn

**AI General-Purpose Computing Agent — Ask questions as if chatting, and get knowledge Q&A and database queries done**

> This guide is intended for first-time users of this system, walking you through every feature step by step from scratch. You don't need any technical knowledge — just follow along.

---

## Table of Contents

1. [What Does This System Do?](#1-what-does-this-system-do)
2. [Using an API Key](#2-using-an-api-key)
3. [Logging In](#3-logging-in)
4. [Getting to Know the Main Interface](#4-getting-to-know-the-main-interface)
5. [Starting Your First Conversation](#5-starting-your-first-conversation)
6. [Query a Database with a Single Sentence](#6-query-a-database-with-a-single-sentence)
7. [Understanding Query Results: Tables, Charts, and Export](#7-understanding-query-results-tables-charts-and-export)
8. [Prompt Library: Make the AI Answer in Your Style](#8-prompt-library-make-the-ai-answer-in-your-style)
9. [Viewing Usage and Editing Your Profile](#9-viewing-usage-and-editing-your-profile)
10. [FAQ](#10-faq)

---

## 1. What Does This System Do?

In short: **you ask questions in everyday language, and the AI finds answers, performs calculations, and even queries databases for you directly.**

In the past, pulling data from a database required knowing SQL (a database query language) and asking a technical colleague for help. Now you simply type a sentence, as naturally as sending a text message, for example:

> "Show the data volume by category for the past three months"

The system automatically understands what you mean, writes the query, retrieves the data, and presents the results with tables and charts.

The system includes several specialized "agents" (think of them as AI assistants with different areas of expertise). When you ask a question, the system automatically routes it to the most suitable one:

| Agent | What it's good at | Example |
|--------|-----------|----------|
| **General** | Everyday Q&A, math calculations, web search, knowledge base lookup | "Calculate the compound interest on 100,000 RMB at 3% annual rate over 5 years" |
| **SQL** | Translating your words into database queries, returning tables and charts | "Show the data volume by category for the past three months" |
| **Code** | Code-related Q&A (**under development, not yet available**) | — |

You'll also frequently see these two terms in the interface, so let's get acquainted:

- **Model**: The "brain" powering the AI's answers. Different models vary slightly in capability and speed. If unsure, just use the default.
- **Agent**: The assistant types in the table above. Choose General for everyday Q&A, and SQL for data queries.

Three reasons to use it with confidence:

- **Transparent process**: The AI shows its "thinking process" before giving the formal answer — it's not a black box;
- **Data safety**: All queries are read-only by default, and any operation that could modify data must go through human approval;
- **Multi-turn conversations**: You can ask follow-up questions within the same conversation. For example, ask "sales over the past three months" first, then follow up with "what about last month?" — the AI will understand.

---

## 2. Using an API Key

There are two options — choose whichever suits your needs:

### 2.1 Option 1: Personal Key for System Models (Contact the Administrator)

The "System Models" in the model settings are maintained centrally by the administrator; regular users can only view them. If you want to use **your own quota** to call these system models, please **contact the administrator** to bind a personal API Key to your account. Once bound successfully, the corresponding model will show a "Key Configured" badge, and subsequent calls will automatically be billed to your own Key (2,000 RMB per person).

### 2.2 Option 2: Self-Configured Provider (Self-Service)

**Step 1: Apply for an API Key on the model vendor's official website**

An API Key is like your "prepaid card password" with the vendor. Go to the vendor's open platform → register an account → find the "API Keys" page → create a key and **copy and save it immediately** (it usually looks like `sk-...` and is only shown once at creation):

| Vendor | Open Platform URL |
|------|--------------|
| SiliconFlow | cloud.siliconflow.cn |
| OpenAI | platform.openai.com |
| DeepSeek | platform.deepseek.com |
| OpenRouter | openrouter.ai |
| Alibaba DashScope | dashscope.console.aliyun.com |
| Zhipu AI | open.bigmodel.cn |

**Step 2: Enter it in the system**

1. Click the **settings gear** in the sidebar to open "Model Settings";
2. Click **Add Provider**, choose your vendor from the quick templates (the system will auto-fill the service URL), then paste your **API Key** and give it a custom name (e.g., `my-deepseek`);
3. **Add model names** under that Provider — note that they must exactly match the model IDs on the vendor's official site (e.g., `deepseek-chat`); you can add multiple;
4. Click **Save**. The system will automatically test the connection: if it fails, a specific reason will be shown (e.g., invalid Key, wrong URL); the configuration is only saved once the test passes;
5. After saving successfully, your model will appear in the **"Custom" group of the Model selector** in the input box. You can also set it as the **default model** in Model Settings.

> Name, service URL, and API Key are all required fields. To modify or delete later, use the same "Model Settings" dialog.

---

## 3. Logging In

Open the system URL provided by your administrator in a browser; the page will automatically redirect to the login page.

### 3.1 Recommended: Sign in with SSO

If you have a CUHK unified account, this is the simplest way to log in — **no registration needed, just one click**:

1. On the login page, click the **Sign in with SSO** button;
2. The page will redirect to CUHK's unified identity authentication page. Enter your CUHK account and password to authenticate (if you're already logged into another CUHK system in your browser, this step may pass automatically);
3. After successful authentication, you'll be redirected back to this system and taken straight to the chat interface.

**Your account is created automatically on first login** — no extra steps required; just use the same button for every subsequent login.

> SSO account credentials are managed centrally by CUHK; this system does not store your CUHK password. If you forget your password, use the university's password recovery channel.

### 3.2 Alternative: Email Registration and Login

Don't have a CUHK account? You can also register with an email address:

1. **Register**: On the login page, click the **Register** link, fill in your **Email**, **password** (at least 6 characters), and **confirm password**, check the terms of service, and submit;
2. **Log in**: Return to the login page, enter your Email and password, and click Log In to enter the main interface.

> For security, login attempts are limited to 5 per minute. If you enter the wrong password several times in a row, please wait a moment before retrying.

**Forgot your email password?** Click **Forgot Password** on the login page and enter your registered email; the system will send a password reset email. If the email never arrives, contact the administrator for a backend reset. (This feature applies only to email accounts; SSO account holders should use the university's channels.)

### 3.3 Logging Out

Click the **Log Out** button at the bottom of the sidebar. After logging out you will return directly to the home page. For users signed in via CUHK SSO, logging out will also end your CUHK unified login session in the background (so the next sign-in requires re-authentication).

---

## 4. Getting to Know the Main Interface

After logging in, the main chat page is divided into three areas:

```
┌──────────┬──────────────────────────┐
│          │                          │
│ Sidebar  │       Conversation       │
│          │ (questions and answers)  │
│          │                          │
│          ├──────────────────────────┤
│          │       Input Box          │
└──────────┴──────────────────────────┘
```

**Left Sidebar** (collapsible via a button):

| Position | Function |
|------|------|
| Top | **New Chat**: start a brand-new conversation (remember to click it when switching topics) |
| Middle | **Prompt Library** panel (see [Section 8](#8-prompt-library-make-the-ai-answer-in-your-style)) |
| Bottom | Your **avatar** (click to edit profile), **Usage Stats**, **settings gear**, **Log Out** |

**Bottom Input Box**: Where you type your questions. There are three dropdown selectors at the bottom right:

| Selector | When you need to change it |
|--------|------------------|
| **Model** | Usually just keep the default; change it only when you want a different "brain" |
| **Agent** | Choose **General** for everyday Q&A; switch to **SQL** for database queries (Code is grayed out and not yet available) |
| **Database** | Only needed when using the SQL agent: select the target database you want to query |

**Top Right Corner**: Switch the interface language between **中文 / English** and toggle **Light / Dark** theme at any time — changes take effect instantly.

---

## 5. Starting Your First Conversation

### 5.1 Try Asking a Question

1. Confirm the Agent at the bottom right of the input box is **General** (it is by default);
2. Type a sentence into the input box, for example: "Calculate the compound interest on 100,000 RMB at 3% annual rate over 5 years";
3. Press Enter (or click the send button).

### 5.2 The Answer Appears in Several Stages

The AI's answer doesn't appear all at once — it is displayed section by section, typewriter-style, in order:

1. **Intent label**: The system first tells you which assistant it has routed your question to;
2. **Thinking process**: The AI's reasoning draft, expanded by default; it can be collapsed and copied;
3. **Tool call card** (not always present): If the AI used a tool such as a calculator or web search, a small card will be displayed;
4. **Formal answer**: The actual answer, with support for headings, lists, tables, and other formatting;
5. **Token stats**: The usage consumed by this answer (you can safely ignore it).

### 5.3 Handy Actions During a Conversation

- **Follow up**: Just keep typing in the same conversation — the AI remembers the context. E.g., ask "the population of Beijing" first, then "what about Shanghai?";
- **Stop generating**: Answer too long and don't want to wait? Click the stop button to interrupt immediately;
- **Regenerate**: Not satisfied with an answer? Click **Regenerate** next to your question and the AI will answer again with the current settings;
- **Like / Dislike**: Each answer has 👍 / 👎 buttons below it. When clicking 👎, you can also write specific feedback to help improve the system;
- **Change topic**: Before starting a new topic, it's recommended to click **New Chat** in the sidebar to avoid the AI being influenced by the previous topic.

> Questions are limited to 20 per minute, which is more than enough for normal use.

---

## 6. Query a Database with a Single Sentence

This is the system's signature feature: **query a database without writing a single line of code.**

### 6.1 Steps

1. Switch the **Agent** at the bottom right of the input box to **SQL**;
2. Select the database you want to query in the **Database** selector (ask your administrator if unsure which one to pick);
3. Describe what you want in natural language, for example:
   - "Show the data volume by category for the past three months"
   - "What are the top 10 best-selling products?"
   - "New users per month, listed by month"
4. Press Enter to send, and wait for the results.

### 6.2 Normal Case: Results Come Back Directly

If your question is an ordinary "query" (read-only, no data changes), the system executes it directly and displays, in order:

1. **SQL explanation bubble**: A plain-language description of "what this query does," so you can confirm the AI understood you correctly;
2. **Table and chart**: The queried data;
3. **Text summary**: The AI's brief interpretation of the results.

### 6.3 Special Case: The "Approval Panel" Appears

If the operation generated by the AI **could modify data** (e.g., update, delete) or involves protected tables, the system **will not execute it on its own**. Instead, it pops up an **SQL Approval Panel**, laying out the statement to be executed and its meaning for a human to decide:

| Button | Meaning |
|------|------|
| **Approve** | Confirm it's fine and approve execution; results will follow |
| **Regenerate** | Don't execute this one; let the AI generate again |
| **Cancel** | Cancel this operation |

Approval requests are pushed to authorized approvers in real time. Even if you refresh the page, pending approval tasks will not be lost.

> For regular users, everyday "data lookup" questions are almost always executed directly and rarely trigger approval. If you see the approval panel, don't panic — it's exactly the system protecting data safety.

### 6.4 Red Alert: Query Blocked

If your request hits a dangerous operation or a protected table, the system will reject it outright and display the reason in a **red alert card**. This is a normal security mechanism, not a malfunction; if you genuinely have a business need, please contact the administrator.

---

## 7. Understanding Query Results: Tables, Charts, and Export

### 7.1 Tables

- Query results are displayed as tables, with at most the first **512 rows** loaded on the page; the table will indicate the actual total row count;
- Click **Export CSV** at the top right of the table to download the currently loaded data as a CSV file (openable in Excel).

> If the dataset is large and you need the full export, please contact the administrator (up to 10,000 rows, in xlsx or csv format).

### 7.2 Charts

When query results are suitable for visualization, the system **automatically generates a chart** and explains why that chart type was recommended:

- Five chart types are supported: **bar, line, pie, area, and scatter**;
- Don't like the default chart? You can switch the chart type manually;
- You can switch between chart and table views at any time.

---

## 8. Prompt Library: Make the AI Answer in Your Style

If you want the AI to always answer in a certain fixed style or with certain requirements (e.g., "always answer in Simplified Chinese, conclusion first, then reasons"), you can write these requirements into a **prompt file** and have the system automatically attach it to every turn of the conversation.

Open the **Prompt Panel** in the sidebar:

1. **Upload**: Click the paperclip button to upload a `.md` text file (write your requirements in Notepad and save with the `.md` extension);
2. **Activate**: Click a prompt to set it as "active" — only one is in effect at a time, and it will automatically be attached to every question you ask;
3. **Manage**: Each prompt supports preview, rename, edit, and delete;
4. **Temporarily skip**: The active prompt is shown as a **small badge** above the input box. If you don't want it for a particular turn, click the **×** on the badge to skip it for that turn only (it won't be deleted and will be restored next turn).

---

## 9. Viewing Usage and Editing Your Profile

### 9.1 Usage Stats

Click the **Usage Stats** button in the sidebar to view your usage over the past **7 / 30 / 90 days**:

- Number of requests, total Tokens, and spend (USD);
- A daily bar chart (switchable between Tokens / Cost);
- Usage breakdown by model.

> The administrator may have set a **monthly spending cap** on your account; once exceeded, new requests will be rejected. If you see an "insufficient quota" message, contact the administrator to adjust your quota (smeit@cuhk.edu.cn).

### 9.2 Profile

Click your **avatar** at the bottom of the sidebar to:

- Upload a new avatar (JPEG / PNG / WebP / GIF, no larger than 2 MB);
- Change your display name.

---

## 10. FAQ

**Q1: What should I do if I see "too many requests"?**
Questions are limited to 20 per minute and logins to 5 per minute. Just wait a minute and try again.

**Q2: My question is stuck at "thinking"?**
Try switching to a different model first. If you're using a self-configured model, open "Model Settings" and re-save it (which automatically tests connectivity), then troubleshoot based on the error message; if a system model still fails, contact the administrator.

**Q3: Why did my query trigger the approval panel, or get blocked with a red alert?**
Ordinary "data lookup" queries run directly; operations that could modify data require human approval; dangerous operations or those involving protected tables are rejected outright. These are all normal security mechanisms — see [Section 6](#6-query-a-database-with-a-single-sentence).

**Q4: Why is the Code Agent grayed out and unselectable?**
That feature is still under development and not yet available.

**Q5: Where can I see my past chat history?**
The current version does not provide a conversation history list. Context within the same conversation is maintained automatically; when starting a new topic, it's recommended to click **New Chat**.

**Q6: What should I do if I see "insufficient quota"?**
It means your spend this month has reached the cap set by the administrator. You can check your spending in "Usage Stats," then contact the administrator to adjust your quota (smeit@cuhk.edu.cn).

**Q7: The exported CSV is missing rows?**
The on-page **Export CSV** only exports the first 512 loaded rows. For complete data (up to 10,000 rows), please contact the administrator for an export.

**Q8: What if CUHK SSO login fails?**
The notice bar on the login page will show the specific reason. Common cases: authorization timeout (just retry), callback URL mismatch (contact the administrator to verify the configuration); for CUHK account or password issues, use the university's unified identity authentication support channel.

**Q9: Prompt file upload failed?**
Please make sure the file is in `.md` format (plain text with a .md extension) and no larger than **3 MB**. Write your content in Notepad or any text editor and save it with the `.md` extension.

**Q10: What if the AI's answer misses the point?**
Try these three tricks: ① Describe your question more specifically (time range, subject, desired format); ② Click **Regenerate** for another answer; ③ When changing topics, click **New Chat** first to avoid interference from the previous conversation.

---

<div align="center">

Copyright © i-Core · TorchLabs · Licensed under AGPL-3.0

</div>
