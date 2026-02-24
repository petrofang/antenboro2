import { CONFIG } from './config.js';
import { World } from './world.js';
import { Colony } from './colony.js';

/**
 * Central simulation engine.
 * Manages world, both colonies, and fixed-timestep updates.
 */
export class SimulationEngine {
  constructor() {
    this.world = new World();
    this.playerColony = new Colony(0, CONFIG.PLAYER_COLONY_NEST_X, CONFIG.PLAYER_COLONY_NEST_Y);
    this.enemyColony = new Colony(1, CONFIG.ENEMY_COLONY_NEST_X, CONFIG.ENEMY_COLONY_NEST_Y);
    
    this.playerAnt = null;         // Hero ant (player-controlled)
    this.tick = 0;
    this.speedLevel = 0;           // Index into CONFIG.SPEED_LEVELS
    this.isRunning = true;
    this.isPaused = false;
    
    this.gameOver = false;
    this.victoryState = null;      // null, 'WON', 'LOST'
  }

  /**
   * Set the player ant (called after player creation).
   */
  setPlayerAnt(ant) {
    this.playerAnt = ant;
  }

  /**
   * Update simulation by one tick.
   * Called from fixed-timestep accumulator.
   */
  updateTick() {
    if (this.gameOver || this.isPaused) return;

    // Update world
    this.world.update();

    // Update colonies
    this.playerColony.update(this.world, this.enemyColony);
    this.enemyColony.update(this.world, this.playerColony);

    // Check win/lose conditions
    if (this.playerColony.queen && this.playerColony.queen.isDead && !this.gameOver) {
      this.gameOver = true;
      this.victoryState = 'LOST';
    }
    if (this.enemyColony.queen && this.enemyColony.queen.isDead && !this.gameOver) {
      this.gameOver = true;
      this.victoryState = 'WON';
    }

    this.tick++;
  }

  /**
   * Get current speed multiplier (for AI ants in overhead view).
   */
  getSpeedMultiplier() {
    return CONFIG.SPEED_LEVELS[this.speedLevel];
  }

  /**
   * Cycle to next speed level (overhead view only).
   */
  nextSpeed() {
    this.speedLevel = (this.speedLevel + 1) % CONFIG.SPEED_LEVELS.length;
  }

  /**
   * Set speed level directly.
   */
  setSpeedLevel(level) {
    this.speedLevel = Math.max(0, Math.min(CONFIG.SPEED_LEVELS.length - 1, level));
  }

  /**
   * Get colony statistics.
   */
  getPlayerStats() {
    return this.playerColony.getStats();
  }

  getEnemyStats() {
    return this.enemyColony.getStats();
  }

  /**
   * Toggle pause.
   */
  togglePause() {
    this.isPaused = !this.isPaused;
  }
}

export default SimulationEngine;
