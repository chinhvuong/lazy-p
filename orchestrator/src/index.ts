import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createOrchestrator } from './server.js';
import { MeetingStore } from './meeting-store.js';
import { scanOutputDir } from './meeting-scanner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT ?? '3000', 10);
const uiDistPath = join(__dirname, '../../ui/dist');
const outputDir = process.env.OUTPUT_DIR ?? process.cwd();

const store = MeetingStore.openInDir(outputDir);
const server = createOrchestrator(uiDistPath, outputDir, store);

server.listen(PORT, () => {
  console.log(`[orchestrator] http://localhost:${PORT}`);
  console.log(`[orchestrator] Writing MEETING.md to: ${outputDir}`);

  // Bootstrap scan: non-blocking, runs after server is ready to accept connections
  setImmediate(() => {
    const count = scanOutputDir(outputDir, store);
    if (count > 0) console.log(`[orchestrator] Scanned ${count} existing MEETING.md file(s) into archive.`);
  });
});
