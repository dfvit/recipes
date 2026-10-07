// Weekly: read recipe-site feeds, read each new recipe's structured data (JSON-LD),
// and open a "Candidate" issue for quick recipes. You review, then add the "approved" label.
import fs from 'node:fs';
const {GITHUB_TOKEN: T, GITHUB_REPOSITORY: R} = process.env;
const MAX_NEW = 5, MAX_MIN = 45, MAX_AGE_DAYS = 21;
const feeds = JSON.parse(fs.readFileSync('feeds.json', 'utf8'));
const data = JSON.parse(fs.readFileSync('recipes.json', 'utf8'));
const api = (path, opt = {}) => fetch(`https://api.github.com/repos/${R}${path}`, {
  ...opt, headers: {Authorization: `Bearer ${T}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json'}
}).then(r => r.json());

const issues = await api('/issues?state=all&labels=recipe-suggestion&per_page=100');
const known = JSON.stringify([...data.adult, ...data.baby]) + JSON.stringify(Array.isArray(issues) ? issues.map(i => i.body) : []);

const MAP = {Chicken: /chicken/, Beef: /\bbeef|steak/, Pork: /\bpork|bacon|sausage/, Turkey: /turkey/,
  'Fish & seafood': /salmon|\bcod\b|tuna|shrimp|prawn|fish|haddock|trout/, Eggs: /\beggs?\b|frittata|omelet/,
  'Beans & lentils': /lentil|chickpea|black bean|white bean|kidney bean|\bbeans\b/, 'Tofu & tempeh': /tofu|tempeh/};
const hit = t => Object.keys(MAP).filter(k => MAP[k].test(t.toLowerCase()));
const mins = s => { const m = /PT(?:(\d+)H)?(?:(\d+)M)?/.exec(s || ''); return m ? (+m[1] || 0) * 60 + (+m[2] || 0) : 0; };
const text = s => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

async function recipeData(url) {
  const html = await (await fetch(url, {headers: {'User-Agent': 'recipe-site-bot'}})).text();
  for (const m of html.matchAll(/<script[^>]*ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const j = JSON.parse(m[1]);
      const nodes = [j, ...(Array.isArray(j) ? j : []), ...(j['@graph'] || [])];
      const r = nodes.find(n => [].concat(n?.['@type'] || []).includes('Recipe'));
      if (r) return r;
    } catch {}
  }
}

let created = 0;
for (const f of feeds) {
  if (created >= MAX_NEW) break;
  try {
    const xml = await (await fetch(f.feed, {headers: {'User-Agent': 'recipe-site-bot'}})).text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => ({
      link: (m[1].match(/<link>\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\s*<\/link>/) || [])[1],
      date: (m[1].match(/<pubDate>(.*?)<\/pubDate>/) || [])[1]}));
    for (const it of items) {
      if (created >= MAX_NEW) break;
      if (!it.link || known.includes(it.link)) continue;
      if (it.date && Date.now() - new Date(it.date) > MAX_AGE_DAYS * 864e5) continue;
      const r = await recipeData(it.link).catch(() => null);
      if (!r) continue;
      const time = mins(r.totalTime) || mins(r.prepTime) + mins(r.cookTime);
      if (!time || time > MAX_MIN) continue;
      const name = text(r.name);
      const ing = [].concat(r.recipeIngredient || []).join(' ');
      const foods = hit(name).length ? hit(name) : hit(ing);
      const cuisine = text([].concat(r.recipeCuisine || [])[0]);
      const body = `_Auto-found. Please check the details and rewrite the description in your own words, then add the \`approved\` label._\n\n` +
        `### Section\n\n${f.section === 'baby' ? 'Baby' : 'Everyday meals'}\n\n### Title\n\n${name}\n\n### Recipe URL\n\n${it.link}\n\n` +
        `### Source site\n\n${f.name}\n\n### Total time in minutes\n\n${time}\n\n### Short description\n\n${text(r.description).slice(0, 160)}\n\n` +
        `### Main foods\n\n${foods.join(', ')}\n\n### Cuisine\n\n${f.section === 'baby' ? '' : cuisine}\n\n### Baby stage\n\n\n\n### Baby texture\n\n`;
      await api('/issues', {method: 'POST', body: JSON.stringify({title: `Candidate: ${name}`, body, labels: ['recipe-suggestion', 'auto-found']})});
      created++;
      console.log('Opened issue for', name);
    }
  } catch (e) { console.log(`Skipped ${f.name}: ${e.message}`); }
}
console.log(`Done. ${created} candidate(s) opened.`);
