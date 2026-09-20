import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { OpenApiGenerator } from '../src/server/openapi.js';

describe('OpenApiGenerator', () => {
  test('generates valid OpenAPI 3.1.0 schema for pure knowledge service', () => {
    const spec = OpenApiGenerator.getSpecification('https://test-mcp.vercel.app');
    assert.equal(spec.openapi, '3.1.0');
    assert.ok(spec.info && typeof spec.info === 'object');
    assert.equal((spec.info as { title: string }).title, 'MikroTik RouterOS v7 Certified Knowledge & Intelligence API');
  });

  test('includes zero-credential knowledge operations for ChatGPT actions', () => {
    const spec = OpenApiGenerator.getSpecification();
    const paths = spec.paths as Record<string, Record<string, unknown>>;
    assert.ok(paths['/api/v1/knowledge/tracks']);
    assert.ok(paths['/api/v1/knowledge/template']);
    assert.ok(paths['/api/v1/knowledge/validate']);
    assert.ok(paths['/api/v1/knowledge/sanitize']);
    assert.ok(paths['/api/v1/knowledge/prompt']);
    assert.ok(paths['/api/v1/knowledge/pcc']);
    assert.ok(paths['/api/v1/knowledge/wireguard']);
    assert.ok(paths['/api/v1/knowledge/migrate-filter']);
    assert.ok(paths['/api/v1/knowledge/lint']);
  });
});
