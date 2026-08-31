// Static class-coverage check for app.html against compiled styles.css
const fs = require('fs');
const html = fs.readFileSync('public/app.html', 'utf8');
const css = fs.readFileSync('public/styles.css', 'utf8');

const classes = new Set();

// 1) class="..." and className attributes (static HTML)
for (const m of html.matchAll(/class\s*=\s*"([^"]*)"/g)) {
  m[1].split(/\s+/).forEach(c => { if (c) classes.add(c); });
}
// 2) classList.add/remove/toggle('x') and ('x','y')
for (const m of html.matchAll(/classList\.(?:add|remove|toggle|contains)\(([^)]*)\)/g)) {
  for (const q of m[1].matchAll(/['"`]([^'"`]+)['"`]/g)) {
    q[1].split(/\s+/).forEach(c => { if (c) classes.add(c); });
  }
}
// 3) className = '...' assignments in JS
for (const m of html.matchAll(/className\s*=\s*['"`]([^'"`]*)['"`]/g)) {
  m[1].split(/\s+/).forEach(c => { if (c && !c.includes('${')) classes.add(c); });
}
// 4) class="..." inside JS template literals (single-quoted or backtick class= within strings already caught by #1 for double quotes; catch single/backtick)
for (const m of html.matchAll(/class\s*=\s*['`]([^'`]*)['`]/g)) {
  m[1].split(/\s+/).forEach(c => { if (c && !c.includes('${')) classes.add(c); });
}

// Clean: drop empty, template placeholders, and pseudo-junk
const cleaned = [...classes].filter(c =>
  c && !c.includes('${') && !c.includes('{') && !c.includes('}') && /^[A-Za-z0-9_:./\[\]#!%-]+$/.test(c)
);

// Build a lookup: does the compiled css contain a selector for this class?
// Escape for regex; tailwind escapes special chars in output (e.g. \: \/ etc.)
function inCss(cls) {
  // direct literal match of `.cls` where cls chars like : / [ ] . are backslash-escaped in output
  const esc = cls.replace(/[.:/\[\]!%#]/g, ch => '\\\\?\\' + ch).replace(/[-]/g, '\\-');
  // simpler: check for the escaped-or-unescaped class token boundary
  const patterns = [
    new RegExp('\\.' + cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])'),
    new RegExp('\\.' + cls.replace(/[.*+?^${}()|[\]\\/:!%#]/g, '\\\\$&')),
  ];
  return patterns.some(p => p.test(css));
}

const unresolved = [];
for (const c of cleaned.sort()) {
  if (!inCss(c)) unresolved.push(c);
}

console.log('TOTAL_CLASSES:', cleaned.length);
console.log('UNRESOLVED_COUNT:', unresolved.length);
console.log('UNRESOLVED:', JSON.stringify(unresolved));
