import CONFIG from './config.js';

/**
 * Underground colony structure — a graph of chambers connected by tunnels.
 * 
 * Nodes = chambers (entrance, queen chamber, nursery, food store, etc.)
 * Edges = tunnel corridors connecting chambers
 * 
 * Each colony has its own underground instance. Coordinates are local
 * to the colony (origin at entrance, Y = depth below surface, Z = deeper into colony).
 */
export class ColonyUnderground {
  constructor(colonyId) {
    this.colonyId = colonyId;
    this.nodes = new Map();   // nodeId → { id, type, x, y, z, radius, label, built }
    this.edges = new Map();   // edgeId → { id, fromId, toId, width, built }
    this.nextNodeId = 0;
    this.nextEdgeId = 0;

    // Build starter layout: entrance → tunnel → queen chamber
    this._buildStarterLayout();
  }

  /**
   * Every colony begins with:
   *   [Entrance] ──tunnel── [Queen Chamber]
   * 
   * Entrance is at local (0, 0, 0) — surface level.
   * Queen chamber is at (0, -1.5, -5) — deeper underground.
   */
  _buildStarterLayout() {
    // Entrance node (surface access)
    const entrance = this.addNode({
      type: 'entrance',
      x: 0, y: 0, z: 0,
      radius: 1.2,
      label: 'Entrance',
      built: true,
    });

    // Queen chamber (larger room, deeper)
    const queenChamber = this.addNode({
      type: 'queen_chamber',
      x: 0, y: -1.5, z: -5,
      radius: 2.5,
      label: 'Queen Chamber',
      built: true,
    });

    // Connecting tunnel
    this.addEdge(entrance.id, queenChamber.id, { width: 0.5, built: true });
  }

  // ─── NODE OPERATIONS ──────────────────────────────────────────────

  addNode({ type, x, y, z, radius, label, built = false }) {
    const id = this.nextNodeId++;
    const node = { id, type, x, y, z, radius, label, built };
    this.nodes.set(id, node);
    return node;
  }

  getNode(id) {
    return this.nodes.get(id);
  }

  getEntrance() {
    for (const node of this.nodes.values()) {
      if (node.type === 'entrance') return node;
    }
    return null;
  }

  getQueenChamber() {
    for (const node of this.nodes.values()) {
      if (node.type === 'queen_chamber') return node;
    }
    return null;
  }

  /**
   * Get all nodes connected to a given node.
   */
  getConnected(nodeId) {
    const connected = [];
    for (const edge of this.edges.values()) {
      if (edge.fromId === nodeId) connected.push(this.nodes.get(edge.toId));
      if (edge.toId === nodeId) connected.push(this.nodes.get(edge.fromId));
    }
    return connected;
  }

  // ─── EDGE OPERATIONS ──────────────────────────────────────────────

  addEdge(fromId, toId, { width = 0.5, built = false } = {}) {
    const id = this.nextEdgeId++;
    const edge = { id, fromId, toId, width, built };
    this.edges.set(id, edge);
    return edge;
  }

  /**
   * Get the edge connecting two nodes, if any.
   */
  getEdge(nodeA, nodeB) {
    for (const edge of this.edges.values()) {
      if ((edge.fromId === nodeA && edge.toId === nodeB) ||
          (edge.fromId === nodeB && edge.toId === nodeA)) {
        return edge;
      }
    }
    return null;
  }

  /**
   * Get all edges touching a node.
   */
  getEdgesFor(nodeId) {
    const result = [];
    for (const edge of this.edges.values()) {
      if (edge.fromId === nodeId || edge.toId === nodeId) {
        result.push(edge);
      }
    }
    return result;
  }

  // ─── EXPANSION ────────────────────────────────────────────────────

  /**
   * Dig a new tunnel from an existing node in a direction.
   * Creates a junction node at the end.
   * @returns {{ node, edge }} the new junction and its connecting edge
   */
  digTunnel(fromNodeId, dirX, dirY, dirZ, length = 4) {
    const from = this.nodes.get(fromNodeId);
    if (!from) return null;

    const mag = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ) || 1;
    const nx = from.x + (dirX / mag) * length;
    const ny = from.y + (dirY / mag) * length;
    const nz = from.z + (dirZ / mag) * length;

    const node = this.addNode({
      type: 'tunnel_junction',
      x: nx, y: ny, z: nz,
      radius: 0.8,
      label: 'Junction',
      built: true,
    });

    const edge = this.addEdge(from.id, node.id, { width: 0.5, built: true });
    return { node, edge };
  }

  /**
   * Upgrade a junction node to a designated chamber type.
   * @param {number} nodeId - must be a tunnel_junction
   * @param {string} chamberType - nursery, food_store, barracks, etc.
   * @returns {boolean} success
   */
  designateChamber(nodeId, chamberType) {
    const node = this.nodes.get(nodeId);
    if (!node || node.type !== 'tunnel_junction') return false;

    const chamberConfig = CONFIG.BUILDING_TYPES[chamberType.toUpperCase()];
    if (!chamberConfig) return false;

    node.type = chamberType;
    node.label = chamberConfig.name;
    node.radius = 2.0; // chambers are bigger than junctions
    node.built = false; // needs workers to construct
    return true;
  }

  // ─── QUERIES ──────────────────────────────────────────────────────

  /**
   * Find the nearest node to a local underground position.
   */
  nearestNode(x, y, z) {
    let closest = null;
    let minDist = Infinity;
    for (const node of this.nodes.values()) {
      const d = Math.sqrt(
        (node.x - x) ** 2 + (node.y - y) ** 2 + (node.z - z) ** 2
      );
      if (d < minDist) {
        minDist = d;
        closest = node;
      }
    }
    return { node: closest, dist: minDist };
  }

  /**
   * Check if a local position is inside any node's radius.
   */
  getNodeAt(x, y, z) {
    for (const node of this.nodes.values()) {
      const d = Math.sqrt(
        (node.x - x) ** 2 + (node.y - y) ** 2 + (node.z - z) ** 2
      );
      if (d <= node.radius) return node;
    }
    return null;
  }

  /**
   * Get the tunnel edge that a position is closest to (for wall collision).
   * Returns { edge, t, distance } where t is 0-1 along the edge centerline.
   */
  nearestEdge(x, y, z) {
    let closestEdge = null;
    let minDist = Infinity;
    let closestT = 0;

    for (const edge of this.edges.values()) {
      const from = this.nodes.get(edge.fromId);
      const to = this.nodes.get(edge.toId);
      if (!from || !to) continue;

      // Point-to-line-segment distance
      const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
      const lenSq = dx * dx + dy * dy + dz * dz;
      if (lenSq === 0) continue;

      let t = ((x - from.x) * dx + (y - from.y) * dy + (z - from.z) * dz) / lenSq;
      t = Math.max(0, Math.min(1, t));

      const px = from.x + t * dx;
      const py = from.y + t * dy;
      const pz = from.z + t * dz;
      const dist = Math.sqrt((x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2);

      if (dist < minDist) {
        minDist = dist;
        closestEdge = edge;
        closestT = t;
      }
    }

    return { edge: closestEdge, t: closestT, distance: minDist };
  }

  /**
   * Constrain a position to stay within tunnels and chambers.
   * Returns the corrected position.
   */
  constrainPosition(x, y, z) {
    // Check if inside any chamber
    const inNode = this.getNodeAt(x, y, z);
    if (inNode) return { x, y, z, inNode };

    // Otherwise, constrain to nearest tunnel edge
    const { edge, t, distance } = this.nearestEdge(x, y, z);
    if (!edge) return { x, y, z, inNode: null };

    const maxDist = edge.width;
    if (distance <= maxDist) return { x, y, z, inNode: null };

    // Push position back toward the tunnel centerline
    const from = this.nodes.get(edge.fromId);
    const to = this.nodes.get(edge.toId);
    const cx = from.x + t * (to.x - from.x);
    const cy = from.y + t * (to.y - from.y);
    const cz = from.z + t * (to.z - from.z);

    // Direction from center to position
    const dx = x - cx, dy = y - cy, dz = z - cz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;

    return {
      x: cx + (dx / d) * maxDist,
      y: cy + (dy / d) * maxDist,
      z: cz + (dz / d) * maxDist,
      inNode: null,
    };
  }
}

export default ColonyUnderground;
