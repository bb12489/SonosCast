const fs = require('fs');

// Read the patch file
const patchContent = fs.readFileSync('shanocast.patch', 'utf8');

// Extract all hex bytes from the signatures array
const hexPattern = /0x([0-9a-fA-F]{2})/g;
const allBytes = [];

// Find the start of the signatures array
const signaturesStart = patchContent.indexOf('static unsigned char signatures[] = {');
if (signaturesStart === -1) {
  console.error('Could not find signatures array in patch file');
  process.exit(1);
}

// Find the end of the signatures array
const signaturesEnd = patchContent.indexOf('};', signaturesStart);
const signaturesSection = patchContent.substring(signaturesStart, signaturesEnd);

// Extract all hex values from additions (lines with +)
const lines = signaturesSection.split('\n');
for (const line of lines) {
  // Only process lines that are additions (start with +) and contain hex values
  if (line.trim().startsWith('+') && line.includes('0x')) {
    let match;
    while ((match = hexPattern.exec(line)) !== null) {
      allBytes.push(parseInt(match[1], 16));
    }
  }
}

console.log(`Total bytes extracted: ${allBytes.length}`);

// Group into 256-byte signatures
const SIGNATURE_SIZE = 256;
const signatures = [];
for (let i = 0; i < allBytes.length; i += SIGNATURE_SIZE) {
  const chunk = allBytes.slice(i, i + SIGNATURE_SIZE);
  if (chunk.length === SIGNATURE_SIZE) {
    signatures.push(chunk);
  } else if (chunk.length > 0) {
    console.warn(`Warning: Incomplete signature at end with ${chunk.length} bytes (skipped)`);
  }
}

console.log(`Total complete signatures: ${signatures.length}`);

// Start date: August 15, 2023
// Each signature is valid for 48 hours
const startDate = new Date('2023-08-15T00:00:00Z');
const HOURS_PER_SIGNATURE = 48;

// Calculate end date
const endDate = new Date(startDate.getTime() + (signatures.length - 1) * HOURS_PER_SIGNATURE * 60 * 60 * 1000);
console.log(`Date range: ${startDate.toISOString().slice(0, 10)} to ${endDate.toISOString().slice(0, 10)}`);

// Generate JavaScript code for the SIGNATURES object
const jsLines = [];
jsLines.push('const SIGNATURES = {');

for (let i = 0; i < signatures.length; i++) {
  const signatureDate = new Date(startDate.getTime() + i * HOURS_PER_SIGNATURE * 60 * 60 * 1000);
  const dateKey = signatureDate.toISOString().slice(0, 10).replace(/-/g, '');
  
  // Format hex bytes with proper line wrapping (12 bytes per line)
  const hexLines = [];
  for (let j = 0; j < signatures[i].length; j += 12) {
    const lineBytes = signatures[i].slice(j, j + 12);
    const hexValues = lineBytes.map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ');
    hexLines.push(hexValues);
  }
  
  jsLines.push(`  '${dateKey}': Buffer.from([`);
  hexLines.forEach((line, idx) => {
    jsLines.push(`    ${line}${idx < hexLines.length - 1 ? ',' : ''}`);
  });
  jsLines.push(`  ])${i < signatures.length - 1 ? ',' : ''}`);
}

jsLines.push('};');
jsLines.push('');
jsLines.push(`module.exports = { SIGNATURES };`);

// Write output
const outputContent = jsLines.join('\n');
fs.writeFileSync('signatures-generated.js', outputContent);

console.log(`\nGenerated ${jsLines.length} lines of JavaScript code`);
console.log(`Output saved to: signatures-generated.js`);
console.log(`\nYou can now copy the SIGNATURES object from signatures-generated.js`);
console.log(`and replace the existing SIGNATURES in cast-auth.js`);
