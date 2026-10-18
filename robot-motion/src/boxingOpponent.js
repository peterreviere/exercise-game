import * as THREE from 'three';

function makeMesh(geometry, material, position, parent) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export class BoxingOpponent {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'Boxing Opponent';

    const shell = new THREE.MeshStandardMaterial({ color: 0xe55353, metalness: 0.42, roughness: 0.34 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x26354a, metalness: 0.58, roughness: 0.3 });
    const glow = new THREE.MeshStandardMaterial({ color: 0xffcf66, emissive: 0x8a3d08, metalness: 0.2, roughness: 0.22 });
    const jointGeometry = new THREE.SphereGeometry(0.16, 20, 16);
    const limbGeometry = new THREE.CylinderGeometry(0.115, 0.14, 0.52, 16);

    const torso = makeMesh(new THREE.BoxGeometry(0.78, 0.82, 0.48), shell, [0, 1.55, 0], this.group);
    torso.rotation.x = -0.04;
    makeMesh(new THREE.BoxGeometry(0.52, 0.2, 0.5), dark, [0, 1.14, 0], this.group);
    makeMesh(new THREE.SphereGeometry(0.36, 24, 20), shell, [0, 2.22, 0], this.group);
    makeMesh(new THREE.BoxGeometry(0.32, 0.13, 0.08), glow, [0, 2.24, 0.32], this.group);
    makeMesh(new THREE.CylinderGeometry(0.105, 0.105, 0.16, 16), dark, [0, 1.99, 0], this.group);

    this.arms = [];
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.48, 1.83, 0);
      this.group.add(shoulder);
      makeMesh(jointGeometry, dark, [0, 0, 0], shoulder);
      makeMesh(limbGeometry, shell, [0, -0.3, 0], shoulder);
      const fist = makeMesh(new THREE.SphereGeometry(0.2, 20, 16), dark, [0, -0.61, 0.02], shoulder);
      fist.scale.set(1, 0.85, 1.15);
      this.arms.push(shoulder);

      const hip = new THREE.Group();
      hip.position.set(side * 0.22, 1.05, 0);
      this.group.add(hip);
      makeMesh(new THREE.CylinderGeometry(0.14, 0.16, 0.72, 16), dark, [0, -0.36, 0], hip);
      makeMesh(new THREE.BoxGeometry(0.3, 0.16, 0.42), shell, [0, -0.72, 0.06], hip);
    }

    this.action = 'idle';
    this.baseZ = 1.15;
    this.hitAt = -Infinity;
    this.hitSide = 0;
    this.whiffAt = -Infinity;
    this.whiffSide = 0;
    this.whiffMove = '';
    this.group.rotation.y = Math.PI;
    this.group.scale.setScalar(0.82);
    this.group.position.set(1.15, 0, 0);
    this.update(0, 0);
  }

  receiveHit(time, moveId) {
    if (!Number.isFinite(time)) throw new TypeError('Opponent hit time must be finite');
    this.hitAt = time;
    this.hitSide = moveId === 'punch-left' ? -1 : 1;
  }

  dodgeAttack(time, moveId) {
    if (!Number.isFinite(time)) throw new TypeError('Opponent dodge time must be finite');
    this.whiffAt = time;
    this.whiffSide = moveId === 'move-left' ? 1 : moveId === 'move-right' ? -1 : 0;
    this.whiffMove = moveId;
  }

  update(time, deltaSeconds, action = 'idle', windup = false) {
    if (!Number.isFinite(time) || !Number.isFinite(deltaSeconds)) {
      throw new TypeError('Opponent animation time must be finite');
    }
    this.action = action;
    const phase = time * 0.001;
    const targetFor = (index) => {
      const active = !windup && action !== 'idle';
      const preparing = windup && action !== 'idle';
      const side = action.endsWith('left') ? 0 : 1;
      if (action === 'straight-punch') return index === 0 ? (active ? 1.05 : preparing ? 0.32 : 0) : 0;
      if (action === 'high-hook') return index === 1 ? (active ? 1.25 : preparing ? 0.4 : 0) : 0;
      if (action === 'swing-left' || action === 'swing-right') {
        const arm = action === 'swing-left' ? 0 : 1;
        return index === arm ? (active ? 0.95 : preparing ? 0.3 : 0) : 0;
      }
      if (action === 'stagger-left' || action === 'stagger-right') {
        if (index !== side) return 0;
        return active ? 0.55 : preparing ? 0.2 : 0;
      }
      return 0;
    };

    this.arms.forEach((arm, index) => {
      const target = targetFor(index);
      arm.rotation.x += (target - arm.rotation.x) * Math.min(1, deltaSeconds * 10);
      arm.rotation.z = Math.sin(phase * 2 + index * Math.PI) * (action === 'idle' ? 0.025 : 0.04);
    });
    const hitProgress = Math.max(0, 1 - (time - this.hitAt) / 650);
    const whiffProgress = Math.max(0, 1 - (time - this.whiffAt) / 700);
    this.group.position.y = Math.sin(phase * 2.2) * 0.025 + hitProgress * 0.12;
    this.group.position.x = this.whiffSide * whiffProgress * 0.28;
    const ducksUnder = this.whiffMove === 'duck' || this.whiffMove === 'block';
    this.group.position.y -= ducksUnder ? whiffProgress * 0.18 : 0;
    this.group.position.z = this.baseZ + hitProgress * 0.38 + whiffProgress * 0.22;
    this.group.rotation.z = hitProgress * this.hitSide * 0.24
      + whiffProgress * this.whiffSide * 0.12
      + (action.startsWith('stagger') ? Math.sin(phase * 8) * 0.045 : Math.sin(phase * 1.2) * 0.012);
  }
}
