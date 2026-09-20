import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PccCalculator } from '../src/safety/pcc-calculator.js';

describe('PccCalculator', () => {
  test('calculates standard Dual-WAN 1:1 ratio correctly', () => {
    const res = PccCalculator.calculate({
      wans: [
        { name: 'ISP1', weight: 1, gateway: '192.168.1.1' },
        { name: 'ISP2', weight: 1, gateway: '192.168.2.1' },
      ],
    });

    assert.equal(res.totalStreams, 2);
    assert.deepEqual(res.streamsPerWan['ISP1'], [0]);
    assert.deepEqual(res.streamsPerWan['ISP2'], [1]);
    assert.ok(res.script.includes('/routing table add name=to_ISP1 fib'));
    assert.ok(res.script.includes('per-connection-classifier=both-addresses-and-ports:2/0'));
    assert.ok(res.script.includes('per-connection-classifier=both-addresses-and-ports:2/1'));
  });

  test('calculates asymmetric 3-WAN with 100M:50M:50M bandwidth ratio (2:1:1)', () => {
    const res = PccCalculator.calculate({
      wans: [
        { name: 'ISP1', weight: 100, gateway: '192.168.1.1' },
        { name: 'ISP2', weight: 50, gateway: '192.168.2.1' },
        { name: 'ISP3', weight: 50, gateway: '192.168.3.1' },
      ],
      lanInterface: 'bridge-lan',
    });

    assert.equal(res.totalStreams, 4); // 2 + 1 + 1
    assert.deepEqual(res.streamsPerWan['ISP1'], [0, 1]);
    assert.deepEqual(res.streamsPerWan['ISP2'], [2]);
    assert.deepEqual(res.streamsPerWan['ISP3'], [3]);
    assert.ok(res.script.includes('per-connection-classifier=both-addresses-and-ports:4/0'));
    assert.ok(res.script.includes('per-connection-classifier=both-addresses-and-ports:4/1'));
    assert.ok(res.script.includes('per-connection-classifier=both-addresses-and-ports:4/2'));
    assert.ok(res.script.includes('per-connection-classifier=both-addresses-and-ports:4/3'));
  });

  test('enforces strict Mangle hierarchy with bypass rules at the beginning', () => {
    const res = PccCalculator.calculate({
      wans: [
        { name: 'ISP1', weight: 1 },
        { name: 'ISP2', weight: 1 },
      ],
    });

    const bypassDstnatIndex = res.script.indexOf('connection-nat-state=dstnat');
    const pccStreamIndex = res.script.indexOf('per-connection-classifier');

    assert.ok(bypassDstnatIndex > -1);
    assert.ok(pccStreamIndex > -1);
    assert.ok(bypassDstnatIndex < pccStreamIndex, 'Bypass DSTNAT must appear before PCC stream classification');
  });
});
