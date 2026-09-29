/** npm run capture:summary -- <capture.json.gz>: sessions, top diagnostics, errors and client errors of a capture. */
import { readCaptureFile } from '../server/data/capture/captureFile';
import { summarize } from '../server/data/capture/summary';

const file = process.argv[2];
if (!file) {
  console.error('usage: npm run capture:summary -- <jobs-console-capture-....json.gz>');
  process.exit(2);
}
try {
  process.stdout.write(summarize(readCaptureFile(file)));
} catch (e) {
  console.error(`capture:summary: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
