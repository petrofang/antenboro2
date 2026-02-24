import CONFIG from './config.js';
import { PheromoneGrid } from './pheromone.js';

/**
 * World grid: food patches, obstacles, pheromones.
 */
export class World {
  constructor() {
    this.foodPatches = [];
    this.pheromones = new PheromoneGrid();
    
    this._generateFood();
    this._generateObstacles();
  }

  _generateFood() {
    const clusters = CONFIG.FOOD_CLUSTERS;
    const patchSize = CONFIG.FOOD_PER_CLUSTER;

    for (let c = 0; c < clusters; c++) {
      // Random location, avoiding nests
      let x, y;
      let valid = false;
      while (!valid) {
        x = Math.random() * (CONFIG.WORLD_WIDTH - 10) + 5;
        y = Math.random() * (CONFIG.WORLD_HEIGHT - 10) + 5;

        const distToPlayer = Math.hypot(x - CONFIG.PLAYER_COLONY_NEST_X, y - CONFIG.PLAYER_COLONY_NEST_Y);
        const distToEnemy = Math.hypot(x - CONFIG.ENEMY_COLONY_NEST_X, y - CONFIG.ENEMY_COLONY_NEST_Y);

        if (distToPlayer > 10 && distToEnemy > 10) {
          valid = true;
        }
      }

      this.foodPatches.push({
        x,
        y,
        amount: patchSize,
      });
    }
  }

  _generateObstacles() {
    // Obstacles can be added here; for now, empty.
  }

  /**
   * Deposit pheromone at a grid location.
   */
  depositPheromone(x, y, colonyId, strength) {
    this.pheromones.deposit(x, y, colonyId, strength);
  }

  /**
   * Read pheromone value at a location.
   */
  readPheromone(x, y, colonyId) {
    return this.pheromones.read(x, y, colonyId);
  }

  /**
   * Update world state (pheromone decay, food respawning, etc.).
   */
  update() {
    this.pheromones.update();
    
    // Respawn depleted food patches over time
    for (const food of this.foodPatches) {
      if (food.amount <= 0 && Math.random() < CONFIG.FOOD_RESPAWN_CHANCE) {
        food.amount = Math.floor(CONFIG.FOOD_PER_CLUSTER * (0.3 + Math.random() * 0.7));
      }
    }
  }
}

export default World;
