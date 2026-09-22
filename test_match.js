import { parseMatchData } from './app/src/utils/matchParser.js';

const text1 = `::task
Kindergarten-Jubiläum: Ordnen Sie die Abschnitte chronologisch (1-4).

::example
Нужно выставить в хронологическом порядке.
::exercise
@match
1. Schritt => Gleich am Morgen
2. Schritt => Am späten Vormittag`;

const text2 = `::task
Kindergarten-Jubiläum: Ordnen Sie die Abschnitte chronologisch (1-4).

@match
1. Schritt => Gleich am Morgen
2. Schritt => Am späten Vormittag`;

console.log('With example:\n', JSON.stringify(parseMatchData(text1), null, 2));
console.log('Without example:\n', JSON.stringify(parseMatchData(text2), null, 2));
