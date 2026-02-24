import { CONFIG } from '../sim/config.js';
import { Ant } from '../sim/ant.js';

/**
 * Player input handling and hero ant behavior.
 */
export class PlayerController {
  constructor(colony, simulation, sceneManager) {
    this.colony = colony;
    this.simulation = simulation;
    this.sceneManager = sceneManager;
    
    // Create player ant (starts as worker)
    this.ant = new Ant(
      99999,
      'WORKER',
      0,
      CONFIG.PLAYER_COLONY_NEST_X,
      CONFIG.PLAYER_COLONY_NEST_Y
    );
    colony.ants.push(this.ant);
    simulation.setPlayerAnt(this.ant);
    
    // Input state
    this.keys = {};
    this.mouseDown = false;
    this.mouseX = 0;
    this.mouseY = 0;
    
    // Ability cooldowns
    this.biteCooldown = 0;
    this.rallyCooldown = 0;
    
    // Camera mode
    this.isFPSMode = true; // true = FPS, false = overhead
    
    this._setupInputHandlers();
  }

  _setupInputHandlers() {
    document.addEventListener('keydown', (e) => {
      this.keys[e.key.toLowerCase()] = true;
      
      // Special keys
      switch (e.key.toLowerCase()) {
        case 'tab':
          e.preventDefault();
          this.toggleCameraMode();
          break;
        case 'f':
          this._pickupFood();
          break;
        case 'e':
          this._depositFood();
          break;
        case 'q':
          this._rallyPheromone();
          break;
        case 'b':
          this._openBuildMenu();
          break;
        case ' ':
          // Space: jump (simple height boost in 3D)
          break;
        case 'p':
          this.simulation.togglePause();
          break;
        case 'arrowup':
        case 'arrowdown':
        case 'arrowleft':
        case 'arrowright':
          if (!this.isFPSMode) {
            // Overhead: speed controls
            e.preventDefault();
            if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
              this.simulation.nextSpeed();
            }
          }
          break;
      }
    });
    
    document.addEventListener('keyup', (e) => {
      this.keys[e.key.toLowerCase()] = false;
    });
    
    document.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.mouseDown = true;
        this.mouseX = e.clientX;
        this.mouseY = e.clientY;
        this._bite();
      }
    });
    
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.mouseDown = false;
      }
    });
  }

  toggleCameraMode() {
    this.isFPSMode = !this.isFPSMode;
    console.log(this.isFPSMode ? 'FPS Mode' : 'Overhead Mode');
  }

  _pickupFood() {
    // Find nearby food
    const nearby = this.simulation.world.foodPatches.find(
      food => Math.hypot(this.ant.x - food.x, this.ant.y - food.y) < 1.5
    );
    
    if (nearby && nearby.amount > 0) {
      const foodTaken = Math.min(CONFIG.FOOD_CARRY_CAPACITY, nearby.amount);
      nearby.amount -= foodTaken;
      this.ant.carryingFood = foodTaken;
      this.ant.state = 'CARRYING';
      console.log('Picked up food!');
    }
  }

  _depositFood() {
    const nestDist = Math.hypot(this.ant.x - this.colony.nestX, this.ant.y - this.colony.nestY);
    if (nestDist < CONFIG.NEST_RADIUS && this.ant.carryingFood > 0) {
      this.colony.foodAmount += this.ant.carryingFood;
      this.ant.carryingFood = 0;
      this.ant.state = 'WANDERING';
      console.log('Deposited food at nest!');
    }
  }

  _rallyPheromone() {
    if (this.rallyCooldown > 0) return;
    
    // Deposit strong pheromone to rally nearby ants
    this.simulation.world.depositPheromone(
      this.ant.x,
      this.ant.y,
      0, // Player colony
      CONFIG.PLAYER_PHEROMONE_RALLY_STRENGTH
    );
    
    this.rallyCooldown = CONFIG.PLAYER_RALLY_COOLDOWN;
    console.log('Rally pheromone deployed!');
  }

  _bite() {
    if (this.biteCooldown > 0) return;
    
    // Find nearest enemy to bite
    let target = null;
    let minDist = CONFIG.BITE_RANGE;
    
    for (const enemy of this.simulation.enemyColony.ants) {
      if (enemy.isDead) continue;
      const dist = Math.hypot(this.ant.x - enemy.x, this.ant.y - enemy.y);
      if (dist < minDist) {
        minDist = dist;
        target = enemy;
      }
    }
    
    if (target) {
      target.health -= CONFIG.PLAYER_BITE_DAMAGE;
      this.biteCooldown = CONFIG.BITE_COOLDOWN;
      console.log(`Bit enemy! Damage: ${CONFIG.PLAYER_BITE_DAMAGE}`);
    }
  }

  _openBuildMenu() {
    console.log('Build menu opened (not yet implemented)');
  }

  /**
   * Update player ant behavior based on input.
   */
  update() {
    // Decrement cooldowns
    if (this.biteCooldown > 0) this.biteCooldown--;
    if (this.rallyCooldown > 0) this.rallyCooldown--;
    
    // Movement input (WASD or arrow keys)
    const moveDir = new THREE.Vector3(0, 0, 0);
    if (this.keys['w'] || this.keys['arrowup']) moveDir.z += 1;
    if (this.keys['s'] || this.keys['arrowdown']) moveDir.z -= 1;
    if (this.keys['a'] || this.keys['arrowleft']) moveDir.x -= 1;
    if (this.keys['d'] || this.keys['arrowright']) moveDir.x += 1;
    
    if (moveDir.length() > 0) {
      moveDir.normalize();
      
      // Convert 3D movement direction back to ant grid angle
      const worldAngle = Math.atan2(moveDir.x, moveDir.z);
      this.ant.angle = worldAngle;
      
      // Override ant movement for player control (in FPS mode)
      if (this.isFPSMode) {
        // Player moves at normal speed
        this.ant.x += Math.cos(this.ant.angle) * CONFIG.ANT_SPEED;
        this.ant.y += Math.sin(this.ant.angle) * CONFIG.ANT_SPEED;
        
        // Clamp to world
        this.ant.x = Math.max(0, Math.min(CONFIG.WORLD_WIDTH - 1, this.ant.x));
        this.ant.y = Math.max(0, Math.min(CONFIG.WORLD_HEIGHT - 1, this.ant.y));
        
        // Deposit pheromone trail
        if (this.ant.carryingFood) {
          this.simulation.world.depositPheromone(
            this.ant.x,
            this.ant.y,
            0,
            CONFIG.PHEROMONE_STRENGTH_HOME * 0.7
          );
        }
      }
    }
    
    // In overhead mode, let AI control the ant while player watches
    if (!this.isFPSMode) {
      // Ant is controlled by regular AI update (called by simulation)
    }
  }

  /**
   * Update camera position/orientation.
   */
  updateCamera(camera) {
    if (this.isFPSMode) {
      // First-person view: camera follows ant at head level
      const worldX = (this.ant.x - CONFIG.WORLD_WIDTH / 2) * CONFIG.CELL_SIZE;
      const worldZ = (this.ant.y - CONFIG.WORLD_HEIGHT / 2) * CONFIG.CELL_SIZE;
      
      camera.position.x = worldX;
      camera.position.y = 0.5; // Head level
      camera.position.z = worldZ;
      
      // Look forward in direction of ant angle
      const lookAhead = 5;
      const lookX = worldX + Math.cos(this.ant.angle) * lookAhead;
      const lookZ = worldZ + Math.sin(this.ant.angle) * lookAhead;
      camera.lookAt(lookX, 0.5, lookZ);
    } else {
      // Overhead strategic view
      camera.position.x = 0;
      camera.position.y = 40;
      camera.position.z = 0;
      camera.lookAt(0, 0, 0);
    }
  }
}

export default PlayerController;
