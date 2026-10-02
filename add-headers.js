const fs = require('fs');
const { execSync } = require('child_process');

// Revert the files first
try {
  execSync('git checkout -- src/app/api/scripts/[id]/pages/[p]/annotations/route.ts src/app/api/scripts/[id]/questions/[questionNumber]/grade/route.ts src/app/api/scripts/[id]/grades/route.ts src/app/api/scripts/[id]/submit/route.ts src/app/api/scripts/[id]/route.ts src/app/api/ingest/[id]/pages/[pageId]/image/route.ts src/app/api/exams/[id]/submissions/bulk/route.ts src/app/api/allocations/next/route.ts');
} catch (e) {
  console.log('Error checking out', e);
}

const files = [
  'src/app/api/scripts/[id]/pages/[p]/annotations/route.ts',
  'src/app/api/scripts/[id]/questions/[questionNumber]/grade/route.ts',
  'src/app/api/scripts/[id]/grades/route.ts',
  'src/app/api/scripts/[id]/submit/route.ts',
  'src/app/api/scripts/[id]/route.ts',
  'src/app/api/ingest/[id]/pages/[pageId]/image/route.ts',
  'src/app/api/exams/[id]/submissions/bulk/route.ts',
  'src/app/api/allocations/next/route.ts'
];

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.log(`Skipping ${file}`);
    continue;
  }
  let content = fs.readFileSync(file, 'utf8');
  
  // Use [\s\S]*? to match across newlines
  content = content.replace(/(export async function \w+\([\s\S]*?\)\s*\{)/g, '$1\n  const __reqStart = Date.now();');
  
  content = content.replace(/(return NextResponse\.json\(\s*\{[^}]*\}(?:,\s*|\s*))(\{\s*status:\s*\d+\s*\})/g, (match, p1, p2) => {
    const inner = p2.substring(1, p2.length - 1);
    return `${p1}{ ${inner}, headers: { 'Server-Timing': \`total;dur=\${Date.now() - __reqStart}\` } }`;
  });

  content = content.replace(/(return new NextResponse\([^,]+,\s*)(\{[^}]*\})/g, (match, p1, p2) => {
    if (p2.includes('headers')) {
      return `${p1}{ ${p2.substring(1, p2.length - 1)}, headers: { ...(${p2.match(/headers:\s*({[^}]*})/)?.[1] || '{}'}), 'Server-Timing': \`total;dur=\${Date.now() - __reqStart}\` } }`;
    }
    return match;
  });

  fs.writeFileSync(file, content, 'utf8');
  console.log(`Updated ${file}`);
}
