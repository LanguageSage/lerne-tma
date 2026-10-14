import fs from 'node:fs';
import { auditLesson } from '../app/src/utils/lessonQa.js';

// JSON on stdin keeps the Python CLI and Node runtime parser boundary simple.
const snapshot = JSON.parse(fs.readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(auditLesson(snapshot), null, 2));
