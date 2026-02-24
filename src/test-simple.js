import * as THREE from 'three';

console.log('✅ test-simple.js loaded');
console.log('✅ THREE version:', THREE.REVISION);

// Minimal scene test
const canvas = document.getElementById('canvas');
console.log('✅ Canvas found:', canvas);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas });

renderer.setSize(window.innerWidth, window.innerHeight);
camera.position.z = 5;

// Create a simple test cube
const geometry = new THREE.BoxGeometry();
const material = new THREE.MeshBasicMaterial({ color: 0xff6600 });
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);

console.log('✅ Scene created');
console.log('✅ Rendering...');

function animate() {
  requestAnimationFrame(animate);
  cube.rotation.x += 0.01;
  cube.rotation.y += 0.01;
  renderer.render(scene, camera);
}

animate();
console.log('✅ Animation loop started');

const statusEl = document.getElementById('status');
if (statusEl) {
  statusEl.innerHTML = '<span style="color: #00ff00;">✅ Rendering test cube (orange rotating cube)</span>';
}
