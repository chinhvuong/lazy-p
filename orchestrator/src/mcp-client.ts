import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export interface TaskExtractor {
  extractTasks(sessionId: string, transcript: string, chatLog: string): Promise<string[]>;
}

/** Uses the community notebooklm-mcp server (npx notebooklm-mcp@latest) via stdio MCP. */
export class NotebookLMExtractor implements TaskExtractor {
  async extractTasks(sessionId: string, transcript: string, chatLog: string): Promise<string[]> {
    const transport = new StdioClientTransport({
      command: 'npx',
      args: ['notebooklm-mcp@latest'],
    });

    const client = new Client({ name: 'lazy-p', version: '0.0.1' }, { capabilities: {} });

    try {
      await client.connect(transport);

      // Tool names are from the notebooklm-mcp community server.
      // Verify against https://github.com/sshh12/notebooklm-mcp if they change.
      await client.callTool({
        name: 'create_notebook',
        arguments: { title: `Meeting ${sessionId}` },
      });

      await client.callTool({
        name: 'add_source',
        arguments: { content: `Transcript:\n\n${transcript}` },
      });

      await client.callTool({
        name: 'add_source',
        arguments: { content: `Chat Log:\n\n${chatLog}` },
      });

      const result = await client.callTool({
        name: 'ask_question',
        arguments: {
          question:
            'What tasks were discussed? Who is responsible for each? List them as: "- [Owner] Task description" or "- Task description" if unowned.',
        },
      });

      type ContentBlock = { type: string; text?: string };
      const blocks = result.content as ContentBlock[];
      const answer = blocks
        .filter(b => b.type === 'text' && b.text)
        .map(b => b.text!)
        .join('\n');

      return answer
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0);
    } finally {
      await client.close();
    }
  }
}

/** Fallback: summarises via the Anthropic API when NotebookLM MCP is unavailable. */
export class ClaudeAPIExtractor implements TaskExtractor {
  async extractTasks(_sessionId: string, transcript: string, chatLog: string): Promise<string[]> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return ['_Task extraction unavailable: NotebookLM MCP failed and ANTHROPIC_API_KEY is not set._'];
    }

    const prompt = `You are analysing a meeting transcript and chat log to extract a task list.

Transcript:
${transcript}

Chat Log:
${chatLog}

Extract all tasks discussed. For each task include the owner if mentioned.
Format: "- [Owner] Task description" or "- Task description" if no owner.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = (await response.json()) as { content: Array<{ type: string; text: string }> };
    const text = data.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');

    return text
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);
  }
}
