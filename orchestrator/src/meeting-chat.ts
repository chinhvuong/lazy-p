import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { MeetingStore, ChatMessageRow } from './meeting-store.js';

type ContentBlock = { type: string; text?: string };

export class MeetingChatHandler {
  constructor(private store: MeetingStore) {}

  async ask(meetingId: string, question: string): Promise<ChatMessageRow> {
    const meeting = this.store.getById(meetingId);
    if (!meeting) throw new Error(`Meeting not found: ${meetingId}`);
    if (!meeting.notebook_id) {
      throw new Error('No NotebookLM notebook for this meeting. Meeting Chat is unavailable.');
    }

    const transport = new StdioClientTransport({
      command: 'npx',
      args: ['notebooklm-mcp@latest'],
    });
    const client = new Client({ name: 'lazy-p', version: '0.0.1' }, { capabilities: {} });

    let answer: string;
    try {
      await client.connect(transport);

      // Navigate to the existing notebook by ID
      await client.callTool({
        name: 'get_notebook',
        arguments: { notebook_id: meeting.notebook_id },
      });

      const result = await client.callTool({
        name: 'ask_question',
        arguments: { question },
      });

      const blocks = result.content as ContentBlock[];
      answer = blocks
        .filter(b => b.type === 'text' && b.text)
        .map(b => b.text!)
        .join('\n');
    } finally {
      await client.close();
    }

    this.store.addChatMessage(meetingId, 'user', question);
    return this.store.addChatMessage(meetingId, 'assistant', answer);
  }
}
