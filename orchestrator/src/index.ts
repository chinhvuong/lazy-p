import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createOrchestrator } from './server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT ?? '3000', 10);
const uiDistPath = join(__dirname, '../../ui/dist');
const outputDir = process.env.OUTPUT_DIR ?? process.cwd();

const server = createOrchestrator(uiDistPath, outputDir);
server.listen(PORT, () => {
  console.log(`[orchestrator] http://localhost:${PORT}`);
  console.log(`[orchestrator] Writing MEETING.md to: ${outputDir}`);
});
