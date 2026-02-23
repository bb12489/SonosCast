#!/usr/bin/env node

/**
 * Extract signatures from Shanocast patch file
 * Converts C hex arrays to JavaScript Buffer.from() format
 * 
 * Usage: node extract-signatures.js < shanocast.patch > signatures.json
 */

const fs = require('fs');
const { exit } = require('process');

// Read the entire patch file
let patchContent = '';
process.stdin.on('data', (chunk) => {
  patchContent += chunk.toString();
});

process.stdin.on('end', () => {
  try {
    extractSignatures(patchContent);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
});

function extractSignatures(content) {
  // Find the signatures array in the C patch
  const signaturesMatch = content.match(/static unsigned char signatures\[\]\s*=\s*\{([^}]+)\}/s);
  
  if (!signaturesMatch) {
    throw new Error('Could not find signatures array in patch file');
  }
  
  const signaturesData = signaturesMatch[1];
  
  // Extract all hex bytes
  const hexPattern = /0x([0-9a-fA-F]{2})/g;
  const allBytes = [];
  let match;
  
  while ((match = hexPattern.exec(signaturesData)) !== null) {
    allBytes.push(parseInt(match[1], 16));
  }
  
  console.error(`Extracted ${allBytes.length} bytes`);
  
  // Each signature is 256 bytes
  const SIGNATURE_SIZE = 256;
  const numSignatures = Math.floor(allBytes.length / SIGNATURE_SIZE);
  
  console.error(`Found ${numSignatures} signatures`);
  
  // Starting date: Aug 15, 2023 (from Shanocast docs)
  const startDate = new Date('2023-08-15T00:00:00Z');
  
  // Extract signatures and assign dates
  const signatures = {};
  
  for (let i = 0; i < numSignatures; i++) {
    const offset = i * SIGNATURE_SIZE;
    const sigBytes = allBytes.slice(offset, offset + SIGNATURE_SIZE);
    
    // Calculate date for this signature (48-hour periods)
    const sigDate = new Date(startDate.getTime() + (i * 48 * 60 * 60 * 1000));
    const dateKey = sigDate.toISOString().slice(0, 10).replace(/-/g, '');
    
    signatures[dateKey] = sigBytes;
  }
  
  // Output as JSON
  console.log(JSON.stringify(signatures, null, 2));
  console.error(`\nExtracted ${Object.keys(signatures).length} signatures`);
  console.error(`Date range: ${Object.keys(signatures)[0]} to ${Object.keys(signatures)[Object.keys(signatures).length - 1]}`);
}
