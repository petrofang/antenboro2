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
   * Uses a logarithmic-inspired decay: strong trails fade slowly (persistent highways),
   * weak trails vanish quickly. This mimics real ant pheromone chemistry where
   * volatile compounds evaporate faster at low concentrations.
   * 
   * Formula: new = old * rate - floor_drain
   * The constant floor_drain (0.02) ensures near-zero values get cleaned up,
   * while the high rate (0.999) keeps strong trails around for minutes.
   */
  update() {
    const rate = CONFIG.PHEROMONE_DECAY_RATE;
    const floorDrain = 0.02; // Small constant subtracted each tick to clean up weak trails
    
    for (let c = 0; c < CONFIG.PHEROMONE_CHANNELS; c++) {
      for (let x = 0; x < CONFIG.WORLD_WIDTH; x++) {
        for (let y = 0; y < CONFIG.WORLD_HEIGHT; y++) {
          let val = this.grids[c][x][y];
          if (val <= 0) continue;
          
          // Multiplicative decay + small constant drain
          val = val * rate - floorDrain;
          
          // Clean up negligible values
          if (val < 0.5) val = 0;
          
          this.grids[c][x][y] = val;
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
