#!/usr/bin/env node
/**
 * Google Indexing API - Request URL indexing via Google's API
 *
 * Uses a Google Cloud service account to submit URLs for indexing.
 *
 * SETUP REQUIRED (one-time):
 *   1. Go to Google Cloud Console (https://console.cloud.google.com)
 *   2. Create a project (or use existing)
 *   3. Enable the "Web Search Indexing API"
 *   4. Create a Service Account → download JSON key file
 *   5. In Google Search Console (https://search.google.com/search-console):
 *      - Go to Settings → Users and permissions
 *      - Add the service account email as an Owner
 *   6. Store the service account JSON key as a GitHub Secret:
 *      - Secret name: GOOGLE_INDEXING_KEY
 *      - Secret value: the full contents of the JSON key file
 *
 * Usage:
 *   GOOGLE_INDEXING_KEY='{ ... }' node scripts/notify-google.js <url>
 *   GOOGLE_INDEXING_KEY='{ ... }' node scripts/notify-google.js https://www.marajtech.com/blog/my-post.html
 */

const https = require('https');
const crypto = require('crypto');

const SCOPES = ['https://www.googleapis.com/auth/indexing'];
const INDEXING_ENDPOINT = 'https://indexing.googleapis.com/v3/urlNotifications:publish';

function base64url(data) {
    return Buffer.from(data).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createSignedJwt(serviceAccount) {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
        iss: serviceAccount.client_email,
        scope: SCOPES.join(' '),
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600
    };

    const segments = [
        base64url(JSON.stringify(header)),
        base64url(JSON.stringify(payload))
    ];

    const sign = crypto.createSign('RSA-SHA256');
    sign.update(segments.join('.'));
    const signature = sign.sign(serviceAccount.private_key, 'base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    return segments.join('.') + '.' + signature;
}

function getAccessToken(serviceAccount) {
    return new Promise((resolve, reject) => {
        const jwt = createSignedJwt(serviceAccount);
        const body = `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`;

        const req = https.request('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.access_token) resolve(json.access_token);
                    else reject(new Error(`Token error: ${data}`));
                } catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function submitUrl(accessToken, url, type = 'URL_UPDATED') {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ url, type });
        const urlObj = new URL(INDEXING_ENDPOINT);

        const req = https.request({
            hostname: urlObj.hostname,
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
                'Content-Length': Buffer.byteLength(body)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                console.log(`  [${res.statusCode}] ${url} → ${type}`);
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(JSON.parse(data));
                } else {
                    console.error(`  Error: ${data}`);
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function main() {
    const url = process.argv[2];
    const type = process.argv[3] || 'URL_UPDATED';

    if (!url) {
        console.error('Usage: node notify-google.js <url> [URL_UPDATED|URL_DELETED]');
        process.exit(1);
    }

    const keyJson = process.env.GOOGLE_INDEXING_KEY;
    if (!keyJson) {
        console.error('Error: GOOGLE_INDEXING_KEY environment variable not set.');
        console.error('Set it to the contents of your Google Cloud service account JSON key.');
        process.exit(1);
    }

    let serviceAccount;
    try {
        serviceAccount = JSON.parse(keyJson);
    } catch (e) {
        console.error('Error: GOOGLE_INDEXING_KEY is not valid JSON.');
        process.exit(1);
    }

    console.log('Google Indexing API - Requesting indexing...');
    console.log(`  Service account: ${serviceAccount.client_email}`);
    console.log(`  URL: ${url}`);
    console.log(`  Type: ${type}`);

    const token = await getAccessToken(serviceAccount);
    await submitUrl(token, url, type);

    console.log('Done!');
}

main().catch(err => {
    console.error('Failed:', err.message);
    process.exit(1);
});
