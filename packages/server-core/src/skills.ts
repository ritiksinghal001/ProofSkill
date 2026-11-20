// Controlled technology dictionary. Token-boundary matching plus a "learning" context check; never a bare substring search.
import { DICTIONARY_VERSION } from '@proof/contracts';

interface Entry { name: string; supported: boolean; aliases: string[] }
export const DICTIONARY: Entry[] = [
  { name: 'JavaScript', supported: true, aliases: ['javascript', 'ecmascript', 'es6', 'js'] },
  { name: 'React', supported: true, aliases: ['react', 'reactjs', 'react.js'] },
  { name: 'Node.js & Express', supported: true, aliases: ['node.js', 'nodejs', 'node', 'express.js', 'expressjs'] },
  { name: 'SQL', supported: true, aliases: ['sql', 'postgresql', 'postgres', 'mysql', 'sqlite'] },
  { name: 'TypeScript', supported: false, aliases: ['typescript'] },
  { name: 'Python', supported: false, aliases: ['python'] },
  { name: 'Java', supported: false, aliases: ['java'] },
  { name: 'Docker', supported: false, aliases: ['docker'] },
  { name: 'MongoDB', supported: false, aliases: ['mongodb', 'mongo'] },
];
export const SUPPORTED_SKILLS = DICTIONARY.filter((d) => d.supported).map((d) => d.name);

const LEARNING = /\b(learning|plan(?:ning)? to learn|want to learn|currently studying|will learn|interested in learning|beginner course|to be learned)\b/i;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface ExtractedSkill { name: string; alias: string; where: string; supported: boolean; status: 'IN_SCOPE' | 'UNSUPPORTED' | 'IGNORED_LEARNING' }

export function extractSkills(text: string): ExtractedSkill[] {
  const lines = text.split(/\r?\n/);
  let section = 'Resume';
  const found = new Map<string, ExtractedSkill>();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^(skills?|technical skills|projects?|experience|education|summary|certifications?)\s*:?\s*$/i.test(line)) { section = line.replace(/:/, '').replace(/^./, (c) => c.toUpperCase()); continue; }
    for (const entry of DICTIONARY) {
      for (const alias of entry.aliases) {
        const re = new RegExp(`(?<![\\w.+#-])${esc(alias)}(?![\\w+#]|\\.\\w)`, 'i');
        const m = re.exec(line);
        if (!m) continue;
        const before = line.slice(0, m.index);
        const learning = LEARNING.test(before) || LEARNING.test(line.slice(m.index, m.index + 40));
        const cur = found.get(entry.name);
        if (learning) { if (!cur) found.set(entry.name, { name: entry.name, alias: m[0], where: `${section} (learning, not a claim)`, supported: entry.supported, status: 'IGNORED_LEARNING' }); continue; }
        if (!cur || cur.status === 'IGNORED_LEARNING') found.set(entry.name, { name: entry.name, alias: m[0], where: section, supported: entry.supported, status: entry.supported ? 'IN_SCOPE' : 'UNSUPPORTED' });
      }
    }
  }
  return [...found.values()];
}
export { DICTIONARY_VERSION };
