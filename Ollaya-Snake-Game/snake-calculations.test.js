const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'snake-calculations.js'), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox);
const calculations = sandbox.window.SnakeCalculations;

function makeState(overrides = {}) {
  return {
    grid: 8,
    snake: [{ x: 3, y: 3 }, { x: 2, y: 3 }, { x: 1, y: 3 }],
    food: { x: 7, y: 7 },
    direction: 'RIGHT',
    rules: {
      planner: { minimumReachableSpaceRatio: 1.5 },
      safety: { avoidWall: true, avoidBody: true }
    },
    ...overrides
  };
}

test('space estimates flood-fill the full connected region, independent of lookaheadDepth', () => {
  const state = makeState({
    rules: {
      planner: { lookaheadDepth: 1, minimumReachableSpaceRatio: 1.5 },
      safety: { avoidWall: true, avoidBody: true }
    }
  });

  const result = calculations.choose(state, 'RIGHT');

  assert.ok(result.candidates.length > 0);
  assert.ok(result.candidates.every(candidate => candidate.reachable > 10));
  assert.ok(result.candidates.every(candidate => candidate.spaceSafe));
});

test('editable calculations source includes the space-safety helpers', () => {
  const activated = new Function(calculations.source)();
  const result = activated.choose(makeState(), 'RIGHT');

  assert.ok(result.candidates.length > 0);
  assert.ok(result.candidates.every(candidate => candidate.spaceSafe));
});

test('space target uses projected snake length when a move eats food', () => {
  const state = makeState({ food: { x: 4, y: 3 } });
  const decision = calculations.buildDecisionState(state, 'RIGHT');

  assert.equal(decision.moves.right.space_target_cells, 6);
  assert.equal(decision.moves.right.space_margin, decision.moves.right.reachable_cells - 4);
  assert.equal(decision.moves.right.space_safe, true);
});

test('when every move misses the target, only moves preserving the most space remain', () => {
  const baseline = calculations.buildDecisionState(makeState(), 'RIGHT');
  const baselineReachable = Object.fromEntries(
    Object.entries(baseline.moves).map(([direction, move]) => [direction, move.reachable_cells])
  );
  const largestRegion = Math.max(...Object.values(baselineReachable));
  const restrictive = calculations.buildDecisionState(makeState({
    rules: {
      planner: { minimumReachableSpaceRatio: 100 },
      safety: { avoidWall: true, avoidBody: true }
    }
  }), 'RIGHT');

  assert.ok(Object.keys(restrictive.moves).length > 0);
  assert.ok(Object.values(restrictive.moves).every(move => move.reachable_cells === largestRegion));
  assert.ok(Object.values(restrictive.moves).every(move => move.space_safe === false));
});

test('turn tracking counts only consecutive decreases in flood-fill space', () => {
  const state = makeState({ snake: [{ x: 3, y: 3 }], tick: 0 });
  calculations.updateTurnState(state, 'RIGHT');

  for (let step = 1; step <= 16; step++) {
    state.snake.push({ x: (step - 1) % 8, y: Math.floor((step - 1) / 8) });
    state.tick = step;
    calculations.updateTurnState(state, 'RIGHT');
    assert.equal(state.spaceDeclineSteps, step);
  }

  state.snake.pop();
  state.tick = 17;
  calculations.updateTurnState(state, 'RIGHT');
  assert.equal(state.spaceDeclineSteps, 0);
});

test('a long snake with 16 consecutive space declines triggers escape pressure', () => {
  const longSnake = [
    { x: 3, y: 3 },
    ...Array.from({ length: 30 }, () => ({ x: 2, y: 3 }))
  ];
  const decision = calculations.buildDecisionState(makeState({
    snake: longSnake,
    spaceDeclineSteps: 16
  }), 'UP');

  assert.equal(decision.tactical.space_escape_trigger, true);
  assert.equal(decision.tactical.pressure >= 0.7, true);
  assert.equal(decision.tactical.space_mode, true);
});

test('space decline escape pressure requires both a long snake and 16 declining steps', () => {
  const shortSnake = calculations.buildDecisionState(makeState({
    snake: Array.from({ length: 30 }, () => ({ x: 2, y: 3 })),
    spaceDeclineSteps: 16
  }), 'UP');
  const earlyTrend = calculations.buildDecisionState(makeState({
    snake: Array.from({ length: 31 }, () => ({ x: 2, y: 3 })),
    spaceDeclineSteps: 15
  }), 'UP');

  assert.equal(shortSnake.tactical.space_escape_trigger, false);
  assert.equal(earlyTrend.tactical.space_escape_trigger, false);
});

test('safe moves keep the head one cell away from a wall whenever possible', () => {
  const state = makeState({
    snake: [{ x: 2, y: 1 }, { x: 2, y: 2 }, { x: 2, y: 3 }],
    direction: 'UP'
  });

  assert.deepEqual(Array.from(calculations.safeDirections(state)), ['LEFT', 'RIGHT']);
});

test('the wall buffer yields when every available safe move is beside a wall', () => {
  const state = makeState({
    snake: [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }],
    direction: 'LEFT'
  });

  assert.deepEqual(Array.from(calculations.safeDirections(state)), ['UP', 'LEFT']);
});
