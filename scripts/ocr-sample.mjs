import { createWorker } from 'tesseract.js';

const worker = await createWorker('rus');
const result = await worker.recognize(process.argv[2]);
process.stdout.write(result.data.text);
await worker.terminate();
