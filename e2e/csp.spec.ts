import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

// The CSP is delivered as real headers (vercel.json + public/_headers) with a
// <meta> fallback in index.html for hosts that can't set headers. This test
// keeps all three copies in sync, and — when FS_TEST_DEPLOY_URL points at a
// deployed site — checks the header is actually served.

function extractFromVercelJson(text: string): string | null {
  return /"Content-Security-Policy",\s*"value":\s*"([^"]+)"/.exec(text)?.[1] ?? null
}

function extractFromHeadersFile(text: string): string | null {
  // `public/_headers` (Cloudflare/Netlify format): `Content-Security-Policy: <value>`
  return /Content-Security-Policy:\s*(\S.*)/m.exec(text)?.[1]?.trimEnd() ?? null
}

function extractFromIndexMeta(text: string): string | null {
  return /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(text)?.[1] ?? null
}

test('CSP is mirrored in vercel.json, public/_headers and the index meta, and they agree', () => {
  const fromJson = extractFromVercelJson(readFileSync('vercel.json', 'utf8'))
  const fromHeaders = extractFromHeadersFile(readFileSync('public/_headers', 'utf8'))
  const fromMeta = extractFromIndexMeta(readFileSync('index.html', 'utf8'))

  expect(fromJson).toBeTruthy()
  expect(fromHeaders).toBeTruthy()
  expect(fromMeta).toBeTruthy()
  expect(fromJson).toBe(fromHeaders)
  expect(fromJson).toBe(fromMeta)
})

test('the deployed site serves the CSP response header', async () => {
  const deployUrl = process.env.FS_TEST_DEPLOY_URL
  if (!deployUrl) test.skip()
  const resp = await fetch(deployUrl)
  const csp = resp.headers.get('content-security-policy')
  expect(csp).toContain("default-src 'self'")
  expect(csp).toContain('https://huggingface.co')
})
