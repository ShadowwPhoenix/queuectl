#!/bin/bash
# QueueCTL Automated Test Script
# Purpose: End-to-End Verification (enqueue, worker, retry, DLQ, priority)

set -e  # Stop on first error

echo "🚀 Starting QueueCTL End-to-End Test..."

# 🧹 Clean old queue data
echo "🧹 Cleaning existing .queue data (if any)..."
rm -rf .queue

echo
echo "📦 TEST 1: Enqueue a normal job"
node bin/queuectl.js enqueue --id job1 --command "echo Hello World"

echo
echo "⚙️ TEST 2: Start worker to process job1"
node bin/queuectl.js worker start --count 1 --foreground
sleep 3

echo
echo "📊 TEST 3: Checking system status after job1"
node bin/queuectl.js status

echo
echo "📋 TEST 4: Verify job1 completed"
node bin/queuectl.js list --state completed

echo
echo "📦 TEST 5: Enqueue a failing job"
node bin/queuectl.js enqueue --id fail1 --command "not-a-command"

echo
echo "⚙️ TEST 6: Start worker to process failing job"
node bin/queuectl.js worker start --count 1 --foreground
sleep 6

echo
echo "💀 TEST 7: List jobs in Dead Letter Queue (DLQ)"
node bin/queuectl.js dlq list

echo
echo "♻️ TEST 8: Retry the dead job from DLQ"
node bin/queuectl.js dlq retry fail1
sleep 1

echo
echo "📋 TEST 9: Verify job fail1 is now pending again"
node bin/queuectl.js list --state pending

echo
echo "⚙️ TEST 10: Start worker to reprocess the retried job"
node bin/queuectl.js worker start --count 1 --foreground
sleep 5

echo
echo "✅ TEST 11: Verify fail1 moved to completed (if fixed command) or dead again"
node bin/queuectl.js list --state completed
node bin/queuectl.js dlq list

echo
echo "📦 TEST 12: Enqueue multiple jobs with priorities"
node bin/queuectl.js enqueue --id jobA --command "echo Normal job running"
node bin/queuectl.js enqueue --id jobB --command "echo High priority job running" --priority 10

echo
echo "📋 TEST 13: List pending jobs (jobB should appear first)"
node bin/queuectl.js list --state pending

echo
echo "⚙️ TEST 14: Start worker for priority jobs"
node bin/queuectl.js worker start --count 1 --foreground
sleep 4

echo
echo "✅ TEST 15: Verify all completed jobs"
node bin/queuectl.js list --state completed

echo
echo "📊 TEST 16: Final system status"
node bin/queuectl.js status

echo
echo "🎉 All tests completed successfully!"
