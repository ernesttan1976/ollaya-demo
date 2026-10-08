(function () {
  const vectors = { UP: { x: 0, y: -1 }, DOWN: { x: 0, y: 1 }, LEFT: { x: -1, y: 0 }, RIGHT: { x: 1, y: 0 } };
  const opposites = { UP: 'DOWN', DOWN: 'UP', LEFT: 'RIGHT', RIGHT: 'LEFT' };
  const turnDelta = {
    LEFT: { DOWN: -1, UP: 1 },
    DOWN: { RIGHT: -1, LEFT: 1 },
    RIGHT: { UP: -1, DOWN: 1 },
    UP: { LEFT: -1, RIGHT: 1 }
  };
  const cycleOrder = {
    clockwise: ['UP', 'RIGHT', 'DOWN', 'LEFT'],
    counterclockwise: ['UP', 'LEFT', 'DOWN', 'RIGHT']
  };
  const cellKey = (cell) => `${cell.x},${cell.y}`;
  const nextCell = (head, direction) => ({ x: head.x + vectors[direction].x, y: head.y + vectors[direction].y });
  const inside = (cell, grid) => cell.x >= 0 && cell.x < grid && cell.y >= 0 && cell.y < grid;
  const contains = (body, cell) => body.some(part => part.x === cell.x && part.y === cell.y);

  function updateTurnState(state, direction) {
    if (state._lastScore == null) state._lastScore = state.score;
    const reachableCells = floodFill(state.snake[0], state.snake, state.grid).size;
    if (Number(state.tick) === 0 || !Number.isFinite(state._lastReachableCells)) {
      state.spaceDeclineSteps = 0;
      state.spaceTrend = 0;
    } else {
      state.spaceTrend = reachableCells - state._lastReachableCells;
      state.spaceDeclineSteps = reachableCells < state._lastReachableCells
        ? (Number(state.spaceDeclineSteps) || 0) + 1
        : 0;
    }
    state._lastReachableCells = reachableCells;
    const previous = state.direction;
    if (previous !== direction) state.cw = (Number(state.cw) || 0) + (turnDelta[previous]?.[direction] || 0);
    state.previousDirection = previous;
    state.direction = direction;
    return state.cw;
  }

  function projectedCw(state, direction) {
    return (Number(state.cw) || 0) + (turnDelta[state.direction]?.[direction] || 0);
  }

  function project(state, direction) {
    const next = nextCell(state.snake[0], direction);
    const grows = next.x === state.food.x && next.y === state.food.y;
    return { next, body: [next, ...state.snake.slice(0, grows ? state.snake.length : -1)], grows };
  }

  function safeDirections(state) {
    const safety = state.rules.safety || {};
    const legal = Object.keys(vectors).filter(direction => {
      if (direction === opposites[state.direction]) return false;
      const next = nextCell(state.snake[0], direction);
      return (safety.avoidWall !== false ? inside(next, state.grid) : true) && (safety.avoidBody !== false ? !contains(state.snake, next) : true);
    });
    if (!legal.length) return legal;

    const measured = legal.map(direction => {
      const projected = project(state, direction);
      return {
        direction,
        reachable: floodFill(projected.next, projected.body, state.grid).size,
        minimumReachable: minimumReachableSpace(state, projected.body.length)
      };
    });
    const spaceSafe = measured.filter(move => move.reachable >= move.minimumReachable);
    if (spaceSafe.length) return spaceSafe.map(move => move.direction);

    // If the target is impossible this turn, keep the option(s) that preserve
    // the largest connected open region instead of returning no moves.
    const largestRegion = Math.max(...measured.map(move => move.reachable));
    return measured.filter(move => move.reachable === largestRegion).map(move => move.direction);
  }

  function floodFill(start, body, grid, maxDepth = Infinity) {
    const blocked = new Set(body.slice(1).map(cellKey));
    const visited = new Set([cellKey(start)]);
    const queue = [{ cell: start, depth: 0 }];
    while (queue.length) {
      const { cell, depth } = queue.shift();
      if (depth >= maxDepth) continue;
      Object.keys(vectors).forEach(direction => {
        const next = nextCell(cell, direction);
        const key = cellKey(next);
        if (inside(next, grid) && !blocked.has(key) && !visited.has(key)) { visited.add(key); queue.push({ cell: next, depth: depth + 1 }); }
      });
    }
    return visited;
  }

  function minimumReachableSpaceRatio(state) {
    const configuredRatio = Number(state.rules?.planner?.minimumReachableSpaceRatio);
    return Number.isFinite(configuredRatio) ? Math.max(1, configuredRatio) : 1.5;
  }

  function minimumReachableSpace(state, snakeLength) {
    return Math.ceil(snakeLength * minimumReachableSpaceRatio(state));
  }

  function regionStats(start, body, grid, depth) {
    const visited = floodFill(start, body, grid, depth);
    const exits = Object.keys(vectors).filter(direction => {
      const next = nextCell(start, direction);
      return inside(next, grid) && !contains(body.slice(1), next);
    }).length;
    return { reachable: visited.size, dominantRegion: visited.size, exits };
  }

  function futureTurnOptions(head, body, grid, direction) {
    return Object.keys(vectors).filter(candidate => {
      if (candidate === opposites[direction]) return false;
      const next = nextCell(head, candidate);
      return inside(next, grid) && !contains(body, next);
    }).length;
  }

  function distanceToFood(cell, food) { return Math.abs(food.x - cell.x) + Math.abs(food.y - cell.y); }
  function borderDistance(state, cell) { return Math.min(cell.x, cell.y, state.grid - 1 - cell.x, state.grid - 1 - cell.y); }

  function oppositeCycleDirection(state, legalDirections) {
    const order = cycleOrder[state.cycleWinding === 'counterclockwise' ? 'counterclockwise' : 'clockwise'];
    const currentIndex = order.indexOf(String(state.direction || '').toUpperCase());
    if (currentIndex < 0) return legalDirections[0] || '';
    const opposite = order[(currentIndex - 1 + order.length) % order.length];
    return legalDirections.includes(opposite) ? opposite : legalDirections[0] || '';
  }

  const borderDirections = { TOP: 'RIGHT', RIGHT: 'DOWN', BOTTOM: 'LEFT', LEFT: 'UP' };
  const clockwiseSide = { TOP: 'RIGHT', RIGHT: 'BOTTOM', BOTTOM: 'LEFT', LEFT: 'TOP' };
  function nearestBorderSide(state) {
    const head = state.snake[0];
    const distances = { TOP: head.y, RIGHT: state.grid - 1 - head.x, BOTTOM: state.grid - 1 - head.y, LEFT: head.x };
    return Object.keys(distances).sort((a, b) => distances[a] - distances[b])[0];
  }

  function startBorderCircuit(state) {
    const wallLength = Math.max(1, 4 * (state.grid - 1));
    return { active: true, phase: 'to_border', targetSide: nearestBorderSide(state), currentSide: null, sidesTraversed: 0, wallSteps: 0, wallLengthsCompleted: 0, wallTargetSteps: wallLength * 2 };
  }

  function isOnBorder(cell, grid) {
    return cell.x === 0 || cell.y === 0 || cell.x === grid - 1 || cell.y === grid - 1;
  }

  // A score increase is the single source of truth for entering cycle mode.
  function advanceBorderProgress(state, previousHead) {
    if (state._lastScore == null) state._lastScore = state.score;
    if (Number(state.score) > Number(state._lastScore)) {
      state.activeMode = 'cycle';
      state.cycleSteps = 0;
      state.cycleLockUntil = 0;
    }
    state._lastScore = state.score;
    const route = state.borderCircuit;
    if (!route?.active || route.phase !== 'border_route' || !previousHead) return route;
    const head = state.snake[0];
    if (isOnBorder(previousHead, state.grid) && isOnBorder(head, state.grid) && (head.x !== previousHead.x || head.y !== previousHead.y)) {
      route.wallSteps = (route.wallSteps || 0) + 1;
      const wallLength = Math.max(1, 4 * (state.grid - 1));
      route.wallLengthsCompleted = Math.floor(route.wallSteps / wallLength);
      if (route.wallSteps >= (route.wallTargetSteps || wallLength * 2)) {
        route.active = false;
        route.phase = 'seeking_food';
      }
    }
    return route;
  }

  function borderSide(cell, grid, fallback) {
    if (fallback === 'TOP' && cell.y === 0) return 'TOP';
    if (fallback === 'RIGHT' && cell.x === grid - 1) return 'RIGHT';
    if (fallback === 'BOTTOM' && cell.y === grid - 1) return 'BOTTOM';
    if (fallback === 'LEFT' && cell.x === 0) return 'LEFT';
    if (cell.y === 0) return 'TOP';
    if (cell.x === grid - 1) return 'RIGHT';
    if (cell.y === grid - 1) return 'BOTTOM';
    if (cell.x === 0) return 'LEFT';
    return null;
  }

  function borderCircuitPreferred(state, preferred) {
    const route = state.borderCircuit;
    if (!route?.active) return { direction: preferred, route };
    const head = state.snake[0];
    const side = borderSide(head, state.grid, route.currentSide || route.targetSide);
    if (route.phase === 'to_border') {
      if (side) {
        route.phase = 'border_route';
        route.currentSide = side;
        route.sidesTraversed = 0;
      } else {
        const target = route.targetSide;
        const direction = target === 'TOP' ? 'UP' : target === 'RIGHT' ? 'RIGHT' : target === 'BOTTOM' ? 'DOWN' : 'LEFT';
        return { direction, route };
      }
    }
    const currentSide = route.currentSide || side;
    const atEnd = (currentSide === 'TOP' && head.x === state.grid - 1) ||
      (currentSide === 'RIGHT' && head.y === state.grid - 1) ||
      (currentSide === 'BOTTOM' && head.x === 0) ||
      (currentSide === 'LEFT' && head.y === 0);
    if (atEnd) {
      route.sidesTraversed += 1;
      route.currentSide = clockwiseSide[currentSide];
    }
    const direction = borderDirections[route.currentSide];
    if (!safeDirections(state).includes(direction)) {
      route.active = false;
      route.phase = 'seeking_food';
      route.currentSide = null;
      return { direction: preferred, route };
    }
    return { direction, route };
  }

  function scoreMove(state, direction) {
    const planner = state.rules.planner || {};
    const safety = state.rules.safety || {};
    const projected = project(state, direction);
    // Space safety needs the whole connected region; this depth is independent
    // of how many future game moves a planner might simulate.
    const stats = regionStats(projected.next, projected.body, state.grid);
    const currentSpace = floodFill(state.snake[0], state.snake, state.grid).size;
    const minimumReachable = minimumReachableSpace(state, projected.body.length);
    const spaceSafe = stats.reachable >= minimumReachable;
    const currentDistance = distanceToFood(state.snake[0], state.food);
    const foodDistanceAfter = distanceToFood(projected.next, state.food);
    const foodGain = currentDistance - foodDistanceAfter;
    const foodPriorityWeight = Math.max(Number(planner.foodWeight) || 0, Number(planner.foodPriorityWeight) || 220);
    let score = foodGain * foodPriorityWeight;
    score += stats.reachable * (planner.freedomWeight || 0);
    score += stats.dominantRegion * (planner.contiguousRegionWeight || 0);
    if (planner.spaceWeight) score += stats.reachable * planner.spaceWeight;
    if (safety.preferMovesWithMoreReachableSpace && stats.reachable < currentSpace) score -= (planner.enclosureRiskWeight || 0);
    if (safety.preferMovesIntoLargerContiguousRegion && stats.dominantRegion < currentSpace) score -= (planner.trapPenalty || 0);
    if ((safety.detectDeadEnds || safety.rejectMovesThatLeaveOnlyOneForcedContinuation) && stats.exits <= 1) score -= (planner.trapPenalty || 0);
    if (safety.preferMovesWithAtLeastTwoFutureTurnOptions && stats.exits < 2) score -= (planner.escapeRouteWeight || 0);
    if (safety.requireEscapeRouteAfterFood && projected.grows && stats.exits < 2) score -= (planner.escapeRouteWeight || 0);
    if (safety.avoidFragmentedReachableSpace && stats.dominantRegion < state.snake.length) score -= (planner.enclosureRiskWeight || 0);
    if (safety.avoidMovesThatReduceReachableSpaceBelowCurrentLength && stats.reachable < state.snake.length) score -= (planner.trapPenalty || 0);
    if (safety.avoidMovesThatShrinkTheLargestContiguousRegion && stats.dominantRegion < currentSpace) score -= (planner.contiguousRegionWeight || 0);
    if (safety.whenNoGoodChoicePreferOpenArea && currentSpace < (safety.minimumReachableSpace || 0)) score += stats.reachable * (planner.escapeRouteWeight || 0);
    if (safety.detectEnclosure && stats.reachable < (safety.minimumReachableSpace || 0)) score -= (planner.enclosureRiskWeight || 0);
    if (safety.detectSelfBoxIn && stats.reachable < (safety.emergencyMinimumReachableSpace || 0)) score -= (planner.trapPenalty || 0);
    if (safety.reserveOneCellOfLateralEscapeNearEachBorder && borderDistance(state, projected.next) <= 1 && stats.exits < 2) score -= (planner.reservedEscapeCorridorWeight || 0);
    if (safety.preserveTailAccess && projected.body.length > 1 && !contains(projected.body.slice(1), state.snake[state.snake.length - 1])) score += (planner.tailAccessWeight || 0);
    const distanceFromBorder = borderDistance(state, projected.next);
    if (planner.borderBufferWeight) score += distanceFromBorder * planner.borderBufferWeight;
    if (planner.borderApproachPenalty && distanceFromBorder === 0) score -= planner.borderApproachPenalty;
    return {
      direction, score, foodGain, foodDistanceAfter, towardFood: foodGain > 0, foodPriorityWeight,
      spaceSafe, minimumReachableCells: minimumReachable, spaceMargin: stats.reachable - projected.body.length,
      ...stats
    };
  }

  function choose(state, preferred) {
    const candidates = safeDirections(state);
    if (!candidates.length) return { direction: state.direction, candidates: [], freedom: 0, rationale: 'no safe route' };
    const ranked = candidates.map(direction => scoreMove(state, direction)).sort((a, b) => {
      if (a.spaceSafe !== b.spaceSafe) return Number(b.spaceSafe) - Number(a.spaceSafe);
      if (!a.spaceSafe && a.reachable !== b.reachable) return b.reachable - a.reachable;
      if (a.score !== b.score) return b.score - a.score;
      return Number(b.direction === preferred) - Number(a.direction === preferred);
    });
    const winner = ranked[0];
    return { direction: winner.direction, candidates: ranked, freedom: winner.reachable, rationale: `food ${winner.foodGain >= 0 ? '+' : ''}${winner.foodGain} · region ${winner.dominantRegion} · exits ${winner.exits} · space ${winner.reachable}/${winner.minimumReachableCells}` };
  }

  function buildDecisionState(state, preferred) {
    const legalDirections = safeDirections(state);
    const head = state.snake[0];
    const tail = state.snake[state.snake.length - 1];
    const boardCells = state.grid * state.grid;
    const currentRegion = floodFill(head, state.snake, state.grid);
    const foodDistance = distanceToFood(head, state.food);
    const minimumCurrentSpace = minimumReachableSpace(state, state.snake.length);
    const moves = Object.fromEntries(legalDirections.map(direction => {
      const projected = project(state, direction);
      const stats = regionStats(projected.next, projected.body, state.grid);
      const reachable = floodFill(projected.next, projected.body, state.grid);
      const tailReachable = reachable.has(cellKey(projected.body[projected.body.length - 1] || tail));
      const foodDistanceAfter = distanceToFood(projected.next, state.food);
      return [direction.toLowerCase(), {
        food_distance: foodDistanceAfter,
        space_ratio: Number((reachable.size / boardCells).toFixed(3)),
        reachable_cells: reachable.size,
        space_target_cells: minimumReachableSpace(state, projected.body.length),
        space_margin: reachable.size - projected.body.length,
        space_safe: reachable.size >= minimumReachableSpace(state, projected.body.length),
        tail_reachable: tailReachable,
        escape_routes: stats.exits,
        dead_end: stats.exits <= 1
      }];
    }));
    const moveValues = Object.values(moves);
    const space = Number((currentRegion.size / boardCells).toFixed(3));
    const escapeRoutes = regionStats(head, state.snake, state.grid).exits;
    const bestFoodMove = moveValues.filter(move => move.space_safe).slice().sort((a, b) => a.food_distance - b.food_distance)[0];
    const foodSafe = Boolean(bestFoodMove && bestFoodMove.escape_routes >= 2 && !bestFoodMove.dead_end);
    const tailSafe = moveValues.some(move => move.tail_reachable && move.space_safe);
    const spaceShortfall = Math.max(0, (minimumCurrentSpace - currentRegion.size) / minimumCurrentSpace);
    const spaceEscapeTrigger = state.snake.length > 30 && Number(state.spaceDeclineSteps) >= 16;
    const spacePressure = Number(Math.min(1, Math.max(spaceEscapeTrigger ? 0.7 : 0, (1 - space) + Math.max(0, 2 - escapeRoutes) * 0.2, spaceShortfall)).toFixed(3));
    const spaceModeThreshold = 0.7;
    const spaceMode = spacePressure >= spaceModeThreshold;
    const spaceDirection = spaceMode ? oppositeCycleDirection(state, legalDirections) : '';
    if (spaceDirection) Object.entries(moves).forEach(([direction, move]) => { move.space_ratio = direction.toUpperCase() === spaceDirection ? 1 : 0; });
    return {
      snake: { length: state.snake.length },
      planning: { minimum_reachable_space_ratio: minimumReachableSpaceRatio(state), minimum_reachable_cells: minimumCurrentSpace },
      food: { safe: foodSafe, distance: foodDistance },
      tactical: {
        space,
        space_trend: Number(state.spaceTrend || 0),
        space_decline_steps: Number(state.spaceDeclineSteps || 0),
        space_escape_trigger: spaceEscapeTrigger,
        escape_routes: escapeRoutes,
        escape_trend: Number(state.escapeTrend || 0),
        pressure: spacePressure,
        space_mode: spaceMode,
        space_mode_threshold: spaceModeThreshold,
        space_direction: spaceDirection,
        tail_reachable: tailSafe,
        cycle_safe: legalDirections.length > 0,
        trap_risk: Number(Math.min(1, spacePressure + (escapeRoutes <= 1 ? 0.35 : 0)).toFixed(3))
      },
      moves
    };
  }

  function buildInput(state, preferred) {
    const legalDirections = safeDirections(state);
    const requestedPreferredDirection = preferred;
    const routeChoice = borderCircuitPreferred(state, preferred);
    const effectivePreferredDirection = routeChoice.direction;
    const preferredCell = nextCell(state.snake[0], effectivePreferredDirection);
    const preferredBlocked = !inside(preferredCell, state.grid) || contains(state.snake, preferredCell) || effectivePreferredDirection === opposites[state.direction] || !legalDirections.includes(effectivePreferredDirection);
    const projectedCwByDirection = Object.fromEntries(legalDirections.map(direction => [direction, projectedCw(state, direction)]));
    const selfTurningDirections = legalDirections.filter(direction => Math.abs(projectedCwByDirection[direction]) >= 3);
    const preferredTurnsIn = selfTurningDirections.includes(effectivePreferredDirection);
    const obstacleAhead = preferredBlocked;
    // Wall routing is still food-seeking from Ollaya's mode perspective;
    // route progress is carried separately so it does not inflate space mode.
    const mode = 'food';
    return {
      routePhase: routeChoice.route?.active ? routeChoice.route.phase : 'seeking_food',
      borderSide: routeChoice.route?.active ? routeChoice.route.currentSide || routeChoice.route.targetSide : null,
       sidesRemaining: routeChoice.route?.active ? Math.max(0, 3 - routeChoice.route.sidesTraversed) : 0,
       wallLengthsCompleted: routeChoice.route?.active ? (routeChoice.route.wallLengthsCompleted || 0) : 0,
       wallLengthsRemaining: routeChoice.route?.active ? Math.max(0, 2 - (routeChoice.route.wallLengthsCompleted || 0)) : 0,
      mode,
      requestedPreferredDirection,
      preferredDirection: effectivePreferredDirection,
      obstacleAhead,
       legalDirections,
       alternateDirections: legalDirections.filter(direction => direction !== preferred),
       cw: Number(state.cw) || 0,
      projectedCwByDirection,
      selfTurningDirections,
       avoidSelfTurning: selfTurningDirections.length > 0,
       preferredTurnsIn,
        instruction: obstacleAhead
          ? 'The preferred direction is obstructed; choose a legal alternate direction.'
          : `Follow the preferred direction ${effectivePreferredDirection} toward food.`
         };
  }

  const source = [
    'const vectors = ' + JSON.stringify(vectors) + ';',
     'const opposites = ' + JSON.stringify(opposites) + ';',
     'const turnDelta = ' + JSON.stringify(turnDelta) + ';',
     'const cycleOrder = ' + JSON.stringify(cycleOrder) + ';',
     'const borderDirections = ' + JSON.stringify(borderDirections) + ';',
     'const clockwiseSide = ' + JSON.stringify(clockwiseSide) + ';',
    'const cellKey = ' + cellKey.toString() + ';',
    'const nextCell = ' + nextCell.toString() + ';',
    'const inside = ' + inside.toString() + ';',
    'const contains = ' + contains.toString() + ';',
              updateTurnState, projectedCw, project, safeDirections, floodFill, minimumReachableSpaceRatio, minimumReachableSpace, regionStats, futureTurnOptions, distanceToFood, borderDistance, oppositeCycleDirection, nearestBorderSide, startBorderCircuit, isOnBorder, advanceBorderProgress, borderCircuitPreferred, scoreMove, choose, buildDecisionState, buildInput,
        'return { choose, safeDirections, buildInput, buildDecisionState, updateTurnState, startBorderCircuit, advanceBorderProgress };'
  ].map(part => typeof part === 'string' ? part : part.toString()).join('\n\n');
   window.SnakeCalculations = { VERSION: '1.0.0', choose, safeDirections, buildInput, buildDecisionState, updateTurnState, startBorderCircuit, advanceBorderProgress, source };
})();
