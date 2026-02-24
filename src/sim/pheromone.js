import CONFIG from './config.js';

/**
 * Pheromone grid system for each colony.
 * Each colony has its own pheromone layer for foraging and homing.
 */
export class PheromoneGrid {
  constructor() {
    // One grid per colony (0 = player, 1 = enemy)
    this.grids = [
      this._createEmptyGrid(),
      this._createEmptyGrid(),
    ];
  }

  _createEmptyGrid() {
    const grid = [];
    for (let x = 0; x < CONFIG.WORLD_WIDTH; x++) {
      grid[x] = [];
      for (let y = 0; y < CONFIG.WORLD_HEIGHT; y++) {
        grid[x][y] = 0;
      }
    }
    return grid;
  }

  /**
   * Deposit pheromone at a grid location.
   */
  deposit(x, y, colonyId, strength) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);

    if (ix < 0 || ix >= CONFIG.WORLD_WIDTH || iy < 0 || iy >= CONFIG.WORLD_HEIGHT) {
      return;
    }

    this.grids[colonyId][ix][iy] += strength;
    // Clamp to reasonable max to avoid numerical explosion
    this.grids[colonyId][ix][iy] = Math.min(this.grids[colonyId][ix][iy], 1000);
  }

  /**
   * Read pheromone value at a location (for steering).
   */
  read(x, y, colonyId) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);

    if (ix < 0 || ix >= CONFIG.WORLD_WIDTH || iy < 0 || iy >= CONFIG.WORLD_HEIGHT) {
      return 0;
    }

    return this.grids[colonyId][ix][iy];
  }

  /**
   * Decay all pheromones each tick.
   */
  update() {
    for (let c = 0; c < CONFIG.PHEROMONE_CHANNELS; c++) {
      for (let x = 0; x < CONFIG.WORLD_WIDTH; x++) {
        for (let y = 0; y < CONFIG.WORLD_HEIGHT; y++) {
          this.grids[c][x][y] *= CONFIG.PHEROMONE_DECAY_RATE;
        }
      }
    }
  }

  /**
   * Get a heatmap for rendering (used by minimap).
   * Returns array of pheromone values for one colony.
   */
  getHeatmap(colonyId) {
    return this.grids[colonyId];
  }
}

export default PheromoneGrid;
