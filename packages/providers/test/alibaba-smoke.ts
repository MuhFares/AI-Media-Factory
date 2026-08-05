/**
 * Alibaba DashScope Provider — Smoke Test
 *
 * Production verification using a real DashScope API key.
 * Tests all five LlmProvider contract methods against live infrastructure.
 *
 * Usage:
 *   1. Set DASHSCOPE_API_KEY environment variable
 *   2. npm run test:alibaba-smoke
 *
 * Exit codes:
 *   0 = all tests passed
 *   1 = one or more tests failed
 */

import 'dotenv/config';
import { AlibabaProvider } from '../src/alibaba.js';

async function main() {
  console.log('=== Alibaba DashScope Provider Smoke Test ===\n');

  const provider = new AlibabaProvider();
  let failures = 0;

  // Test 1: Health Check
  console.log('[1/5] Testing health()...');
  try {
    const health = await provider.health();
    if (health.status === 'healthy') {
      console.log('✓ Health check passed:', health.status);
    } else {
      console.log('⚠ Health degraded:', health.detail);
    }
  } catch (error) {
    console.error('✗ Health check failed:', error.message);
    failures++;
  }

  // Test 2: Model Support
  console.log('\n[2/5] Testing supports()...');
  const testModel = 'qwen3.8-max';
  const supportsModel = provider.supports(testModel);
  if (supportsModel) {
    console.log(`✓ Provider supports ${testModel}`);
  } else {
    console.error(`✗ Provider does not support ${testModel}`);
    failures++;
  }

  // Test 3: Model Description
  console.log('\n[3/5] Testing describe()...');
  const capabilities = provider.describe('qwen3.8-max');
  if (capabilities) {
    console.log('✓ Model capabilities:', {
      capabilities: capabilities.capabilities,
      contextWindow: capabilities.contextWindow,
      costPer1kInput: capabilities.costPer1kInputUsd,
      costPer1kOutput: capabilities.costPer1kOutputUsd,
    });
  } else {
    console.error('✗ Could not retrieve model capabilities');
    failures++;
  }

  // Test 4: Chat Completion
  console.log('\n[4/5] Testing generate()...');
  try {
    const controller = new AbortController();
    const response = await provider.generate(
      {
        model: 'qwen3.8-max',
        messages: [
          {
            role: 'system',
            content: [{ kind: 'text', text: 'You are a helpful assistant.' }],
          },
          {
            role: 'user',
            content: [{ kind: 'text', text: 'Say "test successful" and nothing else.' }],
          },
        ],
        temperature: 0.7,
        maxOutputTokens: 20,
      },
      controller.signal
    );

    if (response && (response.text || response.usage)) {
      console.log('✓ Generated response:', {
        text: response.text ? response.text.slice(0, 100) : '(empty)',
        usage: response.usage,
        latencyMs: response.latencyMs,
        finishReason: response.finishReason,
      });
    } else {
      console.error('✗ Invalid response structure');
      failures++;
    }
  } catch (error) {
    console.error('✗ Generate failed:', error.message);
    failures++;
  }

  // Test 5: Streaming
  console.log('\n[5/5] Testing stream()...');
  try {
    const controller = new AbortController();
    let chunks = 0;
    let finalUsage = null;

    for await (const chunk of provider.stream(
      {
        model: 'qwen3.8-max',
        messages: [
          {
            role: 'user',
            content: [{ kind: 'text', text: 'Count from 1 to 3.' }],
          },
        ],
        temperature: 0.7,
        maxOutputTokens: 50,
      },
      controller.signal
    )) {
      chunks++;
      if (chunk.done && chunk.usage) {
        finalUsage = chunk.usage;
      }
      // Don't log every chunk to keep output clean
    }

    if (chunks > 0) {
      console.log('✓ Streaming successful:', {
        totalChunks: chunks,
        finalUsage,
      });
    } else {
      console.error('✗ No chunks received');
      failures++;
    }
  } catch (error) {
    console.error('✗ Streaming failed:', error.message);
    failures++;
  }

  // Summary
  console.log('\n=== Test Summary ===');
  const passed = 5 - failures;
  console.log(`Passed: ${passed}/5`);
  console.log(`Failed: ${failures}/5`);

  if (failures > 0) {
    console.log('\n❌ Some tests failed');
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed');
    process.exit(0);
  }
}

main().catch((error) => {
  console.error('\n❌ Unhandled error:', error);
  process.exit(1);
});