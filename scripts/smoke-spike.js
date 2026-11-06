// Thử tay: planFlows thật (claude -p + MCP) với PRD / Figma mẫu. Dùng: node scripts/smoke-spike.js <prdUrl> <figmaUrl>
import { planFlows } from '../server/smoke/plan.js';
const [prdUrl, figmaUrl] = process.argv.slice(2);
if (!prdUrl || !figmaUrl) { console.error('Dùng: node scripts/smoke-spike.js <prdUrl> <figmaUrl>'); process.exit(2); }
const t = Date.now();
const r = await planFlows({ prdUrl, figmaUrl });
console.log(JSON.stringify(r, null, 1));
console.error(`(${Math.round((Date.now() - t) / 1000)}s)`);
process.exit(r.ok ? 0 : 1);
