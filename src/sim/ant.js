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
    // Random walk with slight tendency to turn
    if (Math.random() < 0.1) {
      this.angle += (Math.random() - 0.5) * CONFIG.ANT_WANDER_ANGLE_CHANGE;
    }

    // Detect nearby enemies
    const enemy = this._findNearbyEnemy(world, otherColony);
    if (enemy) {
      this.targetEnemy = enemy;
      this.state = 'FIGHTING';
      return;
    }

    // Detect nearby food
    const food = this._findNearbyFood(world);
    if (food) {
      this.targetFood = food;
      this.state = 'FOLLOWING';
      return;
    }

    // Move forward
    this._move();

    // Deposit exploratory pheromone (low strength)
    if (Math.random() < 0.05) {
      world.depositPheromone(this.x, this.y, this.pheromoneChannel, 20);
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
    const newX = this.x + Math.cos(this.angle) * CONFIG.ANT_SPEED;
    const newY = this.y + Math.sin(this.angle) * CONFIG.ANT_SPEED;

    // Bounce off world borders by reversing the relevant angle component
    let hitWall = false;
    if (newX <= 0 || newX >= CONFIG.WORLD_WIDTH - 1) {
      this.angle = Math.PI - this.angle; // Reflect horizontally
      hitWall = true;
    }
    if (newY <= 0 || newY >= CONFIG.WORLD_HEIGHT - 1) {
      this.angle = -this.angle; // Reflect vertically
      hitWall = true;
    }

    if (hitWall) {
      // Add some randomness so they don't just ping-pong
      this.angle += (Math.random() - 0.5) * 0.5;
    }

    this.x += Math.cos(this.angle) * CONFIG.ANT_SPEED;
    this.y += Math.sin(this.angle) * CONFIG.ANT_SPEED;

    // Clamp to world bounds (safety net)
    this.x = Math.max(1, Math.min(CONFIG.WORLD_WIDTH - 2, this.x));
    this.y = Math.max(1, Math.min(CONFIG.WORLD_HEIGHT - 2, this.y));
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
