// Prints which voice dependencies @discordjs/voice can see (opus, encryption, DAVE, FFmpeg).
import { generateDependencyReport } from '@discordjs/voice';

console.log(generateDependencyReport());
