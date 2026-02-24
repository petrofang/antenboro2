import CONFIG from './config.js';
import { Ant } from './ant.js';

/**
 * Colony manager: queen, ants, food, egg-laying.
 */
export class Colony {
  constructor(id, nestX, nestY) {
    this.id = id;                    // 0 = player, 1 = enemy
    this.nestX = nestX;
    this.nestY = nestY;
    
    this.queen = null;               // Queen ant
    this.ants = [];                  // All ants in colony
    this.foodAmount = 100;           // Starting food
    
    this.eggQueue = [];              // { age: 0, type: 'WORKER' }
    this.larvaQueue = [];
    this.pupaQueue = [];
    
    this.eggLayingTimer = 0;
    this.nextAntId = 0;
    
    this._initializeStartingAnts();
  }

  _initializeStartingAnts() {
    // Create queen
    this.queen = new Ant(this.nextAntId++, 'QUEEN', this.id, this.nestX, this.nestY);
    this.queen.health = CONFIG.QUEEN_HEALTH;
    this.queen.maxHealth = CONFIG.QUEEN_HEALTH;
    this.ants.push(this.queen);

    // Create initial workers
    for (let i = 0; i < CONFIG.INITIAL_WORKERS; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * 3;
      const x = this.nestX + Math.cos(angle) * dist;
      const y = this.nestY + Math.sin(angle) * dist;
      const ant = new Ant(this.nextAntId++, 'WORKER', this.id, x, y);
      this.ants.push(ant);
    }

    // Create initial soldiers
    for (let i = 0; i < CONFIG.INITIAL_SOLDIERS; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * 3;
      const x = this.nestX + Math.cos(angle) * dist;
      const y = this.nestY + Math.sin(angle) * dist;
      const ant = new Ant(this.nextAntId++, 'SOLDIER', this.id, x, y);
      this.ants.push(ant);
    }
  }

  /**
   * Update colony state: queen egg-laying, lifecycle progression, deaths.
   */
  update(world, otherColony) {
    // Update all ants
    for (let i = this.ants.length - 1; i >= 0; i--) {
      const ant = this.ants[i];
      ant.update(world, this, otherColony);

      if (ant.isDead) {
        this.ants.splice(i, 1);
      }
    }

    // Queen egg-laying logic
    if (this.queen && !this.queen.isDead) {
      this.eggLayingTimer++;
      if (
        this.eggLayingTimer >= CONFIG.QUEEN_EGG_LAYING_INTERVAL &&
        this.foodAmount >= CONFIG.QUEEN_MIN_FOOD_TO_LAY &&
        this.ants.length < CONFIG.MAX_ANTS_PER_COLONY
      ) {
        this._layEgg();
        this.eggLayingTimer = 0;
      }
    }

    // Egg → Larva progression
    for (let i = this.eggQueue.length - 1; i >= 0; i--) {
      this.eggQueue[i].age++;
      if (this.eggQueue[i].age >= CONFIG.EGG_INCUBATION_TICKS) {
        this.larvaQueue.push(this.eggQueue[i]);
        this.eggQueue.splice(i, 1);
      }
    }

    // Larva → Pupa progression
    for (let i = this.larvaQueue.length - 1; i >= 0; i--) {
      this.larvaQueue[i].age++;
      if (this.larvaQueue[i].age >= CONFIG.LARVA_GROWTH_TICKS) {
        this.pupaQueue.push(this.larvaQueue[i]);
        this.larvaQueue.splice(i, 1);
      }
    }

    // Pupa → Adult progression
    for (let i = this.pupaQueue.length - 1; i >= 0; i--) {
      this.pupaQueue[i].age++;
      if (this.pupaQueue[i].age >= CONFIG.PUPA_GROWTH_TICKS) {
        const data = this.pupaQueue[i];
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * 2;
        const ant = new Ant(
          this.nextAntId++,
          data.type,
          this.id,
          this.nestX + Math.cos(angle) * dist,
          this.nestY + Math.sin(angle) * dist
        );
        this.ants.push(ant);
        this.pupaQueue.splice(i, 1);
      }
    }
  }

  _layEgg() {
    // Randomly choose worker or soldier (mostly workers)
    const type = Math.random() < 0.8 ? 'WORKER' : 'SOLDIER';
    this.eggQueue.push({ age: 0, type });
    this.foodAmount -= 5; // Cost to lay egg
  }

  /**
   * Get colony statistics for HUD/UI.
   */
  getStats() {
    const workerCount = this.ants.filter(a => a.type === 'WORKER' && !a.isDead).length;
    const soldierCount = this.ants.filter(a => a.type === 'SOLDIER' && !a.isDead).length;
    return {
      totalAnts: this.ants.length,
      workers: workerCount,
      soldiers: soldierCount,
      food: Math.floor(this.foodAmount),
      eggs: this.eggQueue.length,
      larvae: this.larvaQueue.length,
      pupae: this.pupaQueue.length,
      queenHealth: this.queen ? this.queen.health : 0,
      queenMaxHealth: CONFIG.QUEEN_HEALTH,
    };
  }
}

export default Colony;
