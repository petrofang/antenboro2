import CONFIG from './config.js';

/**
 * Ant entity with state machine, movement, and combat logic.
 */
export class Ant {
  constructor(id, type, colonyId, nestX, nestY) {
    this.id = id;
    this.type = type;              // 'WORKER' or 'SOLDIER'
    this.colonyId = colonyId;      // 0 = player, 1 = enemy
    
    // Position (float grid coordinates)
    this.x = nestX;
    this.y = nestY;
    this.nestX = nestX;  // Remember nest location for homing
    this.nestY = nestY;
    this.angle = Math.random() * Math.PI * 2;
    
    // Life & health
    this.age = 0;
    this.health = type === 'QUEEN' ? CONFIG.QUEEN_HEALTH
      : type === 'SOLDIER' ? CONFIG.SOLDIER_HEALTH
      : CONFIG.WORKER_HEALTH;
    this.maxHealth = this.health;
    this.isDead = false;
    
    // State machine
    this.state = 'WANDERING';     // WANDERING, FOLLOWING, CARRYING, FIGHTING, GUARDING
    this.stateTimer = 0;
    
    // Foraging
    this.carryingFood = 0;
    this.foodSearchTimer = 0;
    this.targetFood = null;       // Reference to food grid cell
    
    // Pheromone following
    this.followingPheromone = false;
    this.pheromoneChannel = colonyId; // Which pheromone to follow
    
    // Combat
    this.biteCooldown = 0;
    this.targetEnemy = null;
    
    // Player control flag — when true, AI state machine is skipped
    this.isPlayerControlled = false;
    
    // Ant-specific stats
    this.foodDeposited = 0;       // Career total
    this.entsKilled = 0;          // Career total
  }

  /**
   * Main update tick for this ant.
   * Called once per simulation tick.
   */
  update(world, colony, otherColony) {
    if (this.isDead) return;

    // Health-based death
    if (this.health <= 0) {
      this.isDead = true;
      return;
    }

    this.age++;
    if (this.age > CONFIG.ANT_LIFESPAN_TICKS) {
      this.isDead = true;
      return;
    }

    // Decrement cooldowns
    if (this.biteCooldown > 0) this.biteCooldown--;

    // Skip AI state machine for player-controlled ant
    if (this.isPlayerControlled) return;

    // State machine
    switch (this.state) {
      case 'WANDERING':
        this._wander(world, colony, otherColony);
        break;
      case 'FOLLOWING':
        this._follow(world, colony, otherColony);
        break;
      case 'CARRYING':
        this._carry(world, colony, otherColony);
        break;
      case 'FIGHTING':
        this._fight(world, colony, otherColony);
        break;
      case 'GUARDING':
        this._guard(world, colony, otherColony);
        break;
    }
  }

  _wander(world, colony, otherColony) {
    // Detect nearby enemies first (highest priority)
    const enemy = this._findNearbyEnemy(world, otherColony);
    if (enemy) {
      this.targetEnemy = enemy;
      this.state = 'FIGHTING';
      return;
    }

    // Detect nearby food via direct line-of-sight
    const food = this._findNearbyFood(world);
    if (food) {
      this.targetFood = food;
      this.state = 'FOLLOWING';
      return;
    }

    // --- Wall avoidance: sense walls ahead and steer away ---
    const lookAhead = 4;
    const aheadX = this.x + Math.cos(this.angle) * lookAhead;
    const aheadY = this.y + Math.sin(this.angle) * lookAhead;
    const margin = 3;
    
    if (aheadX < margin || aheadX > CONFIG.WORLD_WIDTH - margin ||
        aheadY < margin || aheadY > CONFIG.WORLD_HEIGHT - margin) {
      // Steer toward nest (center of activity) when near walls
      const toNestAngle = Math.atan2(this.nestY - this.y, this.nestX - this.x);
      this.angle = this._lerpAngle(this.angle, toNestAngle, 0.3);
      this.angle += (Math.random() - 0.5) * 0.4;
    }

    // --- Homing instinct: ants that wander too far bias back toward nest ---
    const distToNest = Math.hypot(this.x - this.nestX, this.y - this.nestY);
    const maxWanderDist = 35; // Max distance from nest before homesickness kicks in
    
    if (distToNest > maxWanderDist) {
      // Strong pull back toward nest
      const toNestAngle = Math.atan2(this.nestY - this.y, this.nestX - this.x);
      const pullStrength = Math.min(0.5, (distToNest - maxWanderDist) / 20);
      this.angle = this._lerpAngle(this.angle, toNestAngle, pullStrength);
    } else if (distToNest > maxWanderDist * 0.7) {
      // Mild bias toward nest at moderate distance
      if (Math.random() < 0.08) {
        const toNestAngle = Math.atan2(this.nestY - this.y, this.nestX - this.x);
        this.angle = this._lerpAngle(this.angle, toNestAngle, 0.15);
      }
    }

    // --- Pheromone-guided steering (3-sensor antenna model) ---
    const sensorDist = CONFIG.PHEROMONE_SENSOR_RANGE;
    const sensorSpread = CONFIG.PHEROMONE_SENSOR_SPREAD;
    
    const leftAngle = this.angle + sensorSpread;
    const rightAngle = this.angle - sensorSpread;
    
    const leftVal = world.readPheromone(
      this.x + Math.cos(leftAngle) * sensorDist,
      this.y + Math.sin(leftAngle) * sensorDist,
      this.pheromoneChannel
    );
    const centerVal = world.readPheromone(
      this.x + Math.cos(this.angle) * sensorDist,
      this.y + Math.sin(this.angle) * sensorDist,
      this.pheromoneChannel
    );
    const rightVal = world.readPheromone(
      this.x + Math.cos(rightAngle) * sensorDist,
      this.y + Math.sin(rightAngle) * sensorDist,
      this.pheromoneChannel
    );
    
    const maxVal = Math.max(leftVal, centerVal, rightVal);
    
    if (maxVal > 5) {
      // Follow pheromone trail
      if (leftVal > centerVal && leftVal > rightVal) {
        this.angle += CONFIG.ANT_ROTATION_SPEED;
      } else if (rightVal > centerVal && rightVal > leftVal) {
        this.angle -= CONFIG.ANT_ROTATION_SPEED;
      }
    } else {
      // No pheromone — random walk with moderate turns
      if (Math.random() < 0.15) {
        this.angle += (Math.random() - 0.5) * CONFIG.ANT_WANDER_ANGLE_CHANGE * 2;
      }
    }

    // Move forward
    this._move();

    // Deposit exploratory pheromone
    if (Math.random() < 0.03) {
      world.depositPheromone(this.x, this.y, this.pheromoneChannel, 10);
    }
  }

  _follow(world, colony, otherColony) {
    if (!this.targetFood || this.targetFood.amount <= 0) {
      this.state = 'WANDERING';
      this.targetFood = null;
      return;
    }

    const dist = Math.hypot(this.x - this.targetFood.x, this.y - this.targetFood.y);

    if (dist < 1.5) {
      // Reached food
      const foodTaken = Math.min(CONFIG.FOOD_CARRY_CAPACITY, this.targetFood.amount);
      this.targetFood.amount -= foodTaken;
      this.carryingFood = foodTaken;
      this.state = 'CARRYING';
      return;
    }

    // Move toward food
    const dx = this.targetFood.x - this.x;
    const dy = this.targetFood.y - this.y;
    this.angle = Math.atan2(dy, dx);
    this._move();

    // Deposit pheromone trail
    if (this.age % CONFIG.PHEROMONE_DEPOSIT_RATE === 0) {
      world.depositPheromone(this.x, this.y, this.pheromoneChannel, CONFIG.PHEROMONE_STRENGTH_FOOD);
    }
  }

  _carry(world, colony, otherColony) {
    const nestX = colony.nestX;
    const nestY = colony.nestY;
    const dist = Math.hypot(this.x - nestX, this.y - nestY);

    if (dist < CONFIG.NEST_RADIUS) {
      // Deposited food at nest
      colony.foodAmount += this.carryingFood;
      this.carryingFood = 0;
      this.foodDeposited++;
      
      // Small chance to wander after deposit, or check for more food
      this.state = Math.random() < 0.7 ? 'WANDERING' : 'FOLLOWING';
      this.targetFood = null;
      return;
    }

    // Move toward nest
    const dx = nestX - this.x;
    const dy = nestY - this.y;
    this.angle = Math.atan2(dy, dx);
    this._move();

    // Deposit strong home pheromone
    if (this.age % Math.max(1, Math.floor(CONFIG.PHEROMONE_DEPOSIT_RATE * 0.7)) === 0) {
      world.depositPheromone(this.x, this.y, this.pheromoneChannel, CONFIG.PHEROMONE_STRENGTH_HOME);
    }
  }

  _fight(world, colony, otherColony) {
    if (!this.targetEnemy || this.targetEnemy.isDead) {
      this.targetEnemy = null;
      this.state = 'WANDERING';
      return;
    }

    const dist = Math.hypot(this.x - this.targetEnemy.x, this.y - this.targetEnemy.y);

    if (dist < CONFIG.BITE_RANGE && this.biteCooldown === 0) {
      // Bite!
      const damage = this.type === 'SOLDIER' ? CONFIG.SOLDIER_DAMAGE : CONFIG.WORKER_DAMAGE;
      this.targetEnemy.health -= damage;
      this.biteCooldown = CONFIG.BITE_COOLDOWN;
      
      if (this.targetEnemy.isDead) {
        this.entsKilled++;
        this.state = 'WANDERING';
      }
      return;
    }

    // Move toward enemy
    const dx = this.targetEnemy.x - this.x;
    const dy = this.targetEnemy.y - this.y;
    this.angle = Math.atan2(dy, dx);
    this._move();
  }

  _guard(world, colony, otherColony) {
    // Stationary near nest, watching for enemies
    const enemy = this._findNearbyEnemy(world, otherColony);
    if (enemy) {
      this.targetEnemy = enemy;
      this.state = 'FIGHTING';
      return;
    }

    // Random patrol around nest
    if (Math.random() < 0.05) {
      this.angle += (Math.random() - 0.5) * 0.3;
      this._move();
    }
  }

  _move() {
    // Pre-emptive wall avoidance: if next position would be out of bounds,
    // turn away from the wall instead of moving into it
    const margin = 2;
    let newX = this.x + Math.cos(this.angle) * CONFIG.ANT_SPEED;
    let newY = this.y + Math.sin(this.angle) * CONFIG.ANT_SPEED;
    
    if (newX < margin || newX > CONFIG.WORLD_WIDTH - margin ||
        newY < margin || newY > CONFIG.WORLD_HEIGHT - margin) {
      // Turn toward center of the world
      const centerX = CONFIG.WORLD_WIDTH / 2;
      const centerY = CONFIG.WORLD_HEIGHT / 2;
      const toCenterAngle = Math.atan2(centerY - this.y, centerX - this.x);
      this.angle = this._lerpAngle(this.angle, toCenterAngle, 0.5);
      this.angle += (Math.random() - 0.5) * 0.6;
      
      // Recalculate movement with new angle
      newX = this.x + Math.cos(this.angle) * CONFIG.ANT_SPEED;
      newY = this.y + Math.sin(this.angle) * CONFIG.ANT_SPEED;
    }
    
    this.x = newX;
    this.y = newY;

    // Hard clamp as safety net
    this.x = Math.max(1, Math.min(CONFIG.WORLD_WIDTH - 2, this.x));
    this.y = Math.max(1, Math.min(CONFIG.WORLD_HEIGHT - 2, this.y));
  }

  /**
   * Interpolate between two angles along the shorter arc.
   */
  _lerpAngle(from, to, t) {
    let diff = to - from;
    // Normalize to [-PI, PI]
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return from + diff * t;
  }

  _findNearbyFood(world) {
    let closestFood = null;
    let closestDist = CONFIG.FOOD_SEARCH_RANGE;

    for (const food of world.foodPatches) {
      if (food.amount <= 0) continue;
      const dist = Math.hypot(this.x - food.x, this.y - food.y);
      if (dist < closestDist) {
        closestDist = dist;
        closestFood = food;
      }
    }

    return closestFood;
  }

  _findNearbyEnemy(world, otherColony) {
    let closestEnemy = null;
    let closestDist = 5;

    for (const ant of otherColony.ants) {
      if (ant.isDead) continue;
      const dist = Math.hypot(this.x - ant.x, this.y - ant.y);
      if (dist < closestDist) {
        closestDist = dist;
        closestEnemy = ant;
      }
    }

    return closestEnemy;
  }
}

export default Ant;
