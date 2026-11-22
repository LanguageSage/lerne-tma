import { readFileSync } from 'node:fs';
import { validateNativeV2Content, NativeV2ValidationError } from '../../app/src/utils/nativeV2Contract.js';

const { samples, contract } = JSON.parse(readFileSync(0, 'utf8'));
const results = samples.map(content => {
  try {
    return { valid: true, normalized: validateNativeV2Content(content, { contract }) };
  } catch (error) {
    if (!(error instanceof NativeV2ValidationError)) throw error;
    return { valid: false };
  }
});
process.stdout.write(JSON.stringify(results));
