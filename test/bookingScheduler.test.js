const test = require('node:test');
const assert = require('node:assert/strict');
const { startBookingScheduler } = require('../src/utils/bookingScheduler');

test('scheduler runs the expiration service directly every six minutes', async () => {
  let scheduledCallback;
  let calls = 0;
  const task = { stop() {} };

  const result = startBookingScheduler({
    schedule(expression, callback) {
      assert.equal(expression, '*/6 * * * *');
      scheduledCallback = callback;
      return task;
    },
    async expire() {
      calls += 1;
      return { expiredCount: 1, cancelledCount: 1, errors: [] };
    },
  });

  assert.equal(result, task);
  await scheduledCallback();
  assert.equal(calls, 1);
});
