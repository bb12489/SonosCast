/**
 * integrate-signatures.js
 * Integrates the complete SIGNATURES object into cast-auth.js
 */

const fs = require('fs');
const path = require('path');

// File paths
const GENERATED_FILE = path.join(__dirname, 'signatures-generated.js');
const AUTH_FILE = path.join(__dirname, 'sonoscast', 'app', 'lib', 'cast-auth.js');

console.log('Reading generated signatures...');
const generatedContent = fs.readFileSync(GENERATED_FILE, 'utf8');

// Extract just the SIGNATURES object declaration (without module.exports)
const signaturesMatch = generatedContent.match(/const SIGNATURES = \{[\s\S]*?\n\};/);
if (!signaturesMatch) {
  console.error('ERROR: Could not find SIGNATURES object in generated file');
  process.exit(1);
}

const newSignaturesObject = signaturesMatch[0];
console.log(`Extracted SIGNATURES object (${newSignaturesObject.split('\n').length} lines)`);

// Read cast-auth.js
console.log('Reading cast-auth.js...');
const authContent = fs.readFileSync(AUTH_FILE, 'utf8');

// Find and replace the old SIGNATURES object
// We need to match from "const SIGNATURES = {" to the closing "};" including the TODO comment
const oldSignaturesPattern = /const SIGNATURES = \{[\s\S]*?\n\};\s*\/\/ TODO:.*$/m;
const oldMatch = authContent.match(oldSignaturesPattern);

if (!oldMatch) {
  // Try without the TODO comment
  const alternatePattern = /const SIGNATURES = \{[\s\S]*?\n\};/;
  const alternateMatch = authContent.match(alternatePattern);
  
  if (!alternateMatch) {
    console.error('ERROR: Could not find SIGNATURES object in cast-auth.js');
    process.exit(1);
  }
  
  console.log('Found old SIGNATURES object (alternate pattern)');
  const newContent = authContent.replace(alternatePattern, newSignaturesObject);
  
  fs.writeFileSync(AUTH_FILE, newContent, 'utf8');
  console.log('✅ Successfully integrated all 795 signatures into cast-auth.js');
  
} else {
  console.log('Found old SIGNATURES object with TODO comment');
  const newContent = authContent.replace(oldSignaturesPattern, newSignaturesObject);
  
  fs.writeFileSync(AUTH_FILE, newContent, 'utf8');
  console.log('✅ Successfully integrated all 795 signatures into cast-auth.js');
}

// Verify the new file
const updatedContent = fs.readFileSync(AUTH_FILE, 'utf8');
const lineCount = updatedContent.split('\n').length;
console.log(`Updated cast-auth.js now has ${lineCount} lines`);

// Count signatures in updated file
const signatureCount = (updatedContent.match(/'20\d{6}':/g) || []).length;
console.log(`Verified: ${signatureCount} signatures present in updated file`);

if (signatureCount === 795) {
  console.log('✅ SUCCESS: All 795 signatures integrated correctly!');
} else {
  console.warn(`⚠️  WARNING: Expected 795 signatures, found ${signatureCount}`);
}
