#!/usr/bin/env npx tsx
import { generateSecret, getTOTPUri, generateTOTP } from './src/totp.js';

const secret = generateSecret();
const uri = getTOTPUri(secret, 'rohlik', 'RohlikMCP');

console.log('=== Rohlik MCP TOTP Setup ===\n');
console.log('1. Add this to your authenticator app:\n');
console.log(`   Secret: ${secret}\n`);
console.log(`   Or scan this URI (paste into a QR generator):`);
console.log(`   ${uri}\n`);
console.log('2. Set the environment variable:\n');
console.log(`   ROHLIK_TOTP_SECRET=${secret}\n`);
console.log('3. Verify — current code should match your app:\n');
console.log(`   Current TOTP: ${generateTOTP(secret)}\n`);
