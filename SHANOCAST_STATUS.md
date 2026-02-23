# Shanocast Authentication Implementation - Status

## Overview

SonosCast now includes a **partial implementation** of the Shanocast authentication bypass method, enabling Cast protocol authentication for YouTube Music, Chrome browser Cast, and other official Google Cast apps.

**Current Status:** ⚠️ **INCOMPLETE - Only works for Feb 20-24, 2026**

**What Works:**
- ✅ Authentication handler integrated into Cast device
- ✅ Device and ICA certificates included (from AirReceiver)
- ✅ Protobuf encoding for AuthResponse
- ✅ Date-based signature lookup logic

**What's Missing:**
- ❌ Only 3 sample signatures included (Feb 20-24, 2026)
- ❌ Need ~792 more signatures to cover full 4-year range
- ❌ Signatures must cover: **August 15, 2023 → December 21, 2027**

---

## How It Works

The Shanocast method exploits a Chrome vulnerability (`enforce_nonce_checking=false`) that allows authentication bypass using precomputed signatures:

1. **Chrome sends AuthChallenge** with `sender_nonce` challenge
2. **SonosCast responds** with:
   - Fixed device certificate (from rooted Chromecast)
   - ICA certificate (publicly available)
   - Precomputed RSA signature for current 48-hour period
3. **Chrome accepts** because it doesn't verify the `sender_nonce` in the response
4. **Authentication succeeds** even though we didn't actually sign the challenge

### Why Precomputed Signatures?

- Each signature is valid for **48 hours** (Google's rotation period)
- Signatures were generated offline using a fixed RSA private key extracted from AirReceiver
- We need **795 signatures** to cover ~4 years (2023-2027)
- Each signature is **256 bytes** (2048-bit RSA)

---

## Completing the Implementation

### Step 1: Extract All Signatures

The full signature data is available in the Shanocast repository patch file. Use the provided extraction script:

```bash
# Download the Shanocast patch
curl -O https://raw.githubusercontent.com/rgerganov/shanocast/master/shanocast.patch

# Extract signatures to JSON format
node scripts/extract-signatures.js < shanocast.patch > signatures.json
```

This will generate a JSON file with ~795 signatures in format:
```json
{
  "20230815": [33, 44, 202, 90, ...],
  "20230817": [115, 244, 245, 133, ...],
  ...
  "20271221": [145, 104, 123, 214, ...]
}
```

### Step 2: Convert to JavaScript Buffer Format

Transform the JSON array format into JavaScript Buffer.from() calls for `cast-auth.js`:

```javascript
const SIGNATURES = {
  '20230815': Buffer.from([0x21, 0x2c, 0xca, 0x5a, ...]),
  '20230817': Buffer.from([0x73, 0xf4, 0xf5, 0x85, ...]),
  // ... ~793 more entries
  '20271221': Buffer.from([0x91, 0x68, 0x7b, 0xd6, ...])
};
```

### Step 3: Update cast-auth.js

Replace the SIGNATURES object in `sonoscast/app/lib/cast-auth.js` (lines 119-209) with the complete set.

**File size impact:**
- Current: ~335 lines, ~10KB
- With all signatures: ~1200 lines, ~220KB
- Still acceptable for Node.js module

### Step 4: Test Authentication

1. **Rebuild addon:**
   ```bash
   ha addons rebuild 94dc51a4_sonoscast
   ```

2. **Test with Chrome:**
   - Open Chrome browser
   - Visit any website with Cast button
   - Look for SonosCast devices in Cast menu
   - Attempt to cast - should authenticate without errors

3. **Test with YouTube Music app:**
   - Open YouTube Music mobile app
   - Tap Cast button
   - SonosCast devices should appear
   - Start playback - should authenticate and stream

4. **Monitor logs:**
   ```bash
   ssh root@192.168.1.224 "ha addons logs 94dc51a4_sonoscast --follow"
   ```
   
   Look for:
   ```
   [CastAuth] Using signature for 20260222 (valid until ...)
   [CastDevice] Auth response sent (Shanocast bypass)
   ```

### Step 5: Verify Signature Coverage

Check which date range your signatures cover:

```javascript
// In cast-auth.js, add after SIGNATURES object:
const firstDate = Object.keys(SIGNATURES).sort()[0];
const lastDate = Object.keys(SIGNATURES).sort().reverse()[0];
log.info(COMPONENT, `Signatures cover: ${firstDate} to ${lastDate}`);
```

The **last signature date** determines when authentication will fail. Update signatures before that date!

---

## Alternative: Quick Test with Limited Signatures

Want to test authentication **right now** without extracting all signatures?

1. **Extract just the next 30 days** of signatures from the patch
2. Test with Chrome/YouTube during that window
3. Extract full set only if authentication works correctly

This validates the implementation before investing time in full extraction.

---

## Troubleshooting

### "No signature found for date YYYYMMDD"

**Cause:** Current date not covered by SIGNATURES object

**Solution:** Add signature for that 48-hour period from shanocast.patch

### "AuthChallenge received" but sender still rejects

**Possible causes:**
1. Signature doesn't match current 48-hour period
2. Certificate chain malformed
3. Chrome updated to fix `enforce_nonce_checking` vulnerability
4. Protobuf encoding incorrect

**Debug:**
- Enable `log_level: trace` in addon config
- Check signature validity dates in logs
- Verify certificate DER encoding matches Shanocast exactly

### Chrome Cast menu doesn't show devices

**Not an authentication issue!** This is mDNS discovery. Check:
- Devices advertised: `avahi-browse -t _googlecast._tcp`
- Host networking enabled in addon config
- Firewall allows mDNS (UDP 5353)

---

## Technical References

- **Shanocast Project:** https://github.com/rgerganov/shanocast
- **Technical Writeup:** https://xakcop.com/post/shanocast/
- **Chrome Vulnerability:** `enforce_nonce_checking=false` in Cast SDK v2
- **Certificate Source:** AirReceiver firmware (rooted Chromecast)
- **Signature Coverage:** 795 signatures × 48 hours = 1,590 days (~4.3 years)

---

## Security Implications

### Is this hack detection-proof?

**No.** Google could:
1. Fix `enforce_nonce_checking` in Chrome updates
2. Rotate root CA certificates
3. Implement additional verification in Cast protocol v3

### Will this break in the future?

**Likely.** The signatures expire **December 21, 2027**. After that date:
- Would need new signatures from updated AirReceiver firmware
- Or Google may have patched the vulnerability entirely

### Can Google detect this?

**Possibly.** Signs that might trigger detection:
- Same device certificate used by many instances worldwide
- Signature reuse patterns
- Missing sender_nonce verification

**Mitigation:** This is for personal use on your home network, not a commercial product.

---

## Current Implementation Limitations

1. **Date Coverage:** Only Feb 20-24, 2026 (3 signatures)
2. **No Certificate Rotation:** Using fixed certificates permanently
3. **No Fallback:** If signature missing, returns error (no retry)
4. **No Signature Updates:** Manual process to add new signatures
5. **Chrome Version Dependent:** Relies on unfixed vulnerability

---

## Recommended Next Actions

**Immediate (Before Testing):**
1. ✅ Commit current implementation to Git
2. ✅ Document status in changelog
3. ⏳ Extract all 795 signatures from shanocast.patch
4. ⏳ Update cast-auth.js with complete SIGNATURES object
5. ⏳ Rebuild addon and test with YouTube Music

**Long Term (Post-Deployment):**
6. Monitor signature expiration date (Dec 2027)
7. Watch for Chrome Cast SDK updates that may patch vulnerability
8. Consider alternative authentication methods (e.g., proxy through real Chromecast)
9. Document working configuration for user community

---

## Success Criteria

Implementation is **complete** when:
- ✅ cast-auth.js contains all 795 signatures
- ✅ Chrome browser Cast menu shows SonosCast devices
- ✅ YouTube Music app authenticates successfully
- ✅ Logs show "Auth response sent (Shanocast bypass)"
- ✅ Media plays through Sonos speakers via Cast protocol
- ✅ No authentication errors in logs during normal use

---

**Created:** February 22, 2026  
**Last Updated:** February 22, 2026  
**Implementation Status:** 60% Complete (structure done, data extraction pending)
