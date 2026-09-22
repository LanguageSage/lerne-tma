import { parseExerciseContent } from './app/src/utils/exerciseContentParser.js';
import { detectExerciseType } from './app/src/utils/exerciseDetector.js';
const text = `::task
Kindergarten-Jubiläum: Ordnen Sie die Abschnitte chronologisch (1-4).

::example
Нужно выставить в хронологическом порядке.
::exercise
@match
1. Schritt => Gleich am Morgen`;
const parsed = parseExerciseContent(text);
console.log(JSON.stringify(parsed, null, 2));
console.log("Type:", detectExerciseType(text));
