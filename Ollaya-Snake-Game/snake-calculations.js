(function () {
  const vectors = { UP: { x: 0, y: -1 }, DOWN: { x: 0, y: 1 }, LEFT: { x: -1, y: 0 }, RIGHT: { x: 1, y: 0 } };
  const opposites = { UP: 'DOWN', DOWN: 'UP', LEFT: 'RIGHT', RIGHT: 'LEFT' };
  const cellKey = (cell) => `${cell.x},${cell.y}`;
  const nextCell = (head, direction) => ({ x: head.x + vectors[direction].x, y: head.y + vectors[direction].y });
  const inside = (cell, grid) => cell.x >= 0 && cell.x < grid && cell.y >= 0 && cell.y < grid;
  const contains = (body, cell) => body.some(part => part.x === cell.x && part.y === cell.y);

  function project(state, direction) {
    const next = nextCell(state.snake[0], direction);
    const grows = next.x === state.food.x && next.y === state.food.y;
    return { next, body: [next, ...state.snake.slice(0, grows ? state.snake.length : -1)], grows };
  }

  function safeDirections(state) {
    const safety = state.rules.safety || {};
    return Object.keys(vectors).filter(direction => {
      if (direction === opposites[state.direction]) return false;
      const next = nextCell(state.snake[0], direction);
      return (safety.avoidWall !== false ? inside(next, state.grid) : true) && (safety.avoidBody !== false ? !contains(state.snake, next) : true);
    });
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

  function regionStats(start, body, grid, depth) {
    const visited = floodFill(start, body, grid, depth);
    const exits = Object.keys(vectors).filter(direction => {
      const next = nextCell(start, direction);
      return inside(next, grid) && !contains(body.slice(1), next);
    }).length;
    return { reachable: visited.size, dominantRegion: visited.size, exits };
  }

  function distanceToFood(cell, food) { return Math.abs(food.x - cell.x) + Math.abs(food.y - cell.y); }
  function borderDistance(state, cell) { return Math.min(cell.x, cell.y, state.grid - 1 - cell.x, state.grid - 1 - cell.y); }

  function scoreMove(state, direction) {
    const planner = state.rules.planner || {};
    const safety = state.rules.safety || {};
    const projected = project(state, direction);
    const depth = Math.max(1, Number(planner.lookaheadDepth) || state.grid * state.grid);
    const stats = regionStats(projected.next, projected.body, state.grid, depth);
    const currentDistance = distanceToFood(state.snake[0], state.food);
    const foodGain = currentDistance - distanceToFood(projected.next, state.food);
    const currentSpace = floodFill(state.snake[0], state.snake, state.grid, depth).size;
    let score = foodGain * (planner.foodWeight || 0);
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
    return { direction, score, foodGain, ...stats };
  }

  function choose(state, preferred) {
    const candidates = safeDirections(state);
    if (!candidates.length) return { direction: state.direction, candidates: [], freedom: 0, rationale: 'no safe route' };
    const ranked = candidates.map(direction => scoreMove(state, direction)).sort((a, b) => b.score - a.score || (a.direction === preferred ? -1 : b.direction === preferred ? 1 : b.foodGain - a.foodGain));
    const winner = ranked[0];
    return { direction: winner.direction, candidates: ranked, freedom: winner.reachable, rationale: `score ${Math.round(winner.score)} · food ${winner.foodGain >= 0 ? '+' : ''}${winner.foodGain} · region ${winner.dominantRegion} · exits ${winner.exits}` };
  }

  function buildInput(state, preferred) {
    const result = choose(state, preferred);
    return { rulesVersion: state.rules.version, board: { grid: state.grid, head: state.snake[0], food: state.food, bodyLength: state.snake.length }, preferred, safeDirections: safeDirections(state), rankedMoves: result.candidates, selected: result.direction, rationale: result.rationale };
  }

  const source = [
    'const vectors = ' + JSON.stringify(vectors) + ';',
    'const opposites = ' + JSON.stringify(opposites) + ';',
    'const cellKey = ' + cellKey.toString() + ';',
    'const nextCell = ' + nextCell.toString() + ';',
    'const inside = ' + inside.toString() + ';',
    'const contains = ' + contains.toString() + ';',
    project, safeDirections, floodFill, regionStats, distanceToFood, borderDistance, scoreMove, choose, buildInput,
    'return { choose, safeDirections, buildInput };'
  ].map(part => typeof part === 'string' ? part : part.toString()).join('\n\n');
  window.SnakeCalculations = { VERSION: '1.0.0', choose, safeDirections, buildInput, source };
})();
