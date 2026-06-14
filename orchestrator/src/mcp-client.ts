import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

type ContentBlock = { type: string; text?: string };

export interface TaskExtractor {
  extractTasks(sessionId: string, transcript: string, chatLog: string, notebookUrl?: string): Promise<string[]>;
  notebookId?: string;
}

async function withMCPClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const transport = new StdioClientTransport({ command: 'npx', args: ['notebooklm-mcp@latest'] });
  const client = new Client({ name: 'lazy-p', version: '0.0.1' }, { capabilities: {} });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

export async function getNotebookLMHealth(): Promise<{ authenticated: boolean; status: string }> {
  return withMCPClient(async (client) => {
    const result = await client.callTool({ name: 'get_health', arguments: {} });
    const blocks = result.content as ContentBlock[];
    const text = blocks.filter(b => b.type === 'text' && b.text).map(b => b.text!).join('');
    const data = JSON.parse(text) as { data: { authenticated: boolean; status: string } };
    return { authenticated: data.data.authenticated, status: data.data.status };
  });
}

export async function setupNotebookLMAuth(): Promise<void> {
  return withMCPClient(async (client) => {
    await client.callTool({ name: 'setup_auth', arguments: { show_browser: true } });
  });
}

/**
 * Uses notebooklm-mcp v2.x.
 * Requires a pre-existing notebook URL — v2.x removed programmatic notebook creation.
 * User creates the notebook at notebooklm.google.com and pastes the URL during import.
 */
export class NotebookLMExtractor implements TaskExtractor {
  notebookId: string | undefined = undefined;

  async extractTasks(
    sessionId: string,
    transcript: string,
    _chatLog: string,
    notebookUrl?: string,
  ): Promise<string[]> {
    if (!notebookUrl) {
      throw new Error(
        'NotebookLM notebook URL is required for task extraction. ' +
        'Create a notebook at notebooklm.google.com and paste the URL during import.',
      );
    }

    return withMCPClient(async (client) => {
      await client.callTool({
        name: 'add_source',
        arguments: {
          type: 'text',
          content: `Meeting ${sessionId} Transcript:\n\n${transcript}`,
          title: `Meeting ${sessionId}`,
          notebook_url: notebookUrl,
        },
      });

      const result = await client.callTool({
        name: 'ask_question',
        arguments: {
          question:
            'What tasks were discussed? Who is responsible for each? List them as: ' +
            '"- [Owner] Task description" or "- Task description" if unowned.',
          notebook_url: notebookUrl,
          source_format: 'none',
        },
      });

      this.notebookId = notebookUrl; // store the full URL as the notebook identifier

      const blocks = result.content as ContentBlock[];
      const answer = blocks.filter(b => b.type === 'text' && b.text).map(b => b.text!).join('\n');
      return answer.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    });
  }
}

/** Fallback: summarises via the Anthropic API when NotebookLM MCP is unavailable. */
export class ClaudeAPIExtractor implements TaskExtractor {
  async extractTasks(
    _sessionId: string,
    transcript: string,
    chatLog: string,
    _notebookUrl?: string,
  ): Promise<string[]> {
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
    const text = data.content.filter(c => c.type === 'text').map(c => c.text).join('\n');

    return text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  }
}
