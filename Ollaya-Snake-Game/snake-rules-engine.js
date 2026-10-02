(function () {
  if (!window.SnakeCalculations) throw new Error('snake-calculations.js must load before snake-rules-engine.js');
  window.SnakeRulesEngine = {
    choose: (...args) => window.SnakeCalculations.choose(...args),
    safeDirections: (...args) => window.SnakeCalculations.safeDirections(...args),
     buildInput: (...args) => window.SnakeCalculations.buildInput(...args),
     buildDecisionState: (...args) => window.SnakeCalculations.buildDecisionState(...args),
     updateTurnState: (...args) => window.SnakeCalculations.updateTurnState(...args),
     startBorderCircuit: (...args) => window.SnakeCalculations.startBorderCircuit(...args)
  };
})();
